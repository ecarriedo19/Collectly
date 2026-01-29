# Collectly - Architecture Documentation

> **Last Updated:** January 29, 2026
> **Version:** 2.0.0 (Supabase Rewrite)
> **Status:** In Development

## Overview

Collectly is a SaaS application that automates invoice follow-ups by connecting to a user's Stripe and Gmail accounts. It syncs invoices from Stripe, sends automated email reminders from the user's Gmail, pauses reminders when customers reply, and stops them when invoices are paid.

## Tech Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| **Frontend** | React 19 + Tailwind CSS + Shadcn UI | User interface |
| **Backend** | Supabase Edge Functions (TypeScript/Deno) | API endpoints |
| **Database** | Supabase PostgreSQL | Data persistence |
| **Authentication** | Supabase Auth (Google OAuth) | User authentication |
| **Scheduler** | Supabase pg_cron | Automated reminder jobs |
| **Secrets** | Supabase Vault | Encrypted API keys/tokens |
| **Hosting** | Cloudflare Pages (Frontend) + Supabase (Backend) | Deployment |

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                    Cloudflare Pages (Frontend)                   │
│                     React 19 + Tailwind + Shadcn                 │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                         Supabase                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Auth      │  │   Realtime  │  │    Edge Functions       │  │
│  │  (Google)   │  │  (WebSocket)│  │    (TypeScript/Deno)    │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │ PostgreSQL  │  │   Vault     │  │       pg_cron           │  │
│  │   + RLS     │  │  (Secrets)  │  │     (Scheduler)         │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│                    External Services                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │   Stripe    │  │   Gmail     │  │        Resend           │  │
│  │    API      │  │    API      │  │    (Digest Emails)      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Project Structure

```
collectly/
├── supabase/
│   ├── config.toml                 # Supabase local config
│   ├── migrations/
│   │   └── 001_initial_schema.sql  # Database schema
│   └── functions/
│       ├── _shared/                # Shared utilities
│       │   ├── supabase.ts         # DB client
│       │   ├── cors.ts             # CORS headers
│       │   ├── stripe.ts           # Stripe client
│       │   └── gmail.ts            # Gmail client
│       ├── workspaces/             # Workspace CRUD
│       ├── invoices/               # Invoice management
│       ├── dashboard/              # Dashboard metrics
│       ├── customers/              # Customer list
│       ├── policies/               # Reminder policies
│       ├── notifications/          # User notifications
│       ├── integrations-stripe/    # Stripe connection
│       ├── integrations-gmail/     # Gmail connection
│       ├── stripe-sync/            # Sync from Stripe
│       ├── stripe-webhook/         # Stripe webhooks
│       ├── onboarding/             # Onboarding flow
│       ├── health/                 # System health
│       ├── scheduler/              # Reminder scheduler
│       ├── send-reminder/          # Send email
│       ├── check-replies/          # Check Gmail replies
│       └── weekly-digest/          # Weekly AR digest
├── frontend/
│   ├── src/
│   │   ├── App.js                  # Main app + routing
│   │   ├── lib/
│   │   │   ├── supabase.ts         # Supabase client
│   │   │   └── api.ts              # API service layer
│   │   ├── components/
│   │   │   ├── Layout.jsx          # Main layout
│   │   │   ├── OnboardingWizard.jsx
│   │   │   ├── SetupBanner.jsx
│   │   │   ├── SystemStatus.jsx
│   │   │   └── ui/                 # Shadcn components
│   │   ├── pages/
│   │   │   ├── Landing.jsx
│   │   │   ├── Dashboard.jsx
│   │   │   ├── Invoices.jsx
│   │   │   ├── InvoiceDetail.jsx
│   │   │   ├── Integrations.jsx
│   │   │   ├── ReminderPolicy.jsx
│   │   │   ├── Settings.jsx
│   │   │   └── WorkspaceSetup.jsx
│   │   ├── hooks/
│   │   └── utils/
│   ├── public/
│   └── package.json
├── docs/
│   └── ARCHITECTURE.md             # This file
└── README.md
```

## Database Schema

### Entity Relationship Diagram

```
┌──────────────┐     ┌──────────────────┐     ┌──────────────┐
│    users     │────<│ workspace_members │>────│  workspaces  │
│  (auth.users)│     └──────────────────┘     └──────────────┘
└──────────────┘                                      │
                                                      │
       ┌──────────────────────────────────────────────┼───────────────────┐
       │                    │                         │                   │
       ▼                    ▼                         ▼                   ▼
┌──────────────┐  ┌─────────────────┐  ┌──────────────────┐  ┌───────────────────┐
│  customers   │  │ stripe_connections│  │ gmail_connections │  │ reminder_policies │
└──────────────┘  └─────────────────┘  └──────────────────┘  └───────────────────┘
       │                                                              │
       │                                                              ▼
       ▼                                                    ┌─────────────────┐
┌──────────────┐                                            │ reminder_steps  │
│   invoices   │                                            └─────────────────┘
└──────────────┘
       │
       ▼
┌──────────────┐
│ email_events │
└──────────────┘
```

### Tables

#### Core Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `users` | User profiles (linked to auth.users) | id, email, name, avatar_url |
| `workspaces` | Tenant container | id, name, timezone, owner_id |
| `workspace_members` | User-workspace relationship | workspace_id, user_id, role |

#### Business Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `customers` | Synced from Stripe | id, workspace_id, stripe_customer_id, email, name |
| `invoices` | Invoice tracking | id, workspace_id, stripe_invoice_id, status, autopilot_state, amount_cents, due_date |
| `email_events` | Communication log | id, invoice_id, event_type, direction, sent_at |

