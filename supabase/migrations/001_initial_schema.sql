-- Collectly Database Schema
-- Migration: 001_initial_schema
-- Description: Initial PostgreSQL schema for Collectly SaaS

-- ============================================
-- EXTENSIONS
-- ============================================
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ============================================
-- ENUMS
-- ============================================

-- Invoice status enum
CREATE TYPE invoice_status AS ENUM (
  'draft',
  'open',
  'past_due',
  'paid',
  'uncollectible',
  'void'
);

-- Autopilot state enum
CREATE TYPE autopilot_state AS ENUM (
  'active',
  'paused_replied',
  'paused_manual',
  'stopped_paid',
  'stopped_manual'
);

-- Email event direction
CREATE TYPE email_direction AS ENUM ('outbound', 'inbound');

-- Email event type
CREATE TYPE email_event_type AS ENUM (
  'sent',
  'delivered',
  'bounced',
  'replied',
  'paused',
  'resumed',
  'stopped',
  'manual_note',
  'test_sent'
);

-- Reminder trigger type
CREATE TYPE trigger_type AS ENUM (
  'before_due',
  'on_due',
  'after_due'
);

-- Workspace member role
CREATE TYPE member_role AS ENUM ('owner', 'admin', 'member');

-- Notification type
CREATE TYPE notification_type AS ENUM (
  'reply_received',
  'invoice_paid',
  'sync_failed',
  'onboarding_complete'
);

-- ============================================
-- CORE TABLES
-- ============================================

-- Users table (extends auth.users)
CREATE TABLE public.users (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  name TEXT NOT NULL,
  avatar_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspaces (tenant container)
CREATE TABLE public.workspaces (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'America/New_York',
  owner_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace members (user-workspace relationship)
CREATE TABLE public.workspace_members (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role member_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, user_id)
);

-- ============================================
-- INTEGRATION TABLES
-- ============================================

-- Stripe connections
CREATE TABLE public.stripe_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_account_id TEXT,
  secret_key TEXT NOT NULL, -- TODO: Move to Vault
  webhook_secret TEXT,       -- TODO: Move to Vault
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_sync_at TIMESTAMPTZ,
  is_connected BOOLEAN NOT NULL DEFAULT TRUE
);

-- Gmail connections
CREATE TABLE public.gmail_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES public.workspaces(id) ON DELETE CASCADE,
  google_user_email TEXT NOT NULL,
  access_token TEXT NOT NULL,  -- TODO: Move to Vault
  refresh_token TEXT NOT NULL, -- TODO: Move to Vault
  token_expiry TIMESTAMPTZ NOT NULL,
  connected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_connected BOOLEAN NOT NULL DEFAULT TRUE
);

-- ============================================
-- BUSINESS TABLES
-- ============================================

-- Customers (synced from Stripe)
CREATE TABLE public.customers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_customer_id TEXT NOT NULL,
  name TEXT,
  email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, stripe_customer_id)
);

-- Invoices
CREATE TABLE public.invoices (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_invoice_id TEXT NOT NULL,
  stripe_customer_id TEXT NOT NULL,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  status invoice_status NOT NULL DEFAULT 'open',
  autopilot_state autopilot_state NOT NULL DEFAULT 'active',
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'usd',
  due_date TIMESTAMPTZ,
  issued_at TIMESTAMPTZ,
  paid_at TIMESTAMPTZ,
  hosted_invoice_url TEXT,
  last_step_sent_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(workspace_id, stripe_invoice_id)
);

-- Email events (communication log)
CREATE TABLE public.email_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id UUID REFERENCES public.invoices(id) ON DELETE CASCADE,
  customer_id UUID REFERENCES public.customers(id) ON DELETE SET NULL,
  direction email_direction NOT NULL,
  event_type email_event_type NOT NULL,
  gmail_message_id TEXT,
  gmail_thread_id TEXT,
  subject TEXT,
  snippet TEXT,
  sent_at TIMESTAMPTZ,
  received_at TIMESTAMPTZ,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- REMINDER SYSTEM TABLES
-- ============================================

