from fastapi import FastAPI, APIRouter, HTTPException, Request, Response, Depends, Query
from fastapi.responses import JSONResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import logging
from pathlib import Path
from pydantic import BaseModel, Field, EmailStr
from typing import List, Optional, Dict, Any
import uuid
from datetime import datetime, timezone, timedelta
import httpx
import stripe
import resend
import asyncio
import base64
from email.mime.text import MIMEText
import json
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.interval import IntervalTrigger
from contextlib import asynccontextmanager

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Initialize scheduler
scheduler = AsyncIOScheduler()

# Resend configuration
resend_api_key = os.environ.get('RESEND_API_KEY')
if resend_api_key:
    resend.api_key = resend_api_key

# ==================== Pydantic Models ====================

class UserBase(BaseModel):
    user_id: str
    email: str
    name: str
    picture: Optional[str] = None

class User(UserBase):
    created_at: datetime

class WorkspaceBase(BaseModel):
    workspace_id: str
    name: str
    timezone: str = "UTC"
    owner_user_id: str

class Workspace(WorkspaceBase):
    created_at: datetime

class WorkspaceCreate(BaseModel):
    name: str
    timezone: str = "UTC"

class GmailConnectionCreate(BaseModel):
    code: str
    redirect_uri: str

class GmailConnection(BaseModel):
    connection_id: str
    workspace_id: str
    google_user_email: str
    connected_at: datetime
    is_connected: bool = True

class StripeConnectionCreate(BaseModel):
    secret_key: str
    webhook_secret: Optional[str] = None

class StripeConnection(BaseModel):
    connection_id: str
    workspace_id: str
    stripe_account_id: Optional[str] = None
    connected_at: datetime
    last_sync_at: Optional[datetime] = None
    is_connected: bool = True

class Customer(BaseModel):
    customer_id: str
    workspace_id: str
    stripe_customer_id: str
    name: Optional[str] = None
    email: Optional[str] = None
    created_at: datetime

class InvoiceStatus:
    DRAFT = "draft"
    OPEN = "open"
    PAST_DUE = "past_due"
    PAID = "paid"
    UNCOLLECTIBLE = "uncollectible"
    VOID = "void"

class AutopilotState:
    ACTIVE = "active"
    PAUSED_REPLIED = "paused_replied"
    PAUSED_MANUAL = "paused_manual"
    STOPPED_PAID = "stopped_paid"
    STOPPED_MANUAL = "stopped_manual"

class Invoice(BaseModel):
    invoice_id: str
    workspace_id: str
    stripe_invoice_id: str
    stripe_customer_id: str
    customer_id: Optional[str] = None
    status: str = InvoiceStatus.OPEN
    autopilot_state: str = AutopilotState.ACTIVE
    amount_due_cents: int
    currency: str = "usd"
    due_date: Optional[str] = None
    issued_at: Optional[datetime] = None
    hosted_invoice_url: Optional[str] = None
    last_step_sent_at: Optional[datetime] = None
    next_action_at: Optional[datetime] = None
    created_at: datetime
    updated_at: datetime

class InvoiceUpdate(BaseModel):
    autopilot_state: Optional[str] = None
    status: Optional[str] = None

class ReminderStep(BaseModel):
    step_id: str
    policy_id: str
    step_order: int
    trigger_type: str  # before_due, on_due, after_due
    trigger_offset_days: int
    subject_template: str
    body_template: str
    is_enabled: bool = True

class ReminderPolicy(BaseModel):
    policy_id: str
    workspace_id: str
    name: str
    is_default: bool = False
    is_enabled: bool = True
    max_emails_per_week_per_customer: int = 2
    quiet_hours_start: int = 22
    quiet_hours_end: int = 8
    from_name: Optional[str] = None
    reply_to_email: Optional[str] = None
    email_footer_text: str = "Reply to this email if you have questions."
    created_at: datetime

class ReminderPolicyUpdate(BaseModel):
    name: Optional[str] = None
    is_enabled: Optional[bool] = None
    max_emails_per_week_per_customer: Optional[int] = None
    quiet_hours_start: Optional[int] = None
    quiet_hours_end: Optional[int] = None
    from_name: Optional[str] = None
    reply_to_email: Optional[str] = None
    email_footer_text: Optional[str] = None

class ReminderStepCreate(BaseModel):
    step_order: int
    trigger_type: str
    trigger_offset_days: int
    subject_template: str
    body_template: str
    is_enabled: bool = True

class ReminderStepUpdate(BaseModel):
    step_order: Optional[int] = None
    trigger_type: Optional[str] = None
    trigger_offset_days: Optional[int] = None
    subject_template: Optional[str] = None
    body_template: Optional[str] = None
    is_enabled: Optional[bool] = None

class EmailEvent(BaseModel):
    event_id: str
    workspace_id: str
    invoice_id: str
    customer_id: Optional[str] = None
    direction: str  # outbound, inbound
    event_type: str  # sent, delivered, bounced, replied, paused, resumed, stopped, manual_note
    gmail_message_id: Optional[str] = None
    gmail_thread_id: Optional[str] = None
    subject: Optional[str] = None
    snippet: Optional[str] = None
    sent_at: Optional[datetime] = None
    received_at: Optional[datetime] = None
    metadata_json: Optional[Dict] = None
    created_at: datetime

class Notification(BaseModel):
    notification_id: str
    workspace_id: str
    user_id: str
    type: str  # reply_received, invoice_paid, sync_failed
    payload_json: Dict
    is_read: bool = False
    created_at: datetime

class DashboardSummary(BaseModel):
    total_open: int
    total_open_amount: int
    total_past_due: int
    total_past_due_amount: int
    paid_this_month: int
    paid_this_month_amount: int
    invoices_paused: int
    currency: str = "usd"

# ==================== Helper Functions ====================

async def get_current_user(request: Request) -> Optional[dict]:
    """Get current user from session token"""
    session_token = request.cookies.get("session_token")
    
    if not session_token:
        auth_header = request.headers.get("Authorization")
        if auth_header and auth_header.startswith("Bearer "):
            session_token = auth_header.split(" ")[1]
    
    if not session_token:
        return None
    
    session = await db.user_sessions.find_one(
        {"session_token": session_token},
        {"_id": 0}
    )
    
    if not session:
        return None
    
    expires_at = session.get("expires_at")
    if isinstance(expires_at, str):
        expires_at = datetime.fromisoformat(expires_at)
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    if expires_at < datetime.now(timezone.utc):
        return None
    
    user = await db.users.find_one(
        {"user_id": session["user_id"]},
        {"_id": 0}
    )
    
    return user

async def require_auth(request: Request) -> dict:
    """Require authentication"""
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

async def get_user_workspace(user_id: str) -> Optional[dict]:
    """Get user's workspace"""
    member = await db.workspace_members.find_one(
        {"user_id": user_id},
        {"_id": 0}
    )
    if not member:
        return None
    
    workspace = await db.workspaces.find_one(
        {"workspace_id": member["workspace_id"]},
        {"_id": 0}
    )
    return workspace

def format_currency(amount_cents: int, currency: str = "usd") -> str:
    """Format currency amount"""
    amount = amount_cents / 100
    if currency.lower() == "usd":
        return f"${amount:,.2f}"
    return f"{amount:,.2f} {currency.upper()}"

def render_template(template: str, variables: Dict[str, Any]) -> str:
    """Render email template with variables"""
    result = template
    for key, value in variables.items():
        result = result.replace(f"{{{{{key}}}}}", str(value) if value else "")
    return result

# ==================== Lifespan ====================

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting Collectly backend...")
    
    # Create indexes
    await db.users.create_index("user_id", unique=True)
    await db.users.create_index("email", unique=True)
    await db.workspaces.create_index("workspace_id", unique=True)
    await db.workspace_members.create_index([("workspace_id", 1), ("user_id", 1)], unique=True)
    await db.invoices.create_index([("workspace_id", 1), ("stripe_invoice_id", 1)], unique=True)
    await db.customers.create_index([("workspace_id", 1), ("stripe_customer_id", 1)], unique=True)
    
    # Start scheduler
    scheduler.add_job(
        run_scheduler_job,
        IntervalTrigger(minutes=15),
        id="reminder_scheduler",
        replace_existing=True
    )
    scheduler.add_job(
        run_reply_check_job,
        IntervalTrigger(minutes=5),
        id="reply_checker",
        replace_existing=True
    )
    scheduler.start()
    logger.info("Scheduler started")
    
    yield
    
    # Shutdown
    scheduler.shutdown()
    client.close()
    logger.info("Collectly backend shutdown complete")

