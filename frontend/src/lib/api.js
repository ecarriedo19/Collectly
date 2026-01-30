/**
 * API Service Layer
 * 
 * Centralized API calls using Supabase Edge Functions.
 * Provides a clean interface for all backend operations.
 */

import { supabase } from './supabase'

const SUPABASE_URL = process.env.REACT_APP_SUPABASE_URL

/**
 * Invoke a Supabase Edge Function with proper HTTP method
 */
async function invokeFunction(functionName, options = {}) {
  const { method = 'POST', body } = options
  
  // Get current session for auth token
  const { data: { session } } = await supabase.auth.getSession()
  
  if (!session) {
    throw new Error('Not authenticated')
  }
  
  const url = `${SUPABASE_URL}/functions/v1/${functionName}`
  
  const fetchOptions = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
  }
  
  // Only add body for non-GET requests
  if (body && method !== 'GET') {
    fetchOptions.body = JSON.stringify(body)
  }
  
  const response = await fetch(url, fetchOptions)
  
  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    console.error(`API error (${functionName}):`, errorData)
    throw new Error(errorData.error || `Request failed with status ${response.status}`)
  }
  
  return response.json()
}

/**
 * Workspace API
 */
export const workspaces = {
  /**
   * Get current user's workspace
   */
  async get() {
    return invokeFunction('workspaces', { method: 'GET' })
  },
  
  /**
   * Create a new workspace
   */
  async create(name, timezone = 'America/New_York') {
    return invokeFunction('workspaces', {
      method: 'POST',
      body: { name, timezone },
    })
  },
  
  /**
   * Update workspace settings
   */
  async update(updates) {
    return invokeFunction('workspaces', {
      method: 'PATCH',
      body: updates,
    })
  },
}

/**
 * Dashboard API
 */
export const dashboard = {
  /**
   * Get dashboard summary metrics
   */
  async getSummary() {
    return invokeFunction('dashboard', { method: 'GET' })
  },
}

/**
 * Invoices API
 */
export const invoices = {
  /**
   * List invoices with optional filters
   */
  async list({ status, autopilot_state, customer_id, limit = 50, offset = 0 } = {}) {
    const params = new URLSearchParams()
    if (status) params.set('status', status)
    if (autopilot_state) params.set('autopilot_state', autopilot_state)
    if (customer_id) params.set('customer_id', customer_id)
    params.set('limit', limit.toString())
    params.set('offset', offset.toString())
    
    return invokeFunction(`invoices?${params.toString()}`, { method: 'GET' })
  },
  
  /**
   * Get single invoice with details
   */
  async get(invoiceId) {
    return invokeFunction(`invoices?id=${invoiceId}`, { method: 'GET' })
  },
  
  /**
   * Update invoice (pause/resume/stop)
   */
  async update(invoiceId, updates) {
    return invokeFunction('invoices', {
      method: 'PATCH',
      body: { invoice_id: invoiceId, ...updates },
    })
  },
  
  /**
   * Add note to invoice
   */
  async addNote(invoiceId, note) {
    return invokeFunction('invoices', {
      method: 'POST',
      body: { invoice_id: invoiceId, note },
    })
  },
}

/**
 * Customers API
 */
export const customers = {
  /**
   * List customers
   */
  async list({ limit = 50, offset = 0, search } = {}) {
    const params = new URLSearchParams()
    params.set('limit', limit.toString())
    params.set('offset', offset.toString())
    if (search) params.set('search', search)
    
    return invokeFunction(`customers?${params.toString()}`, { method: 'GET' })
  },
}

/**
 * Integrations API
 */
