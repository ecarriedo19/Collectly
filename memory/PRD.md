# Collectly - Product Requirements Document

## Overview
Collectly is a SaaS application that automates invoice follow-ups by connecting to a user's Gmail and Stripe accounts. It syncs invoices from Stripe, sends automated email reminders from the user's Gmail, pauses reminders on customer reply, and stops them when the invoice is paid.

## Tech Stack
- **Frontend**: React + Tailwind CSS + Shadcn UI
- **Backend**: FastAPI (Python)
- **Database**: MongoDB
- **Authentication**: Emergent-managed Google social login
- **Integrations**: Stripe (v1), Gmail (v1 - partial), Resend (pending)

## Core User Flows

### 1. Authentication
- User signs in via Emergent Google OAuth
- Session managed via cookies
- Workspace auto-created on first login

### 2. Onboarding Wizard (NEW - Jan 2026)
5-step guided setup:
1. Connect Stripe (API key)
2. Import Data (sync customers/invoices)
3. Connect Gmail (OAuth)
4. Test Email (verify setup)
5. Enable Autopilot

### 3. Dashboard
- KPI cards: Total Open, Past Due, Paid This Month, Paused
- Recent invoices table with smart status display
- System Health indicators (compact view)
- Setup Banner for incomplete configuration

### 4. Invoice Management
- List view with filtering (status, search)
- Detail view with activity timeline
- Manual pause/resume autopilot per invoice

### 5. Integrations
- Stripe connection management
- Gmail connection management
- Webhook setup guidance
- System Health indicators (full view)

### 6. Settings
- Reminder policy configuration
- Email template customization
- Workspace settings

## Implemented Features

### Phase 1 - Core (Complete)
- [x] Landing page
- [x] Google OAuth authentication
- [x] Workspace management
- [x] Dashboard with KPIs
- [x] Invoices list and detail pages
- [x] Stripe integration (connect/sync)
- [x] Reminder policy configuration
- [x] Settings page

### Phase 2 - UX Polish (Complete)
- [x] Finance-grade typography (tabular numerals)
- [x] Consistent date formatting (MM/DD/YYYY)
- [x] Smart invoice status display (combines status + autopilot state)
- [x] "Paid On" display for paid invoices

### Phase 3 - System Health & Onboarding (Complete - Jan 29, 2026)
- [x] System Health indicators component
- [x] Onboarding Wizard (5-step guided setup)
- [x] Setup Banner for incomplete configuration
- [x] Backend health tracking endpoints
- [x] Dashboard integration of health status
- [x] Integrations page health status (full view)

## Upcoming Tasks (P1)

### Gmail Integration
- Complete OAuth flow with user consent
- Send reminder emails via user's Gmail
- Detect replies to pause sequences
- Reply detection background job

### Resend Integration
- Weekly AR digest email
- Requires user RESEND_API_KEY

## Future Tasks (P2)

### Scheduler Enhancement
- Complete business logic for reminder sequences
- Determine next action for each invoice
- Trigger email sends based on policy

### Real-time Notifications
- "Customer replied" alerts
- "Invoice paid" notifications
- In-app notification center

### Refactoring
- Break down server.py into modules
- Create frontend API service layer
- Add comprehensive test coverage

## Data Models

### Users
- user_id, email, name, created_at

### Workspaces
- workspace_id, name, owner_id, timezone, settings

### Invoices
- invoice_id, stripe_invoice_id, customer_id, amount, status, autopilot_state

### Customers
- customer_id, stripe_customer_id, email, name

### Integrations
- gmail_connections, stripe_connections (encrypted credentials)

### System Health (NEW)
- workspace_id, stripe_sync, stripe_webhook, scheduler, reply_check

## API Endpoints

### Authentication
- POST /api/auth/login
- GET /api/auth/me

### Dashboard
- GET /api/dashboard/summary

### Invoices
- GET /api/invoices
- GET /api/invoices/{id}
- PATCH /api/invoices/{id}/autopilot

### Integrations
- GET/POST /api/integrations/stripe/connect
- POST /api/integrations/stripe/sync
- GET /api/integrations/stripe/status
- GET /api/integrations/gmail/status

### Health & Jobs (NEW)
- GET /api/health/status
- POST /api/jobs/run-scheduler

### Onboarding (NEW)
- GET /api/onboarding/status
- GET /api/onboarding/import-preview
- POST /api/onboarding/send-test-email
- POST /api/onboarding/complete
- GET /api/onboarding/scheduled-preview

### Webhooks
- POST /api/webhooks/stripe

## Mocked/Incomplete Features
- Gmail email sending (OAuth setup required)
- Gmail reply detection
- Resend weekly digest
- Full scheduler logic

## Test Reports
- /app/test_reports/iteration_1.json
- /app/test_reports/iteration_2.json
- /app/backend/tests/test_onboarding_health.py