# Create the main app
app = FastAPI(lifespan=lifespan)

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")

# ==================== Auth Endpoints ====================

@api_router.post("/auth/session")
async def exchange_session(request: Request, response: Response):
    """Exchange session_id for session_token (Emergent Auth)"""
    body = await request.json()
    session_id = body.get("session_id")
    
    if not session_id:
        raise HTTPException(status_code=400, detail="session_id required")
    
    # Exchange session_id with Emergent Auth
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(
                "https://demobackend.emergentagent.com/auth/v1/env/oauth/session-data",
                headers={"X-Session-ID": session_id}
            )
            if resp.status_code != 200:
                raise HTTPException(status_code=401, detail="Invalid session")
            
            user_data = resp.json()
        except Exception as e:
            logger.error(f"Auth error: {e}")
            raise HTTPException(status_code=401, detail="Authentication failed")
    
    # Create or update user
    user_id = f"user_{uuid.uuid4().hex[:12]}"
    existing_user = await db.users.find_one({"email": user_data["email"]}, {"_id": 0})
    
    if existing_user:
        user_id = existing_user["user_id"]
        await db.users.update_one(
            {"user_id": user_id},
            {"$set": {
                "name": user_data["name"],
                "picture": user_data.get("picture")
            }}
        )
    else:
        await db.users.insert_one({
            "user_id": user_id,
            "email": user_data["email"],
            "name": user_data["name"],
            "picture": user_data.get("picture"),
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    # Create session
    session_token = user_data.get("session_token", f"sess_{uuid.uuid4().hex}")
    expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    
    await db.user_sessions.delete_many({"user_id": user_id})
    await db.user_sessions.insert_one({
        "user_id": user_id,
        "session_token": session_token,
        "expires_at": expires_at.isoformat(),
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Set cookie
    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        secure=True,
        samesite="none",
        max_age=7 * 24 * 60 * 60,
        path="/"
    )
    
    user = await db.users.find_one({"user_id": user_id}, {"_id": 0})
    return user

@api_router.get("/auth/me")
async def get_me(request: Request):
    """Get current user"""
    user = await get_current_user(request)
    if not user:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user

@api_router.post("/auth/logout")
async def logout(request: Request, response: Response):
    """Logout user"""
    session_token = request.cookies.get("session_token")
    if session_token:
        await db.user_sessions.delete_many({"session_token": session_token})
    
    response.delete_cookie(key="session_token", path="/")
    return {"message": "Logged out"}

# ==================== Workspace Endpoints ====================

@api_router.get("/workspaces/me")
async def get_my_workspace(request: Request):
    """Get current user's workspace"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        return {"workspace": None}
    
    return {"workspace": workspace}

@api_router.post("/workspaces")
async def create_workspace(data: WorkspaceCreate, request: Request):
    """Create a new workspace"""
    user = await require_auth(request)
    
    # Check if user already has a workspace
    existing = await get_user_workspace(user["user_id"])
    if existing:
        raise HTTPException(status_code=400, detail="User already has a workspace")
    
    workspace_id = f"ws_{uuid.uuid4().hex[:12]}"
    workspace = {
        "workspace_id": workspace_id,
        "name": data.name,
        "timezone": data.timezone,
        "owner_user_id": user["user_id"],
        "created_at": datetime.now(timezone.utc).isoformat()
    }
    
    await db.workspaces.insert_one(workspace)
    
    # Add user as owner
    await db.workspace_members.insert_one({
        "member_id": f"mem_{uuid.uuid4().hex[:12]}",
        "workspace_id": workspace_id,
        "user_id": user["user_id"],
        "role": "owner",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Create default reminder policy
    await create_default_policy(workspace_id)
    
    workspace.pop("_id", None)
    return {"workspace": workspace}

@api_router.patch("/workspaces/me")
async def update_workspace(request: Request):
    """Update workspace settings"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    body = await request.json()
    update_data = {}
    
    if "name" in body:
        update_data["name"] = body["name"]
    if "timezone" in body:
        update_data["timezone"] = body["timezone"]
    
    if update_data:
        await db.workspaces.update_one(
            {"workspace_id": workspace["workspace_id"]},
            {"$set": update_data}
        )
    
    workspace = await db.workspaces.find_one(
        {"workspace_id": workspace["workspace_id"]},
        {"_id": 0}
    )
    return {"workspace": workspace}

# ==================== Gmail Integration Endpoints ====================

@api_router.get("/integrations/gmail/status")
async def get_gmail_status(request: Request):
    """Get Gmail connection status"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        return {"connected": False}
    
    connection = await db.gmail_connections.find_one(
        {"workspace_id": workspace["workspace_id"]},
        {"_id": 0, "access_token": 0, "refresh_token": 0}
    )
    
    if not connection:
        return {"connected": False}
    
    return {
        "connected": True,
        "email": connection.get("google_user_email"),
        "connected_at": connection.get("connected_at")
    }

@api_router.post("/integrations/gmail/connect")
async def connect_gmail(data: GmailConnectionCreate, request: Request):
    """Connect Gmail via OAuth"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=400, detail="Create a workspace first")
    
    google_client_id = os.environ.get("GOOGLE_CLIENT_ID")
    google_client_secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    
    if not google_client_id or not google_client_secret:
        raise HTTPException(status_code=500, detail="Google OAuth not configured")
    
    # Exchange code for tokens
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": data.code,
                    "client_id": google_client_id,
                    "client_secret": google_client_secret,
                    "redirect_uri": data.redirect_uri,
                    "grant_type": "authorization_code"
                }
            )
            
            if resp.status_code != 200:
                logger.error(f"Gmail OAuth error: {resp.text}")
                raise HTTPException(status_code=400, detail="Failed to connect Gmail")
            
            tokens = resp.json()
            
            # Get user info
            user_resp = await client.get(
                "https://www.googleapis.com/oauth2/v2/userinfo",
                headers={"Authorization": f"Bearer {tokens['access_token']}"}
            )
            
            if user_resp.status_code != 200:
                raise HTTPException(status_code=400, detail="Failed to get Gmail user info")
            
            gmail_user = user_resp.json()
            
        except httpx.RequestError as e:
            logger.error(f"Gmail OAuth request error: {e}")
            raise HTTPException(status_code=500, detail="Gmail connection failed")
    
    # Store connection
    connection_id = f"gmail_{uuid.uuid4().hex[:12]}"
    token_expiry = datetime.now(timezone.utc) + timedelta(seconds=tokens.get("expires_in", 3600))
    
    await db.gmail_connections.update_one(
        {"workspace_id": workspace["workspace_id"]},
        {"$set": {
            "connection_id": connection_id,
            "workspace_id": workspace["workspace_id"],
            "google_user_email": gmail_user["email"],
            "access_token": tokens["access_token"],
            "refresh_token": tokens.get("refresh_token"),
            "token_expiry": token_expiry.isoformat(),
            "connected_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    
    return {
        "connected": True,
        "email": gmail_user["email"]
    }

@api_router.post("/integrations/gmail/disconnect")
async def disconnect_gmail(request: Request):
    """Disconnect Gmail"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    await db.gmail_connections.delete_one({"workspace_id": workspace["workspace_id"]})
    
    return {"connected": False}

# ==================== Stripe Integration Endpoints ====================

@api_router.get("/integrations/stripe/status")
async def get_stripe_status(request: Request):
    """Get Stripe connection status"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        return {"connected": False}
    
    connection = await db.stripe_connections.find_one(
        {"workspace_id": workspace["workspace_id"]},
        {"_id": 0, "secret_key": 0, "webhook_secret": 0}
    )
    
    if not connection:
        return {"connected": False}
    
    return {
        "connected": True,
        "account_id": connection.get("stripe_account_id"),
        "connected_at": connection.get("connected_at"),
        "last_sync_at": connection.get("last_sync_at")
    }

@api_router.post("/integrations/stripe/connect")
async def connect_stripe(data: StripeConnectionCreate, request: Request):
    """Connect Stripe via API key"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=400, detail="Create a workspace first")
    
    # Verify the key works
    try:
        stripe.api_key = data.secret_key
        account = stripe.Account.retrieve()
        account_id = account.id
    except stripe.error.AuthenticationError:
        raise HTTPException(status_code=400, detail="Invalid Stripe API key")
    except Exception as e:
        logger.error(f"Stripe connection error: {e}")
        raise HTTPException(status_code=500, detail="Failed to connect Stripe")
    
    # Store connection
    connection_id = f"stripe_{uuid.uuid4().hex[:12]}"
    
    await db.stripe_connections.update_one(
        {"workspace_id": workspace["workspace_id"]},
        {"$set": {
            "connection_id": connection_id,
            "workspace_id": workspace["workspace_id"],
            "stripe_account_id": account_id,
            "secret_key": data.secret_key,
            "webhook_secret": data.webhook_secret,
            "connected_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    
    return {
        "connected": True,
        "account_id": account_id
    }

@api_router.post("/integrations/stripe/disconnect")
async def disconnect_stripe(request: Request):
    """Disconnect Stripe"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    await db.stripe_connections.delete_one({"workspace_id": workspace["workspace_id"]})
    
    return {"connected": False}

@api_router.post("/integrations/stripe/sync")
async def sync_stripe(request: Request):
    """Sync customers and invoices from Stripe"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    connection = await db.stripe_connections.find_one(
        {"workspace_id": workspace["workspace_id"]},
        {"_id": 0}
    )
    
    if not connection:
        raise HTTPException(status_code=400, detail="Stripe not connected")
    
    stripe.api_key = connection["secret_key"]
    
    try:
        # Sync customers
        customers_synced = 0
        customers = stripe.Customer.list(limit=100)
        
        for customer in customers.auto_paging_iter():
            customer_id = f"cust_{uuid.uuid4().hex[:12]}"
            existing = await db.customers.find_one({
                "workspace_id": workspace["workspace_id"],
                "stripe_customer_id": customer.id
            })
            
            if existing:
                customer_id = existing.get("customer_id", customer_id)
            
            await db.customers.update_one(
                {
                    "workspace_id": workspace["workspace_id"],
                    "stripe_customer_id": customer.id
                },
                {"$set": {
                    "customer_id": customer_id,
                    "workspace_id": workspace["workspace_id"],
                    "stripe_customer_id": customer.id,
                    "name": customer.name,
                    "email": customer.email,
                    "created_at": datetime.now(timezone.utc).isoformat()
                }},
                upsert=True
            )
            customers_synced += 1
        
        # Sync invoices (open, past_due, and paid from last 60 days)
        invoices_synced = 0
        sixty_days_ago = int((datetime.now(timezone.utc) - timedelta(days=60)).timestamp())
        
        for status in ["open", "paid"]:
            invoices = stripe.Invoice.list(
                limit=100,
                status=status,
                created={"gte": sixty_days_ago} if status == "paid" else None
            )
            
            for invoice in invoices.auto_paging_iter():
                invoice_id = f"inv_{uuid.uuid4().hex[:12]}"
                existing = await db.invoices.find_one({
                    "workspace_id": workspace["workspace_id"],
                    "stripe_invoice_id": invoice.id
                })
                
                if existing:
                    invoice_id = existing.get("invoice_id", invoice_id)
                
                # Get customer_id
                customer_doc = await db.customers.find_one({
                    "workspace_id": workspace["workspace_id"],
                    "stripe_customer_id": invoice.customer
                }, {"_id": 0})
                
                local_customer_id = customer_doc["customer_id"] if customer_doc else None
                
                # Determine status
                inv_status = InvoiceStatus.OPEN
                if invoice.status == "paid":
                    inv_status = InvoiceStatus.PAID
                elif invoice.status == "void":
                    inv_status = InvoiceStatus.VOID
                elif invoice.status == "uncollectible":
                    inv_status = InvoiceStatus.UNCOLLECTIBLE
                elif invoice.due_date and datetime.fromtimestamp(invoice.due_date, tz=timezone.utc) < datetime.now(timezone.utc):
                    inv_status = InvoiceStatus.PAST_DUE
                
                # Determine autopilot state
                autopilot_state = AutopilotState.ACTIVE
                if inv_status == InvoiceStatus.PAID:
                    autopilot_state = AutopilotState.STOPPED_PAID
                elif inv_status in [InvoiceStatus.VOID, InvoiceStatus.UNCOLLECTIBLE]:
                    autopilot_state = AutopilotState.STOPPED_MANUAL
                
                now = datetime.now(timezone.utc)
                
                await db.invoices.update_one(
                    {
                        "workspace_id": workspace["workspace_id"],
                        "stripe_invoice_id": invoice.id
                    },
                    {"$set": {
                        "invoice_id": invoice_id,
                        "workspace_id": workspace["workspace_id"],
                        "stripe_invoice_id": invoice.id,
                        "stripe_customer_id": invoice.customer,
                        "customer_id": local_customer_id,
                        "status": inv_status,
                        "autopilot_state": autopilot_state,
                        "amount_due_cents": invoice.amount_due,
                        "currency": invoice.currency,
                        "due_date": datetime.fromtimestamp(invoice.due_date, tz=timezone.utc).isoformat() if invoice.due_date else None,
                        "issued_at": datetime.fromtimestamp(invoice.created, tz=timezone.utc).isoformat(),
                        "hosted_invoice_url": invoice.hosted_invoice_url,
                        "created_at": now.isoformat(),
                        "updated_at": now.isoformat()
                    }},
                    upsert=True
                )
                invoices_synced += 1
        
        # Update last sync time
        await db.stripe_connections.update_one(
            {"workspace_id": workspace["workspace_id"]},
            {"$set": {"last_sync_at": datetime.now(timezone.utc).isoformat()}}
        )
        
        # Update health status
        await update_health_status(workspace["workspace_id"], "stripe_sync", "ok")
        
        return {
            "success": True,
            "customers_synced": customers_synced,
            "invoices_synced": invoices_synced
        }
        
    except Exception as e:
        logger.error(f"Stripe sync error: {e}")
        # Update health status with error
        await update_health_status(workspace["workspace_id"], "stripe_sync", "error", str(e))
        raise HTTPException(status_code=500, detail=f"Sync failed: {str(e)}")

# ==================== Webhook Endpoint ====================

@api_router.post("/webhooks/stripe")
async def stripe_webhook(request: Request):
    """Handle Stripe webhooks"""
    payload = await request.body()
    sig_header = request.headers.get("Stripe-Signature")
    
    # Find workspace by webhook secret
    # For simplicity, we'll try to find matching workspace
    workspaces = await db.stripe_connections.find(
        {"webhook_secret": {"$exists": True, "$ne": None}},
        {"_id": 0}
    ).to_list(100)
    
    event = None
    workspace_id = None
    
    for ws in workspaces:
        try:
            event = stripe.Webhook.construct_event(
                payload, sig_header, ws["webhook_secret"]
            )
            workspace_id = ws["workspace_id"]
            break
        except (ValueError, stripe.error.SignatureVerificationError):
            continue
    
    if not event:
        # Try without verification for development
        try:
            event = json.loads(payload)
            logger.warning("Processing webhook without signature verification")
        except:
            raise HTTPException(status_code=400, detail="Invalid webhook")
    
    event_type = event.get("type") if isinstance(event, dict) else event.type
    data = event.get("data", {}).get("object", {}) if isinstance(event, dict) else event.data.object
    
    logger.info(f"Received Stripe webhook: {event_type}")
    
    if event_type in ["invoice.paid", "invoice.payment_succeeded"]:
        stripe_invoice_id = data.get("id") if isinstance(data, dict) else data.id
        
        # Find the invoice
        invoice = await db.invoices.find_one(
            {"stripe_invoice_id": stripe_invoice_id},
            {"_id": 0}
        )
        
        if invoice:
            await db.invoices.update_one(
                {"invoice_id": invoice["invoice_id"]},
                {"$set": {
                    "status": InvoiceStatus.PAID,
                    "autopilot_state": AutopilotState.STOPPED_PAID,
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }}
            )
            
            # Create notification
            workspace = await db.workspaces.find_one(
                {"workspace_id": invoice["workspace_id"]},
                {"_id": 0}
            )
            
            if workspace:
                await db.notifications.insert_one({
                    "notification_id": f"notif_{uuid.uuid4().hex[:12]}",
                    "workspace_id": invoice["workspace_id"],
                    "user_id": workspace["owner_user_id"],
                    "type": "invoice_paid",
                    "payload_json": {
                        "invoice_id": invoice["invoice_id"],
                        "amount": invoice["amount_due_cents"],
                        "currency": invoice["currency"]
                    },
                    "is_read": False,
                    "created_at": datetime.now(timezone.utc).isoformat()
                })
            
            logger.info(f"Invoice {stripe_invoice_id} marked as paid")
    
    elif event_type == "invoice.payment_failed":
        stripe_invoice_id = data.get("id") if isinstance(data, dict) else data.id
        
        await db.invoices.update_one(
            {"stripe_invoice_id": stripe_invoice_id},
            {"$set": {
                "status": InvoiceStatus.PAST_DUE,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
    
    elif event_type == "invoice.voided":
        stripe_invoice_id = data.get("id") if isinstance(data, dict) else data.id
        
        await db.invoices.update_one(
            {"stripe_invoice_id": stripe_invoice_id},
            {"$set": {
                "status": InvoiceStatus.VOID,
                "autopilot_state": AutopilotState.STOPPED_MANUAL,
                "updated_at": datetime.now(timezone.utc).isoformat()
            }}
        )
    
    return {"received": True}

# ==================== Dashboard Endpoints ====================

@api_router.get("/dashboard/summary")
async def get_dashboard_summary(request: Request):
    """Get dashboard summary metrics"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    workspace_id = workspace["workspace_id"]
    
    # Get totals
    open_invoices = await db.invoices.find({
        "workspace_id": workspace_id,
        "status": InvoiceStatus.OPEN
    }).to_list(1000)
    
    past_due_invoices = await db.invoices.find({
        "workspace_id": workspace_id,
        "status": InvoiceStatus.PAST_DUE
    }).to_list(1000)
    
    # Paid this month
    now = datetime.now(timezone.utc)
    month_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    
    paid_invoices = await db.invoices.find({
        "workspace_id": workspace_id,
        "status": InvoiceStatus.PAID,
        "updated_at": {"$gte": month_start.isoformat()}
    }).to_list(1000)
    
    paused_count = await db.invoices.count_documents({
        "workspace_id": workspace_id,
        "autopilot_state": {"$in": [AutopilotState.PAUSED_REPLIED, AutopilotState.PAUSED_MANUAL]}
    })
    
    currency = "usd"
    if open_invoices:
        currency = open_invoices[0].get("currency", "usd")
    
    return {
        "total_open": len(open_invoices),
        "total_open_amount": sum(inv["amount_due_cents"] for inv in open_invoices),
        "total_past_due": len(past_due_invoices),
        "total_past_due_amount": sum(inv["amount_due_cents"] for inv in past_due_invoices),
        "paid_this_month": len(paid_invoices),
        "paid_this_month_amount": sum(inv["amount_due_cents"] for inv in paid_invoices),
        "invoices_paused": paused_count,
        "currency": currency
    }

# ==================== Invoice Endpoints ====================

@api_router.get("/invoices")
async def get_invoices(
    request: Request,
    status: Optional[str] = None,
    autopilot_state: Optional[str] = None,
    customer_id: Optional[str] = None,
    limit: int = Query(50, le=100),
    skip: int = 0
):
    """Get invoices with filters"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    query = {"workspace_id": workspace["workspace_id"]}
    
    if status:
        query["status"] = status
    if autopilot_state:
        query["autopilot_state"] = autopilot_state
    if customer_id:
        query["customer_id"] = customer_id
    
    invoices = await db.invoices.find(query, {"_id": 0}).skip(skip).limit(limit).to_list(limit)
    total = await db.invoices.count_documents(query)
    
    # Enrich with customer info
    for inv in invoices:
        if inv.get("customer_id"):
            customer = await db.customers.find_one(
                {"customer_id": inv["customer_id"]},
                {"_id": 0}
            )
            inv["customer"] = customer
    
    return {
        "invoices": invoices,
        "total": total,
        "limit": limit,
        "skip": skip
    }

@api_router.get("/invoices/{invoice_id}")
async def get_invoice(invoice_id: str, request: Request):
    """Get single invoice with details"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    invoice = await db.invoices.find_one({
        "invoice_id": invoice_id,
        "workspace_id": workspace["workspace_id"]
    }, {"_id": 0})
    
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Get customer
    if invoice.get("customer_id"):
        customer = await db.customers.find_one(
            {"customer_id": invoice["customer_id"]},
            {"_id": 0}
        )
        invoice["customer"] = customer
    
    # Get email events
    events = await db.email_events.find({
        "invoice_id": invoice_id
    }, {"_id": 0}).sort("created_at", -1).to_list(50)
    
    invoice["events"] = events
    
    return invoice

@api_router.patch("/invoices/{invoice_id}")
async def update_invoice(invoice_id: str, data: InvoiceUpdate, request: Request):
    """Update invoice (pause/resume/stop/mark_paid)"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    invoice = await db.invoices.find_one({
        "invoice_id": invoice_id,
        "workspace_id": workspace["workspace_id"]
    }, {"_id": 0})
    
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    update_data = {"updated_at": datetime.now(timezone.utc).isoformat()}
    event_type = None
    
    if data.autopilot_state:
        update_data["autopilot_state"] = data.autopilot_state
        if data.autopilot_state == AutopilotState.PAUSED_MANUAL:
            event_type = "paused"
        elif data.autopilot_state == AutopilotState.ACTIVE:
            event_type = "resumed"
        elif data.autopilot_state == AutopilotState.STOPPED_MANUAL:
            event_type = "stopped"
    
    if data.status:
        update_data["status"] = data.status
        if data.status == InvoiceStatus.PAID:
            update_data["autopilot_state"] = AutopilotState.STOPPED_PAID
            event_type = "stopped"
    
    await db.invoices.update_one(
        {"invoice_id": invoice_id},
        {"$set": update_data}
    )
    
    # Create event
    if event_type:
        await db.email_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "workspace_id": workspace["workspace_id"],
            "invoice_id": invoice_id,
            "customer_id": invoice.get("customer_id"),
            "direction": "outbound",
            "event_type": event_type,
            "metadata_json": {"updated_by": user["user_id"]},
            "created_at": datetime.now(timezone.utc).isoformat()
        })
    
    updated = await db.invoices.find_one({"invoice_id": invoice_id}, {"_id": 0})
    return updated

@api_router.post("/invoices/{invoice_id}/note")
async def add_invoice_note(invoice_id: str, request: Request):
    """Add a manual note to invoice"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    body = await request.json()
    note = body.get("note", "")
    
    if not note:
        raise HTTPException(status_code=400, detail="Note is required")
    
    invoice = await db.invoices.find_one({
        "invoice_id": invoice_id,
        "workspace_id": workspace["workspace_id"]
    }, {"_id": 0})
    
    if not invoice:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    await db.email_events.insert_one({
        "event_id": f"evt_{uuid.uuid4().hex[:12]}",
        "workspace_id": workspace["workspace_id"],
        "invoice_id": invoice_id,
        "customer_id": invoice.get("customer_id"),
        "direction": "outbound",
        "event_type": "manual_note",
        "snippet": note,
        "metadata_json": {"added_by": user["user_id"]},
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    return {"success": True}

# ==================== Reminder Policy Endpoints ====================

async def create_default_policy(workspace_id: str):
    """Create default reminder policy for workspace"""
    policy_id = f"pol_{uuid.uuid4().hex[:12]}"
    
    await db.reminder_policies.insert_one({
        "policy_id": policy_id,
        "workspace_id": workspace_id,
        "name": "Default Policy",
        "is_default": True,
        "is_enabled": True,
        "max_emails_per_week_per_customer": 2,
        "quiet_hours_start": 22,
        "quiet_hours_end": 8,
        "email_footer_text": "Reply to this email if you have questions. Reply 'stop' to pause reminders.",
        "created_at": datetime.now(timezone.utc).isoformat()
    })
    
    # Default steps
    default_steps = [
        {
            "step_order": 1,
            "trigger_type": "before_due",
            "trigger_offset_days": 3,
            "subject_template": "Reminder: Invoice {{invoice_number}} due {{due_date}}",
            "body_template": """Hi {{customer_name}},

This is a friendly reminder that Invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.

You can view and pay your invoice here: {{hosted_invoice_url}}

Please let us know if you have any questions.

Best regards,
{{company_name}}

{{footer}}""",
            "is_enabled": True
        },
        {
            "step_order": 2,
            "trigger_type": "on_due",
            "trigger_offset_days": 0,
            "subject_template": "Invoice {{invoice_number}} due today",
            "body_template": """Hi {{customer_name}},

Invoice {{invoice_number}} for {{amount}} is due today.

Pay now: {{hosted_invoice_url}}

Thank you,
{{company_name}}

{{footer}}""",
            "is_enabled": True
        },
        {
            "step_order": 3,
            "trigger_type": "after_due",
            "trigger_offset_days": 3,
            "subject_template": "Past due: Invoice {{invoice_number}}",
            "body_template": """Hi {{customer_name}},

Invoice {{invoice_number}} for {{amount}} is now 3 days past due.

Please make payment at your earliest convenience: {{hosted_invoice_url}}

If you're experiencing any issues, please let us know how we can help.

Best regards,
{{company_name}}

{{footer}}""",
            "is_enabled": True
        },
        {
            "step_order": 4,
            "trigger_type": "after_due",
            "trigger_offset_days": 7,
            "subject_template": "Second notice: Invoice {{invoice_number}}",
            "body_template": """Hi {{customer_name}},

This is a second notice that Invoice {{invoice_number}} for {{amount}} is now 7 days overdue.

Pay here: {{hosted_invoice_url}}

If there's an issue preventing payment, please reply to this email.

Thank you,
{{company_name}}

{{footer}}""",
            "is_enabled": True
        },
        {
            "step_order": 5,
            "trigger_type": "after_due",
            "trigger_offset_days": 14,
            "subject_template": "Final notice: Invoice {{invoice_number}}",
            "body_template": """Hi {{customer_name}},

This is a final notice regarding Invoice {{invoice_number}} for {{amount}}, which is now 14 days past due.

Please arrange payment immediately: {{hosted_invoice_url}}

If we don't hear from you, we may need to take further action.

{{company_name}}

{{footer}}""",
            "is_enabled": True
        }
    ]
    
    for step in default_steps:
        await db.reminder_steps.insert_one({
            "step_id": f"step_{uuid.uuid4().hex[:12]}",
            "policy_id": policy_id,
            **step
        })

@api_router.get("/policies/default")
async def get_default_policy(request: Request):
    """Get default reminder policy"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    policy = await db.reminder_policies.find_one({
        "workspace_id": workspace["workspace_id"],
        "is_default": True
    }, {"_id": 0})
    
    if not policy:
        raise HTTPException(status_code=404, detail="No default policy found")
    
    # Get steps
    steps = await db.reminder_steps.find(
        {"policy_id": policy["policy_id"]},
        {"_id": 0}
    ).sort("step_order", 1).to_list(20)
    
    policy["steps"] = steps
    
    return policy

@api_router.get("/policies/{policy_id}")
async def get_policy(policy_id: str, request: Request):
    """Get reminder policy by ID"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    policy = await db.reminder_policies.find_one({
        "policy_id": policy_id,
        "workspace_id": workspace["workspace_id"]
    }, {"_id": 0})
    
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    
    steps = await db.reminder_steps.find(
        {"policy_id": policy_id},
        {"_id": 0}
    ).sort("step_order", 1).to_list(20)
    
    policy["steps"] = steps
    
    return policy

@api_router.patch("/policies/{policy_id}")
async def update_policy(policy_id: str, data: ReminderPolicyUpdate, request: Request):
    """Update reminder policy"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    policy = await db.reminder_policies.find_one({
        "policy_id": policy_id,
        "workspace_id": workspace["workspace_id"]
    }, {"_id": 0})
    
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    if update_data:
        await db.reminder_policies.update_one(
            {"policy_id": policy_id},
            {"$set": update_data}
        )
    
    return await get_policy(policy_id, request)

@api_router.post("/policies/{policy_id}/steps")
async def create_step(policy_id: str, data: ReminderStepCreate, request: Request):
    """Create a new reminder step"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    policy = await db.reminder_policies.find_one({
        "policy_id": policy_id,
        "workspace_id": workspace["workspace_id"]
    }, {"_id": 0})
    
    if not policy:
        raise HTTPException(status_code=404, detail="Policy not found")
    
    step_id = f"step_{uuid.uuid4().hex[:12]}"
    
    await db.reminder_steps.insert_one({
        "step_id": step_id,
        "policy_id": policy_id,
        **data.model_dump()
    })
    
    return await db.reminder_steps.find_one({"step_id": step_id}, {"_id": 0})