#### Integration Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `stripe_connections` | Stripe API credentials | workspace_id, stripe_account_id, secret_key_id (vault ref) |
| `gmail_connections` | Gmail OAuth tokens | workspace_id, google_email, access_token_id (vault ref) |

#### Reminder System

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `reminder_policies` | Email sequence rules | workspace_id, name, is_enabled, max_emails_per_week |
| `reminder_steps` | Individual steps | policy_id, step_order, trigger_type, offset_days, template |

#### System Tables

| Table | Purpose | Key Fields |
|-------|---------|------------|
| `notifications` | User notifications | user_id, workspace_id, type, payload, is_read |
| `workspace_onboarding` | Onboarding progress | workspace_id, completed, completed_at |
| `system_health` | Health metrics | workspace_id, stripe_sync, scheduler, etc. |

### Row Level Security (RLS)

All tables are protected by RLS policies ensuring users can only access data from workspaces they belong to.

```sql
-- Example: Invoices policy
CREATE POLICY "Users can access invoices in their workspaces"
ON invoices FOR ALL
USING (
  workspace_id IN (
    SELECT workspace_id FROM workspace_members
    WHERE user_id = auth.uid()
  )
);
```

## API Endpoints (Edge Functions)

### Authentication
- Handled by Supabase Auth (no custom endpoints needed)
- Google OAuth provider enabled
- JWT tokens used for API authentication

### Workspaces
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/workspaces` | Get current user's workspace |
| POST | `/workspaces` | Create new workspace |
| PATCH | `/workspaces` | Update workspace settings |

### Invoices
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/invoices` | List invoices (with filters) |
| GET | `/invoices?id={id}` | Get single invoice |
| PATCH | `/invoices` | Update invoice (pause/resume) |
| POST | `/invoices/note` | Add note to invoice |

### Dashboard
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Get KPI summary |

### Integrations
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/integrations-stripe` | Get Stripe status |
| POST | `/integrations-stripe` | Connect Stripe |
| DELETE | `/integrations-stripe` | Disconnect Stripe |
| POST | `/stripe-sync` | Sync from Stripe |
| POST | `/stripe-webhook` | Handle Stripe events |
| GET | `/integrations-gmail` | Get Gmail status |
| POST | `/integrations-gmail` | Connect Gmail |
| DELETE | `/integrations-gmail` | Disconnect Gmail |

### Policies
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/policies` | Get default policy |
| PATCH | `/policies` | Update policy |
| POST | `/policies/steps` | Add step |
| PATCH | `/policies/steps` | Update step |
| DELETE | `/policies/steps` | Delete step |

### Onboarding
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/onboarding` | Get status |
| GET | `/onboarding/preview` | Import preview |
| POST | `/onboarding/test-email` | Send test |
| POST | `/onboarding/complete` | Complete setup |

### Background Jobs (pg_cron)
| Job | Schedule | Description |
|-----|----------|-------------|
| `scheduler` | Every 15 min | Process reminder queue |
| `check-replies` | Every 5 min | Check Gmail for replies |
| `weekly-digest` | Sunday 9am | Send AR digest |

## Authentication Flow

```
1. User clicks "Sign in with Google"
2. Supabase Auth redirects to Google OAuth
3. User authorizes, Google returns to callback URL
4. Supabase creates session, stores JWT in localStorage
5. Frontend includes JWT in all API requests
6. Edge Functions validate JWT via Supabase client
7. RLS policies filter data based on auth.uid()
```

## Data Flow: Reminder System

```
1. pg_cron triggers scheduler every 15 minutes
2. Scheduler queries invoices where:
   - status IN ('open', 'past_due')
   - autopilot_state = 'active'
   - next_action_at <= NOW()
3. For each invoice:
   a. Get applicable reminder step based on due_date
   b. Check rate limits (max 2/week/customer)
   c. Send email via Gmail API
   d. Log to email_events
   e. Update next_action_at
4. Reply checker runs every 5 minutes:
   a. Query Gmail threads for replies
   b. If reply found, set autopilot_state = 'paused_replied'
   c. Create notification for user
```

## Environment Variables

### Supabase Dashboard (Secrets)
```
STRIPE_SECRET_KEY=sk_live_...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
RESEND_API_KEY=...
```

### Frontend (.env)
```
REACT_APP_SUPABASE_URL=https://xxx.supabase.co
REACT_APP_SUPABASE_ANON_KEY=eyJ...
```

## Deployment

### Development
```bash
# Start Supabase locally
supabase start

# Start frontend
cd frontend && npm start
```

### Production
- **Frontend:** Cloudflare Pages (auto-deploy from GitHub)
- **Backend:** Supabase (managed)
- **Cost:** $25/month (Supabase Pro)

## Security Considerations

1. **API Keys:** Stored in Supabase Vault, never in code
2. **RLS:** All tables protected by row-level security
3. **Auth:** JWT validation on every request
4. **CORS:** Restricted to production domain
5. **Webhooks:** Signature verification for Stripe

## Changelog

### v2.0.0 (In Progress)
- Complete rewrite from Python/MongoDB to TypeScript/Supabase
- Migrated auth from Emergent to Supabase Auth
- Added pg_cron for scheduler (replaces APScheduler)
- Implemented Gmail OAuth and email sending
- Added reply detection
- Real-time notifications via Supabase Realtime

### v1.0.0 (Previous)
- Python FastAPI backend
- MongoDB database
- Emergent Auth (Google OAuth)
- Basic Stripe integration
- Mocked Gmail functionality