export const integrations = {
  stripe: {
    /**
     * Get Stripe connection status
     */
    async getStatus() {
      return invokeFunction('integrations-stripe', { method: 'GET' })
    },
    
    /**
     * Connect Stripe with API key
     */
    async connect(secretKey, webhookSecret) {
      return invokeFunction('integrations-stripe', {
        method: 'POST',
        body: { secret_key: secretKey, webhook_secret: webhookSecret },
      })
    },
    
    /**
     * Disconnect Stripe
     */
    async disconnect() {
      return invokeFunction('integrations-stripe', { method: 'DELETE' })
    },
    
    /**
     * Sync data from Stripe
     */
    async sync() {
      return invokeFunction('stripe-sync', { method: 'POST' })
    },
  },
  
  gmail: {
    /**
     * Get Gmail connection status
     */
    async getStatus() {
      return invokeFunction('integrations-gmail', { method: 'GET' })
    },
    
    /**
     * Connect Gmail with OAuth code
     */
    async connect(code, redirectUri) {
      return invokeFunction('integrations-gmail', {
        method: 'POST',
        body: { code, redirect_uri: redirectUri },
      })
    },
    
    /**
     * Disconnect Gmail
     */
    async disconnect() {
      return invokeFunction('integrations-gmail', { method: 'DELETE' })
    },
  },
}

/**
 * Policies API
 */
export const policies = {
  /**
   * Get default policy with steps
   */
  async getDefault() {
    return invokeFunction('policies', { method: 'GET' })
  },
  
  /**
   * Get policy by ID
   */
  async get(policyId) {
    return invokeFunction(`policies?policy_id=${policyId}`, { method: 'GET' })
  },
  
  /**
   * Update policy
   */
  async update(policyId, updates) {
    return invokeFunction('policies', {
      method: 'PATCH',
      body: { policy_id: policyId, ...updates },
    })
  },
  
  /**
   * Update a step
   */
  async updateStep(policyId, stepId, updates) {
    return invokeFunction('policies', {
      method: 'PATCH',
      body: { policy_id: policyId, step_id: stepId, ...updates },
    })
  },
  
  /**
   * Create a new step
   */
  async createStep(policyId, step) {
    return invokeFunction('policies', {
      method: 'POST',
      body: { policy_id: policyId, ...step },
    })
  },
  
  /**
   * Delete a step
   */
  async deleteStep(policyId, stepId) {
    return invokeFunction(`policies?policy_id=${policyId}&step_id=${stepId}`, {
      method: 'DELETE',
    })
  },
}

/**
 * Onboarding API
 */
export const onboarding = {
  /**
   * Get onboarding status
   */
  async getStatus() {
    return invokeFunction('onboarding', { method: 'GET' })
  },
  
  /**
   * Get import preview
   */
  async getPreview() {
    return invokeFunction('onboarding?action=preview', { method: 'GET' })
  },
  
  /**
   * Get scheduled reminders preview
   */
  async getScheduledPreview() {
    return invokeFunction('onboarding?action=scheduled-preview', { method: 'GET' })
  },
  
  /**
   * Send test email
   */
  async sendTestEmail() {
    return invokeFunction('onboarding?action=test-email', { method: 'POST' })
  },
  
  /**
   * Complete onboarding
   */
  async complete() {
    return invokeFunction('onboarding?action=complete', { method: 'POST' })
  },
}

/**
 * Health API
 */
export const health = {
  /**
   * Get system health status
   */
  async getStatus() {
    return invokeFunction('health', { method: 'GET' })
  },
}

/**
 * Notifications API
 */
export const notifications = {
  /**
   * List notifications
   */
  async list({ unreadOnly = false, limit = 50 } = {}) {
    const params = new URLSearchParams()
    if (unreadOnly) params.set('unread_only', 'true')
    params.set('limit', limit.toString())
    
    return invokeFunction(`notifications?${params.toString()}`, { method: 'GET' })
  },
  
  /**
   * Mark notification as read
   */
  async markRead(notificationId) {
    return invokeFunction('notifications', {
      method: 'PATCH',
      body: { notification_id: notificationId },
    })
  },
  
  /**
   * Mark all as read
   */
  async markAllRead() {
    return invokeFunction('notifications', { method: 'POST' })
  },
}

/**
 * Jobs API (admin)
 */
export const jobs = {
  /**
   * Run scheduler manually
   */
  async runScheduler() {
    return invokeFunction('scheduler', { method: 'POST' })
  },
  
  /**
   * Run reply check manually
   */
  async runReplyCheck() {
    return invokeFunction('check-replies', { method: 'POST' })
  },
}

// Export all as default
export default {
  workspaces,
  dashboard,
  invoices,
  customers,
  integrations,
  policies,
  onboarding,
  health,
  notifications,
  jobs,
}