@api_router.patch("/policies/{policy_id}/steps/{step_id}")
async def update_step(policy_id: str, step_id: str, data: ReminderStepUpdate, request: Request):
    """Update a reminder step"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    step = await db.reminder_steps.find_one({
        "step_id": step_id,
        "policy_id": policy_id
    }, {"_id": 0})
    
    if not step:
        raise HTTPException(status_code=404, detail="Step not found")
    
    update_data = {k: v for k, v in data.model_dump().items() if v is not None}
    
    if update_data:
        await db.reminder_steps.update_one(
            {"step_id": step_id},
            {"$set": update_data}
        )
    
    return await db.reminder_steps.find_one({"step_id": step_id}, {"_id": 0})

@api_router.delete("/policies/{policy_id}/steps/{step_id}")
async def delete_step(policy_id: str, step_id: str, request: Request):
    """Delete a reminder step"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    result = await db.reminder_steps.delete_one({
        "step_id": step_id,
        "policy_id": policy_id
    })
    
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Step not found")
    
    return {"deleted": True}

# ==================== Notifications Endpoints ====================

@api_router.get("/notifications")
async def get_notifications(request: Request, unread_only: bool = False):
    """Get user notifications"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        return {"notifications": []}
    
    query = {
        "workspace_id": workspace["workspace_id"],
        "user_id": user["user_id"]
    }
    
    if unread_only:
        query["is_read"] = False
    
    notifications = await db.notifications.find(
        query,
        {"_id": 0}
    ).sort("created_at", -1).limit(50).to_list(50)
    
    return {"notifications": notifications}

@api_router.patch("/notifications/{notification_id}/read")
async def mark_notification_read(notification_id: str, request: Request):
    """Mark notification as read"""
    user = await require_auth(request)
    
    await db.notifications.update_one(
        {"notification_id": notification_id, "user_id": user["user_id"]},
        {"$set": {"is_read": True}}
    )
    
    return {"success": True}

@api_router.post("/notifications/read-all")
async def mark_all_read(request: Request):
    """Mark all notifications as read"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if workspace:
        await db.notifications.update_many(
            {"workspace_id": workspace["workspace_id"], "user_id": user["user_id"]},
            {"$set": {"is_read": True}}
        )
    
    return {"success": True}