-- Reminder policies
CREATE TABLE public.reminder_policies (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT FALSE,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  max_emails_per_week_per_customer INTEGER NOT NULL DEFAULT 2,
  quiet_hours_start INTEGER NOT NULL DEFAULT 22, -- 10 PM
  quiet_hours_end INTEGER NOT NULL DEFAULT 8,    -- 8 AM
  from_name TEXT,
  reply_to_email TEXT,
  email_footer TEXT DEFAULT 'Reply to this email if you have questions. Reply ''stop'' to pause reminders.',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reminder steps
CREATE TABLE public.reminder_steps (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id UUID NOT NULL REFERENCES public.reminder_policies(id) ON DELETE CASCADE,
  step_order INTEGER NOT NULL,
  trigger_type trigger_type NOT NULL,
  trigger_offset_days INTEGER NOT NULL,
  subject_template TEXT NOT NULL,
  body_template TEXT NOT NULL,
  is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  UNIQUE(policy_id, step_order)
);

-- ============================================
-- SYSTEM TABLES
-- ============================================

-- Notifications
CREATE TABLE public.notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  type notification_type NOT NULL,
  title TEXT NOT NULL,
  message TEXT,
  payload JSONB DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Workspace onboarding
CREATE TABLE public.workspace_onboarding (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_connected BOOLEAN NOT NULL DEFAULT FALSE,
  data_imported BOOLEAN NOT NULL DEFAULT FALSE,
  gmail_connected BOOLEAN NOT NULL DEFAULT FALSE,
  test_email_sent BOOLEAN NOT NULL DEFAULT FALSE,
  autopilot_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  completed BOOLEAN NOT NULL DEFAULT FALSE,
  completed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- System health
CREATE TABLE public.system_health (
  workspace_id UUID PRIMARY KEY REFERENCES public.workspaces(id) ON DELETE CASCADE,
  stripe_sync_status TEXT DEFAULT 'never',
  stripe_sync_last_run TIMESTAMPTZ,
  stripe_sync_error TEXT,
  stripe_webhook_status TEXT DEFAULT 'never',
  stripe_webhook_last_received TIMESTAMPTZ,
  scheduler_status TEXT DEFAULT 'never',
  scheduler_last_run TIMESTAMPTZ,
  reply_check_status TEXT DEFAULT 'never',
  reply_check_last_run TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

-- Workspace members
CREATE INDEX idx_workspace_members_user_id ON public.workspace_members(user_id);
CREATE INDEX idx_workspace_members_workspace_id ON public.workspace_members(workspace_id);

-- Customers
CREATE INDEX idx_customers_workspace_id ON public.customers(workspace_id);
CREATE INDEX idx_customers_email ON public.customers(email);

-- Invoices
CREATE INDEX idx_invoices_workspace_id ON public.invoices(workspace_id);
CREATE INDEX idx_invoices_customer_id ON public.invoices(customer_id);
CREATE INDEX idx_invoices_status ON public.invoices(status);
CREATE INDEX idx_invoices_autopilot_state ON public.invoices(autopilot_state);
CREATE INDEX idx_invoices_due_date ON public.invoices(due_date);
CREATE INDEX idx_invoices_next_action ON public.invoices(next_action_at) WHERE next_action_at IS NOT NULL;

-- Email events
CREATE INDEX idx_email_events_workspace_id ON public.email_events(workspace_id);
CREATE INDEX idx_email_events_invoice_id ON public.email_events(invoice_id);
CREATE INDEX idx_email_events_created_at ON public.email_events(created_at);
CREATE INDEX idx_email_events_gmail_thread ON public.email_events(gmail_thread_id) WHERE gmail_thread_id IS NOT NULL;

-- Reminder steps
CREATE INDEX idx_reminder_steps_policy_id ON public.reminder_steps(policy_id);

-- Notifications
CREATE INDEX idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX idx_notifications_unread ON public.notifications(user_id, is_read) WHERE is_read = FALSE;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- Enable RLS on all tables
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stripe_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gmail_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.email_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminder_steps ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspace_onboarding ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_health ENABLE ROW LEVEL SECURITY;

-- Users policies
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id);

-- Workspaces policies
CREATE POLICY "Users can view workspaces they belong to" ON public.workspaces
  FOR SELECT USING (
    id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Users can create workspaces" ON public.workspaces
  FOR INSERT WITH CHECK (owner_id = auth.uid());

CREATE POLICY "Owners can update their workspaces" ON public.workspaces
  FOR UPDATE USING (owner_id = auth.uid());

-- Workspace members policies
CREATE POLICY "Users can view members of their workspaces" ON public.workspace_members
  FOR SELECT USING (
    workspace_id IN (SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid())
  );

CREATE POLICY "Owners can manage workspace members" ON public.workspace_members
  FOR ALL USING (
    workspace_id IN (SELECT id FROM public.workspaces WHERE owner_id = auth.uid())
  );

-- Helper function to check workspace membership
CREATE OR REPLACE FUNCTION public.user_workspace_ids()
RETURNS SETOF UUID AS $$
  SELECT workspace_id FROM public.workspace_members WHERE user_id = auth.uid();
$$ LANGUAGE sql SECURITY DEFINER STABLE;

-- Generic workspace-scoped policies (using the helper function)
CREATE POLICY "Workspace scoped access" ON public.stripe_connections
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace scoped access" ON public.gmail_connections
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace scoped access" ON public.customers
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace scoped access" ON public.invoices
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace scoped access" ON public.email_events
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace scoped access" ON public.reminder_policies
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace scoped access" ON public.reminder_steps
  FOR ALL USING (
    policy_id IN (
      SELECT id FROM public.reminder_policies 
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );

CREATE POLICY "Workspace scoped access" ON public.notifications
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace scoped access" ON public.workspace_onboarding
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Workspace scoped access" ON public.system_health
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to create user profile on signup
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name, avatar_url)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1)),
    NEW.raw_user_meta_data->>'avatar_url'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for new user signup
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Function to create default reminder policy
CREATE OR REPLACE FUNCTION public.create_default_policy(p_workspace_id UUID)
RETURNS UUID AS $$
DECLARE
  v_policy_id UUID;
BEGIN
  -- Create policy
  INSERT INTO public.reminder_policies (workspace_id, name, is_default, is_enabled)
  VALUES (p_workspace_id, 'Default Policy', TRUE, TRUE)
  RETURNING id INTO v_policy_id;
  
  -- Create default steps
  INSERT INTO public.reminder_steps (policy_id, step_order, trigger_type, trigger_offset_days, subject_template, body_template) VALUES
  (v_policy_id, 1, 'before_due', 3, 
   'Reminder: Invoice {{invoice_number}} due {{due_date}}',
   E'Hi {{customer_name}},\n\nThis is a friendly reminder that Invoice {{invoice_number}} for {{amount}} is due on {{due_date}}.\n\nYou can view and pay your invoice here: {{invoice_url}}\n\nPlease let us know if you have any questions.\n\nBest regards,\n{{company_name}}\n\n{{footer}}'),
  
  (v_policy_id, 2, 'on_due', 0,
   'Invoice {{invoice_number}} due today',
   E'Hi {{customer_name}},\n\nInvoice {{invoice_number}} for {{amount}} is due today.\n\nPay now: {{invoice_url}}\n\nThank you,\n{{company_name}}\n\n{{footer}}'),
  
  (v_policy_id, 3, 'after_due', 3,
   'Past due: Invoice {{invoice_number}}',
   E'Hi {{customer_name}},\n\nInvoice {{invoice_number}} for {{amount}} is now 3 days past due.\n\nPlease make payment at your earliest convenience: {{invoice_url}}\n\nIf you''re experiencing any issues, please let us know how we can help.\n\nBest regards,\n{{company_name}}\n\n{{footer}}'),
  
  (v_policy_id, 4, 'after_due', 7,
   'Second notice: Invoice {{invoice_number}}',
   E'Hi {{customer_name}},\n\nThis is a second notice that Invoice {{invoice_number}} for {{amount}} is now 7 days overdue.\n\nPay here: {{invoice_url}}\n\nIf there''s an issue preventing payment, please reply to this email.\n\nThank you,\n{{company_name}}\n\n{{footer}}'),
  
  (v_policy_id, 5, 'after_due', 14,
   'Final notice: Invoice {{invoice_number}}',
   E'Hi {{customer_name}},\n\nThis is a final notice regarding Invoice {{invoice_number}} for {{amount}}, which is now 14 days past due.\n\nPlease arrange payment immediately: {{invoice_url}}\n\nIf we don''t hear from you, we may need to take further action.\n\n{{company_name}}\n\n{{footer}}');
  
  RETURN v_policy_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to initialize workspace after creation
CREATE OR REPLACE FUNCTION public.init_workspace()
RETURNS TRIGGER AS $$
BEGIN
  -- Add owner as member
  INSERT INTO public.workspace_members (workspace_id, user_id, role)
  VALUES (NEW.id, NEW.owner_id, 'owner');
  
  -- Create onboarding record
  INSERT INTO public.workspace_onboarding (workspace_id)
  VALUES (NEW.id);
  
  -- Create system health record
  INSERT INTO public.system_health (workspace_id)
  VALUES (NEW.id);
  
  -- Create default reminder policy
  PERFORM public.create_default_policy(NEW.id);
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger for workspace initialization
CREATE TRIGGER on_workspace_created
  AFTER INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.init_workspace();

-- Function to update timestamps
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply updated_at triggers
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.reminder_policies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.workspace_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.system_health
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();

-- ============================================
-- SEED DATA (Optional - for development)
-- ============================================

-- Add any seed data here for development/testing
-- Example:
-- INSERT INTO public.users (id, email, name) VALUES (...);
