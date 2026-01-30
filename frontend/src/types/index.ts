/**
 * Shared TypeScript type definitions for Collectly frontend
 * 
 * These types mirror the database schema and API responses.
 * Import from '@/types' or '../types' in components.
 */

// ============================================================================
// Database Enums
// ============================================================================

export type InvoiceStatus = 'draft' | 'open' | 'paid' | 'void' | 'uncollectible' | 'past_due';

export type AutopilotState = 'active' | 'paused_manual' | 'paused_replied' | 'completed';

export type WorkspaceRole = 'owner' | 'admin' | 'member';

export type TriggerType = 'before_due' | 'on_due' | 'after_due';

export type StripeSyncSchedule = 'manual' | 'hourly' | 'daily';

export type NotificationType = 'reply_detected' | 'invoice_paid' | 'sync_complete' | 'error';

// ============================================================================
// Core Entities
// ============================================================================

export interface User {
  id: string;
  email: string;
  name: string | null;
  avatar_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface Workspace {
  id: string;
  name: string;
  timezone: string;
  stripe_sync_schedule: StripeSyncSchedule;
  stripe_last_sync_at: string | null;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceMember {
  id: string;
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
}

// ============================================================================
// Business Entities
// ============================================================================

export interface Customer {
  id: string;
  workspace_id: string;
  stripe_customer_id: string;
  email: string | null;
  name: string | null;
  created_at: string;
  updated_at: string;
}

export interface Invoice {
  id: string;
  workspace_id: string;
  customer_id: string;
  stripe_invoice_id: string;
  stripe_invoice_number: string | null;
  status: InvoiceStatus;
  autopilot_state: AutopilotState;
  amount_cents: number;
  amount_paid_cents: number;
  currency: string;
  due_date: string;
  paid_at: string | null;
  hosted_invoice_url: string | null;
  pdf_url: string | null;
  next_action_at: string | null;
  last_step_sent_at: string | null;
  customer_notes: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  customer?: Customer;
}

export interface EmailEvent {
  id: string;
  workspace_id: string;
  invoice_id: string;
  customer_id: string;
  direction: 'inbound' | 'outbound';
  event_type: 'sent' | 'delivered' | 'opened' | 'clicked' | 'replied' | 'bounced';
  gmail_message_id: string | null;
  gmail_thread_id: string | null;
  subject: string | null;
  snippet: string | null;
  sent_at: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

// ============================================================================
// Reminder System
// ============================================================================

export interface ReminderPolicy {
  id: string;
  workspace_id: string;
  name: string;
  is_default: boolean;
  is_enabled: boolean;
  max_emails_per_week_per_customer: number;
  email_footer: string | null;
  created_at: string;
  updated_at: string;
  // Joined fields
  steps?: ReminderStep[];
}

export interface ReminderStep {
  id: string;
  policy_id: string;
  step_order: number;
  trigger_type: TriggerType;
  trigger_offset_days: number;
  subject_template: string;
  body_template: string;
  is_enabled: boolean;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// Integrations
// ============================================================================

export interface StripeConnection {
  id: string;
  workspace_id: string;
  stripe_account_id: string;
  is_connected: boolean;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface GmailConnection {
  id: string;
  workspace_id: string;
  google_email: string;
  is_connected: boolean;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// System
// ============================================================================

export interface Notification {
  id: string;
  user_id: string;
  workspace_id: string;
  type: NotificationType;
  title: string;
  message: string | null;
  payload: Record<string, unknown> | null;
  is_read: boolean;
  created_at: string;
}

export interface SystemHealth {
  id: string;
  workspace_id: string;
  stripe_sync_status: 'ok' | 'error' | 'never';
  stripe_sync_last_run: string | null;
  stripe_sync_error: string | null;
  scheduler_status: 'ok' | 'error' | 'never';
  scheduler_last_run: string | null;
  gmail_status: 'ok' | 'error' | 'never';
  gmail_last_check: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkspaceOnboarding {
  workspace_id: string;
  stripe_connected: boolean;
  gmail_connected: boolean;
  policy_configured: boolean;
  test_email_sent: boolean;
  completed: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// ============================================================================
// API Responses
// ============================================================================

export interface ApiResponse<T = unknown> {
  ok: boolean;
  data?: T;
  error?: string;
}

export interface PaginatedResponse<T> {
  ok: boolean;
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

// ============================================================================
// Dashboard Types
// ============================================================================

export interface DashboardKPIs {
  total_open: number;
  total_open_amount: number;
  past_due_count: number;
  past_due_amount: number;
  collected_30d: number;
  collected_30d_amount: number;
  active_autopilot: number;
  emails_sent_7d: number;
  replies_7d: number;
  currency: string;
}

// ============================================================================
// Component Props (common patterns)
// ============================================================================

export interface WithWorkspace {
  workspaceId: string;
}

export interface WithUser {
  user: User;
}

export interface WithLoading {
  loading?: boolean;
}