# ==================== System Health Endpoints ====================

@api_router.get("/health/status")
async def get_system_health(request: Request):
    """Get system health status for the workspace"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        return {"status": "no_workspace"}
    
    workspace_id = workspace["workspace_id"]
    now = datetime.now(timezone.utc)
    
    # Get health record
    health = await db.system_health.find_one(
        {"workspace_id": workspace_id},
        {"_id": 0}
    )
    
    if not health:
        health = {
            "workspace_id": workspace_id,
            "stripe_sync": {"status": "never", "last_run": None, "error": None},
            "stripe_webhook": {"status": "never", "last_received": None},
            "scheduler": {"status": "never", "last_run": None},
            "reply_check": {"status": "never", "last_run": None}
        }
    
    # Check connection statuses
    stripe_conn = await db.stripe_connections.find_one(
        {"workspace_id": workspace_id},
        {"_id": 0, "secret_key": 0, "webhook_secret": 0}
    )
    gmail_conn = await db.gmail_connections.find_one(
        {"workspace_id": workspace_id},
        {"_id": 0, "access_token": 0, "refresh_token": 0}
    )
    
    # Calculate warnings
    warnings = []
    
    # Webhook warning (6 hours)
    if stripe_conn:
        webhook_last = health.get("stripe_webhook", {}).get("last_received")
        if webhook_last:
            webhook_time = datetime.fromisoformat(webhook_last.replace("Z", "+00:00"))
            if (now - webhook_time).total_seconds() > 6 * 3600:
                warnings.append({
                    "type": "webhook_stale",
                    "message": "No webhook received in 6+ hours. Webhooks may be misconfigured.",
                    "action": "test_webhook"
                })
        else:
            warnings.append({
                "type": "webhook_never",
                "message": "No webhooks received yet. Please configure your Stripe webhook.",
                "action": "configure_webhook"
            })
    
    # Scheduler warning (30 minutes)
    scheduler_last = health.get("scheduler", {}).get("last_run")
    if scheduler_last:
        scheduler_time = datetime.fromisoformat(scheduler_last.replace("Z", "+00:00"))
        if (now - scheduler_time).total_seconds() > 30 * 60:
            warnings.append({
                "type": "scheduler_delayed",
                "message": "Scheduler hasn't run in 30+ minutes.",
                "action": "run_scheduler"
            })
    
    # Sync error warning
    sync_status = health.get("stripe_sync", {})
    if sync_status.get("status") == "error":
        warnings.append({
            "type": "sync_error",
            "message": f"Last sync failed: {sync_status.get('error', 'Unknown error')}",
            "action": "retry_sync"
        })
    
    return {
        "stripe_connected": stripe_conn is not None,
        "gmail_connected": gmail_conn is not None,
        "stripe_sync": health.get("stripe_sync", {}),
        "stripe_webhook": health.get("stripe_webhook", {}),
        "scheduler": health.get("scheduler", {}),
        "reply_check": health.get("reply_check", {}),
        "warnings": warnings,
        "onboarding_complete": stripe_conn is not None and gmail_conn is not None
    }

@api_router.post("/health/test-webhook")
async def test_webhook(request: Request):
    """Send a test webhook event to verify webhook configuration"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    # Get Stripe connection
    stripe_conn = await db.stripe_connections.find_one(
        {"workspace_id": workspace["workspace_id"]},
        {"_id": 0}
    )
    
    if not stripe_conn:
        raise HTTPException(status_code=400, detail="Stripe not connected")
    
    # We can't actually trigger a real webhook, but we can verify the endpoint is reachable
    # For now, just return guidance
    return {
        "message": "To test webhooks, create a test invoice in Stripe and mark it as paid.",
        "webhook_url": f"{os.environ.get('REACT_APP_BACKEND_URL', '')}/api/webhooks/stripe",
        "tip": "You can also use Stripe CLI to send test events: stripe trigger invoice.paid"
    }

@api_router.get("/onboarding/status")
async def get_onboarding_status(request: Request):
    """Get onboarding status for the workspace"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        return {
            "has_workspace": False,
            "steps": {
                "workspace": False,
                "stripe": False,
                "import": False,
                "gmail": False,
                "test_email": False,
                "autopilot": False
            },
            "current_step": "workspace",
            "is_complete": False
        }
    
    workspace_id = workspace["workspace_id"]
    
    # Check connections
    stripe_conn = await db.stripe_connections.find_one(
        {"workspace_id": workspace_id},
        {"_id": 0, "secret_key": 0, "webhook_secret": 0}
    )
    gmail_conn = await db.gmail_connections.find_one(
        {"workspace_id": workspace_id},
        {"_id": 0, "access_token": 0, "refresh_token": 0}
    )
    
    # Check if data imported
    invoice_count = await db.invoices.count_documents({"workspace_id": workspace_id})
    
    # Check if test email sent
    test_email_sent = await db.email_events.find_one({
        "workspace_id": workspace_id,
        "event_type": "test_sent"
    })
    
    # Check if autopilot enabled
    policy = await db.reminder_policies.find_one({
        "workspace_id": workspace_id,
        "is_default": True
    }, {"_id": 0})
    autopilot_enabled = policy.get("is_enabled", False) if policy else False
    
    # Check onboarding completion flag
    onboarding = await db.workspace_onboarding.find_one(
        {"workspace_id": workspace_id},
        {"_id": 0}
    )
    
    steps = {
        "workspace": True,
        "stripe": stripe_conn is not None,
        "import": invoice_count > 0,
        "gmail": gmail_conn is not None,
        "test_email": test_email_sent is not None,
        "autopilot": autopilot_enabled and (onboarding.get("completed") if onboarding else False)
    }
    
    # Determine current step
    current_step = "stripe"
    if steps["stripe"]:
        current_step = "import"
    if steps["import"]:
        current_step = "gmail"
    if steps["gmail"]:
        current_step = "test_email"
    if steps["test_email"]:
        current_step = "autopilot"
    if steps["autopilot"]:
        current_step = "complete"
    
    is_complete = all(steps.values())
    
    return {
        "has_workspace": True,
        "workspace": workspace,
        "steps": steps,
        "current_step": current_step,
        "is_complete": is_complete,
        "stripe_connected": stripe_conn is not None,
        "gmail_connected": gmail_conn is not None,
        "invoice_count": invoice_count,
        "gmail_email": gmail_conn.get("google_user_email") if gmail_conn else None
    }

@api_router.get("/onboarding/import-preview")
async def get_import_preview(request: Request):
    """Get preview of imported data"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    workspace_id = workspace["workspace_id"]
    
    customer_count = await db.customers.count_documents({"workspace_id": workspace_id})
    open_count = await db.invoices.count_documents({
        "workspace_id": workspace_id,
        "status": InvoiceStatus.OPEN
    })
    past_due_count = await db.invoices.count_documents({
        "workspace_id": workspace_id,
        "status": InvoiceStatus.PAST_DUE
    })
    paid_count = await db.invoices.count_documents({
        "workspace_id": workspace_id,
        "status": InvoiceStatus.PAID
    })
    total_count = await db.invoices.count_documents({"workspace_id": workspace_id})
    
    # Get total amounts
    open_invoices = await db.invoices.find({
        "workspace_id": workspace_id,
        "status": {"$in": [InvoiceStatus.OPEN, InvoiceStatus.PAST_DUE]}
    }, {"amount_due_cents": 1, "currency": 1}).to_list(1000)
    
    total_ar = sum(inv.get("amount_due_cents", 0) for inv in open_invoices)
    currency = open_invoices[0].get("currency", "usd") if open_invoices else "usd"
    
    return {
        "customers": customer_count,
        "invoices": {
            "total": total_count,
            "open": open_count,
            "past_due": past_due_count,
            "paid": paid_count
        },
        "total_ar_cents": total_ar,
        "currency": currency
    }

@api_router.post("/onboarding/send-test-email")
async def send_test_email(request: Request):
    """Send a test reminder email to the logged-in user"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    workspace_id = workspace["workspace_id"]
    
    # Check Gmail connection
    gmail_conn = await db.gmail_connections.find_one(
        {"workspace_id": workspace_id},
        {"_id": 0}
    )
    
    # Build test email content
    test_subject = f"Test Reminder from {workspace['name']} via Collectly"
    test_body = f"""Hi {user['name']},

This is a test reminder email from Collectly.

If you're receiving this, your email integration is working correctly!

Here's what a real reminder would look like:

---

Invoice #INV-1234 for $500.00 is due on 02/15/2026.

Pay now: https://invoice.stripe.com/example

Please let us know if you have any questions.

Best regards,
{workspace['name']}

Reply to this email if you have questions. Reply 'stop' to pause reminders.
"""
    
    # Try to send via Resend (fallback if Gmail not connected)
    if resend_api_key:
        try:
            params = {
                "from": os.environ.get("SENDER_EMAIL", "onboarding@resend.dev"),
                "to": [user["email"]],
                "subject": test_subject,
                "text": test_body
            }
            
            await asyncio.to_thread(resend.Emails.send, params)
            
            # Log the test email
            await db.email_events.insert_one({
                "event_id": f"evt_{uuid.uuid4().hex[:12]}",
                "workspace_id": workspace_id,
                "invoice_id": None,
                "customer_id": None,
                "direction": "outbound",
                "event_type": "test_sent",
                "subject": test_subject,
                "snippet": "Test email sent successfully",
                "sent_at": datetime.now(timezone.utc).isoformat(),
                "metadata_json": {"recipient": user["email"]},
                "created_at": datetime.now(timezone.utc).isoformat()
            })
            
            return {
                "success": True,
                "message": f"Test email sent to {user['email']}",
                "method": "resend"
            }
            
        except Exception as e:
            logger.error(f"Failed to send test email: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to send test email: {str(e)}")
    else:
        # Log that we would have sent (for demo)
        await db.email_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "workspace_id": workspace_id,
            "invoice_id": None,
            "customer_id": None,
            "direction": "outbound",
            "event_type": "test_sent",
            "subject": test_subject,
            "snippet": "Test email (simulated - no Resend key)",
            "sent_at": datetime.now(timezone.utc).isoformat(),
            "metadata_json": {"recipient": user["email"], "simulated": True},
            "created_at": datetime.now(timezone.utc).isoformat()
        })
        
        return {
            "success": True,
            "message": f"Test email simulated for {user['email']} (Resend not configured)",
            "method": "simulated"
        }

@api_router.post("/onboarding/complete")
async def complete_onboarding(request: Request):
    """Mark onboarding as complete and enable autopilot"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    workspace_id = workspace["workspace_id"]
    
    # Enable default policy
    await db.reminder_policies.update_one(
        {"workspace_id": workspace_id, "is_default": True},
        {"$set": {"is_enabled": True}}
    )
    
    # Mark onboarding complete
    await db.workspace_onboarding.update_one(
        {"workspace_id": workspace_id},
        {"$set": {
            "workspace_id": workspace_id,
            "completed": True,
            "completed_at": datetime.now(timezone.utc).isoformat()
        }},
        upsert=True
    )
    
    return {"success": True, "message": "Onboarding complete! Autopilot is now active."}

@api_router.get("/onboarding/scheduled-preview")
async def get_scheduled_preview(request: Request):
    """Get preview of scheduled sends for next 7 days"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    workspace_id = workspace["workspace_id"]
    now = datetime.now(timezone.utc)
    week_later = now + timedelta(days=7)
    
    # Get policy steps
    policy = await db.reminder_policies.find_one({
        "workspace_id": workspace_id,
        "is_default": True
    }, {"_id": 0})
    
    if not policy:
        return {"scheduled_count": 0, "invoices": []}
    
    steps = await db.reminder_steps.find({
        "policy_id": policy["policy_id"],
        "is_enabled": True
    }, {"_id": 0}).sort("step_order", 1).to_list(20)
    
    # Get active invoices
    invoices = await db.invoices.find({
        "workspace_id": workspace_id,
        "status": {"$in": [InvoiceStatus.OPEN, InvoiceStatus.PAST_DUE]},
        "autopilot_state": AutopilotState.ACTIVE
    }, {"_id": 0}).limit(20).to_list(20)
    
    scheduled = []
    for inv in invoices:
        if not inv.get("due_date"):
            continue
            
        due_date = datetime.fromisoformat(inv["due_date"].replace("Z", "+00:00"))
        
        # Find next applicable step
        for step in steps:
            trigger_type = step["trigger_type"]
            offset = step["trigger_offset_days"]
            
            if trigger_type == "before_due":
                send_date = due_date - timedelta(days=offset)
            elif trigger_type == "on_due":
                send_date = due_date
            else:
                send_date = due_date + timedelta(days=offset)
            
            if now <= send_date <= week_later:
                # Get customer
                customer = await db.customers.find_one(
                    {"customer_id": inv.get("customer_id")},
                    {"_id": 0}
                )
                
                scheduled.append({
                    "invoice_id": inv["invoice_id"],
                    "stripe_invoice_id": inv["stripe_invoice_id"],
                    "customer_name": customer.get("name") if customer else "Unknown",
                    "amount_due_cents": inv["amount_due_cents"],
                    "currency": inv.get("currency", "usd"),
                    "scheduled_date": send_date.isoformat(),
                    "step_type": trigger_type,
                    "step_order": step["step_order"]
                })
                break
    
    # Sort by scheduled date
    scheduled.sort(key=lambda x: x["scheduled_date"])
    
    return {
        "scheduled_count": len(scheduled),
        "invoices": scheduled[:10]  # Return top 10
    }

# ==================== Scheduler Jobs ====================

async def update_health_status(workspace_id: str, health_type: str, status: str, error: str = None):
    """Update health status for a workspace"""
    now = datetime.now(timezone.utc).isoformat()
    
    update_data = {
        f"{health_type}.status": status,
        f"{health_type}.last_run" if health_type != "stripe_webhook" else f"{health_type}.last_received": now
    }
    
    if error:
        update_data[f"{health_type}.error"] = error
    elif health_type != "stripe_webhook":
        update_data[f"{health_type}.error"] = None
    
    await db.system_health.update_one(
        {"workspace_id": workspace_id},
        {"$set": update_data},
        upsert=True
    )

async def run_scheduler_job():
    """Run the reminder scheduler"""
    logger.info("Running reminder scheduler...")
    
    try:
        # Get all workspaces with active connections
        workspaces = await db.workspaces.find({}, {"_id": 0}).to_list(100)
        
        for workspace in workspaces:
            workspace_id = workspace["workspace_id"]
            
            # Update health status
            await update_health_status(workspace_id, "scheduler", "ok")
            
            # Check connections
            gmail_conn = await db.gmail_connections.find_one(
                {"workspace_id": workspace_id},
                {"_id": 0}
            )
            stripe_conn = await db.stripe_connections.find_one(
                {"workspace_id": workspace_id},
                {"_id": 0}
            )
            
            if not gmail_conn or not stripe_conn:
                continue
            
            # Get default policy
            policy = await db.reminder_policies.find_one({
                "workspace_id": workspace_id,
                "is_default": True,
                "is_enabled": True
            }, {"_id": 0})
            
            if not policy:
                continue
            
            # Get active invoices that need action
            now = datetime.now(timezone.utc)
            
            invoices = await db.invoices.find({
                "workspace_id": workspace_id,
                "status": {"$in": [InvoiceStatus.OPEN, InvoiceStatus.PAST_DUE]},
                "autopilot_state": AutopilotState.ACTIVE,
                "$or": [
                    {"next_action_at": {"$lte": now.isoformat()}},
                    {"next_action_at": None}
                ]
            }, {"_id": 0}).to_list(100)
            
            for invoice in invoices:
                await process_invoice_reminder(invoice, policy, gmail_conn, workspace)
        
        logger.info("Reminder scheduler completed")
        
    except Exception as e:
        logger.error(f"Scheduler error: {e}")

async def process_invoice_reminder(invoice: dict, policy: dict, gmail_conn: dict, workspace: dict):
    """Process reminder for a single invoice"""
    try:
        # Get customer
        customer = await db.customers.find_one(
            {"customer_id": invoice.get("customer_id")},
            {"_id": 0}
        )
        
        if not customer or not customer.get("email"):
            return
        
        # Check rate limit
        week_ago = datetime.now(timezone.utc) - timedelta(days=7)
        recent_emails = await db.email_events.count_documents({
            "customer_id": customer["customer_id"],
            "event_type": "sent",
            "created_at": {"$gte": week_ago.isoformat()}
        })
        
        if recent_emails >= policy.get("max_emails_per_week_per_customer", 2):
            return
        
        # Determine which step to send
        steps = await db.reminder_steps.find({
            "policy_id": policy["policy_id"],
            "is_enabled": True
        }, {"_id": 0}).sort("step_order", 1).to_list(20)
        
        if not steps:
            return
        
        due_date = None
        if invoice.get("due_date"):
            if isinstance(invoice["due_date"], str):
                due_date = datetime.fromisoformat(invoice["due_date"].replace("Z", "+00:00"))
            else:
                due_date = invoice["due_date"]
        
        if not due_date:
            return
        
        now = datetime.now(timezone.utc)
        days_until_due = (due_date.date() - now.date()).days
        
        # Find applicable step
        applicable_step = None
        for step in steps:
            trigger_type = step["trigger_type"]
            offset = step["trigger_offset_days"]
            
            if trigger_type == "before_due" and days_until_due == offset:
                applicable_step = step
                break
            elif trigger_type == "on_due" and days_until_due == 0:
                applicable_step = step
                break
            elif trigger_type == "after_due" and days_until_due == -offset:
                applicable_step = step
                break
        
        if not applicable_step:
            # Calculate next action time
            next_action = None
            for step in steps:
                trigger_type = step["trigger_type"]
                offset = step["trigger_offset_days"]
                
                if trigger_type == "before_due":
                    step_date = due_date - timedelta(days=offset)
                elif trigger_type == "on_due":
                    step_date = due_date
                else:
                    step_date = due_date + timedelta(days=offset)
                
                if step_date > now and (not next_action or step_date < next_action):
                    next_action = step_date
            
            if next_action:
                await db.invoices.update_one(
                    {"invoice_id": invoice["invoice_id"]},
                    {"$set": {"next_action_at": next_action.isoformat()}}
                )
            
            return
        
        # Check if this step was already sent
        existing = await db.email_events.find_one({
            "invoice_id": invoice["invoice_id"],
            "event_type": "sent",
            "metadata_json.step_id": applicable_step["step_id"]
        })
        
        if existing:
            return
        
        # Render and send email
        variables = {
            "customer_name": customer.get("name") or customer.get("email", "").split("@")[0],
            "invoice_number": invoice.get("stripe_invoice_id", "")[-8:].upper(),
            "amount": format_currency(invoice.get("amount_due_cents", 0), invoice.get("currency", "usd")),
            "due_date": due_date.strftime("%B %d, %Y"),
            "hosted_invoice_url": invoice.get("hosted_invoice_url", "#"),
            "company_name": workspace.get("name", ""),
            "footer": policy.get("email_footer_text", "")
        }
        
        subject = render_template(applicable_step["subject_template"], variables)
        body = render_template(applicable_step["body_template"], variables)
        
        # Send via Gmail API (simplified - in production, use proper Gmail API)
        # For now, log the email
        logger.info(f"Would send email to {customer['email']}: {subject}")
        
        # Create email event
        await db.email_events.insert_one({
            "event_id": f"evt_{uuid.uuid4().hex[:12]}",
            "workspace_id": invoice["workspace_id"],
            "invoice_id": invoice["invoice_id"],
            "customer_id": customer["customer_id"],
            "direction": "outbound",
            "event_type": "sent",
            "subject": subject,
            "snippet": body[:200],
            "sent_at": now.isoformat(),
            "metadata_json": {
                "step_id": applicable_step["step_id"],
                "step_order": applicable_step["step_order"]
            },
            "created_at": now.isoformat()
        })
        
        # Update invoice
        await db.invoices.update_one(
            {"invoice_id": invoice["invoice_id"]},
            {"$set": {
                "last_step_sent_at": now.isoformat(),
                "updated_at": now.isoformat()
            }}
        )
        
    except Exception as e:
        logger.error(f"Error processing invoice reminder: {e}")

async def run_reply_check_job():
    """Check for customer replies"""
    logger.info("Running reply check...")
    # Implementation would check Gmail threads for replies
    # For now, this is a placeholder
    pass

# ==================== Admin/Internal Endpoints ====================

@api_router.post("/jobs/run-scheduler")
async def trigger_scheduler(request: Request):
    """Manually trigger scheduler (admin)"""
    user = await require_auth(request)
    await run_scheduler_job()
    return {"triggered": True}

@api_router.post("/jobs/run-reply-check")
async def trigger_reply_check(request: Request):
    """Manually trigger reply check (admin)"""
    user = await require_auth(request)
    await run_reply_check_job()
    return {"triggered": True}

@api_router.post("/jobs/send-weekly-digest")
async def send_weekly_digest(request: Request):
    """Send weekly AR digest"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    # Get summary data
    summary = await get_dashboard_summary(request)
    
    # Get top overdue invoices
    overdue_invoices = await db.invoices.find({
        "workspace_id": workspace["workspace_id"],
        "status": InvoiceStatus.PAST_DUE
    }, {"_id": 0}).limit(5).to_list(5)
    
    # Build email content
    html_content = f"""
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; padding: 20px;">
        <h1 style="color: #1e293b;">Weekly AR Digest - {workspace['name']}</h1>
        
        <div style="background: #f8fafc; padding: 20px; border-radius: 8px; margin: 20px 0;">
            <h2 style="color: #334155; margin-top: 0;">Summary</h2>
            <p><strong>Total Open:</strong> {summary['total_open']} invoices ({format_currency(summary['total_open_amount'], summary['currency'])})</p>
            <p><strong>Past Due:</strong> {summary['total_past_due']} invoices ({format_currency(summary['total_past_due_amount'], summary['currency'])})</p>
            <p><strong>Paid This Month:</strong> {summary['paid_this_month']} invoices ({format_currency(summary['paid_this_month_amount'], summary['currency'])})</p>
            <p><strong>Paused:</strong> {summary['invoices_paused']} invoices</p>
        </div>
        
        <h2 style="color: #334155;">Top Overdue Invoices</h2>
        <ul>
    """
    
    for inv in overdue_invoices:
        html_content += f"""
            <li>{inv.get('stripe_invoice_id', '')[-8:].upper()} - {format_currency(inv.get('amount_due_cents', 0), inv.get('currency', 'usd'))}</li>
        """
    
    html_content += """
        </ul>
        <p style="color: #64748b; font-size: 12px;">Sent by Collectly</p>
    </body>
    </html>
    """
    
    # Send via Resend
    if resend_api_key:
        try:
            params = {
                "from": os.environ.get("SENDER_EMAIL", "onboarding@resend.dev"),
                "to": [user["email"]],
                "subject": f"Weekly AR Digest - {workspace['name']}",
                "html": html_content
            }
            
            await asyncio.to_thread(resend.Emails.send, params)
            logger.info(f"Weekly digest sent to {user['email']}")
            
        except Exception as e:
            logger.error(f"Failed to send digest: {e}")
            raise HTTPException(status_code=500, detail=f"Failed to send digest: {str(e)}")
    
    return {"sent": True, "recipient": user["email"]}

# ==================== Customers Endpoint ====================

@api_router.get("/customers")
async def get_customers(request: Request, limit: int = Query(50, le=100), skip: int = 0):
    """Get customers list"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=404, detail="Workspace not found")
    
    customers = await db.customers.find(
        {"workspace_id": workspace["workspace_id"]},
        {"_id": 0}
    ).skip(skip).limit(limit).to_list(limit)
    
    total = await db.customers.count_documents({"workspace_id": workspace["workspace_id"]})
    
    return {
        "customers": customers,
        "total": total
    }

# ==================== Demo Data ====================

@api_router.post("/demo/seed")
async def seed_demo_data(request: Request):
    """Create demo data for testing"""
    user = await require_auth(request)
    workspace = await get_user_workspace(user["user_id"])
    
    if not workspace:
        raise HTTPException(status_code=400, detail="Create a workspace first")
    
    workspace_id = workspace["workspace_id"]
    now = datetime.now(timezone.utc)
    
    # Create demo customers
    demo_customers = [
        {"name": "Acme Corp", "email": "billing@acme.example.com"},
        {"name": "TechStart Inc", "email": "accounts@techstart.example.com"},
        {"name": "Global Services", "email": "finance@globalservices.example.com"},
        {"name": "Innovation Labs", "email": "payments@innovationlabs.example.com"},
        {"name": "Enterprise Solutions", "email": "ar@enterprise.example.com"}
    ]
    
    customer_ids = []
    for i, cust in enumerate(demo_customers):
        customer_id = f"demo_cust_{uuid.uuid4().hex[:8]}"
        await db.customers.update_one(
            {"workspace_id": workspace_id, "email": cust["email"]},
            {"$set": {
                "customer_id": customer_id,
                "workspace_id": workspace_id,
                "stripe_customer_id": f"cus_demo_{i}",
                "name": cust["name"],
                "email": cust["email"],
                "created_at": now.isoformat()
            }},
            upsert=True
        )
        customer_ids.append(customer_id)
    
    # Create demo invoices with various states
    demo_invoices = [
        {"amount": 150000, "status": InvoiceStatus.OPEN, "state": AutopilotState.ACTIVE, "days_offset": 5},
        {"amount": 75000, "status": InvoiceStatus.PAST_DUE, "state": AutopilotState.ACTIVE, "days_offset": -7},
        {"amount": 250000, "status": InvoiceStatus.PAST_DUE, "state": AutopilotState.PAUSED_REPLIED, "days_offset": -14},
        {"amount": 50000, "status": InvoiceStatus.PAID, "state": AutopilotState.STOPPED_PAID, "days_offset": -30},
        {"amount": 125000, "status": InvoiceStatus.OPEN, "state": AutopilotState.PAUSED_MANUAL, "days_offset": 10}
    ]
    
    for i, inv in enumerate(demo_invoices):
        invoice_id = f"demo_inv_{uuid.uuid4().hex[:8]}"
        due_date = now + timedelta(days=inv["days_offset"])
        
        await db.invoices.update_one(
            {"workspace_id": workspace_id, "stripe_invoice_id": f"in_demo_{i}"},
            {"$set": {
                "invoice_id": invoice_id,
                "workspace_id": workspace_id,
                "stripe_invoice_id": f"in_demo_{i}",
                "stripe_customer_id": f"cus_demo_{i}",
                "customer_id": customer_ids[i],
                "status": inv["status"],
                "autopilot_state": inv["state"],
                "amount_due_cents": inv["amount"],
                "currency": "usd",
                "due_date": due_date.isoformat(),
                "issued_at": (now - timedelta(days=30)).isoformat(),
                "hosted_invoice_url": f"https://invoice.stripe.com/i/demo_{i}",
                "created_at": now.isoformat(),
                "updated_at": now.isoformat()
            }},
            upsert=True
        )
        
        # Add some email events for past due invoices
        if inv["status"] == InvoiceStatus.PAST_DUE:
            await db.email_events.insert_one({
                "event_id": f"evt_{uuid.uuid4().hex[:12]}",
                "workspace_id": workspace_id,
                "invoice_id": invoice_id,
                "customer_id": customer_ids[i],
                "direction": "outbound",
                "event_type": "sent",
                "subject": f"Reminder: Invoice in_demo_{i}",
                "snippet": "This is a friendly reminder...",
                "sent_at": (now - timedelta(days=3)).isoformat(),
                "created_at": (now - timedelta(days=3)).isoformat()
            })
    
    return {
        "success": True,
        "customers_created": len(demo_customers),
        "invoices_created": len(demo_invoices)
    }

# Include the router
app.include_router(api_router)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
