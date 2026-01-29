/**
 * Onboarding Edge Function
 * 
 * Handles onboarding flow:
 * - GET: Get onboarding status
 * - GET ?action=preview: Get import preview
 * - POST ?action=test-email: Send test email
 * - POST ?action=complete: Complete onboarding
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUser, supabaseAdmin } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { user, supabase } = await getUser(req)
    const url = new URL(req.url)
    const action = url.searchParams.get('action')
    const method = req.method

    // Get user's workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (memberError || !membership) {
      return jsonResponse({
        has_workspace: false,
        steps: {
          workspace: false,
          stripe: false,
          import: false,
          gmail: false,
          test_email: false,
          autopilot: false,
        },
        current_step: 'workspace',
        is_complete: false,
      })
    }

    const workspaceId = membership.workspace_id

    // GET - Get onboarding status
    if (method === 'GET' && !action) {
      // Get onboarding record
      const { data: onboarding } = await supabase
        .from('workspace_onboarding')
        .select('*')
        .eq('workspace_id', workspaceId)
        .single()

      // Get workspace
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('*')
        .eq('id', workspaceId)
        .single()

      // Get connections
      const { data: stripeConn } = await supabase
        .from('stripe_connections')
        .select('is_connected')
        .eq('workspace_id', workspaceId)
        .single()

      const { data: gmailConn } = await supabase
        .from('gmail_connections')
        .select('is_connected, google_user_email')
        .eq('workspace_id', workspaceId)
        .single()

      // Get invoice count
      const { count: invoiceCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)

      const steps = {
        workspace: true,
        stripe: onboarding?.stripe_connected || false,
        import: onboarding?.data_imported || (invoiceCount || 0) > 0,
        gmail: onboarding?.gmail_connected || false,
        test_email: onboarding?.test_email_sent || false,
        autopilot: onboarding?.autopilot_enabled || false,
      }

      // Determine current step
      let currentStep = 'stripe'
      if (steps.stripe) currentStep = 'import'
      if (steps.import) currentStep = 'gmail'
      if (steps.gmail) currentStep = 'test_email'
      if (steps.test_email) currentStep = 'autopilot'
      if (steps.autopilot) currentStep = 'complete'

      return jsonResponse({
        has_workspace: true,
        workspace,
        steps,
        current_step: currentStep,
        is_complete: onboarding?.completed || false,
        stripe_connected: stripeConn?.is_connected || false,
        gmail_connected: gmailConn?.is_connected || false,
        invoice_count: invoiceCount || 0,
        gmail_email: gmailConn?.google_user_email || null,
      })
    }

    // GET ?action=preview - Get import preview
    if (method === 'GET' && action === 'preview') {
      const { count: customerCount } = await supabase
        .from('customers')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)

      const { count: openCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'open')

      const { count: pastDueCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'past_due')

      const { count: paidCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('status', 'paid')

      const { count: totalCount } = await supabase
        .from('invoices')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)

      // Get total AR
      const { data: arInvoices } = await supabase
        .from('invoices')
        .select('amount_cents, currency')
        .eq('workspace_id', workspaceId)
        .in('status', ['open', 'past_due'])

      const totalAr = (arInvoices || []).reduce((sum, inv) => sum + inv.amount_cents, 0)
      const currency = arInvoices?.[0]?.currency || 'usd'

      return jsonResponse({
        customers: customerCount || 0,
        invoices: {
          total: totalCount || 0,
          open: openCount || 0,
          past_due: pastDueCount || 0,
          paid: paidCount || 0,
        },
        total_ar_cents: totalAr,
        currency,
      })
    }

    // POST ?action=test-email - Send test email
    if (method === 'POST' && action === 'test-email') {
      // Get user details
      const { data: userProfile } = await supabase
        .from('users')
        .select('email, name')
        .eq('id', user.id)
        .single()

      // Get workspace
      const { data: workspace } = await supabase
        .from('workspaces')
        .select('name')
        .eq('id', workspaceId)
        .single()

      // For now, we'll mark the test as sent (actual email sending requires Resend setup)
      // In production, this would send via Resend or Gmail API
      
      // Log the test email event
      await supabase.from('email_events').insert({
        workspace_id: workspaceId,
        direction: 'outbound',
        event_type: 'test_sent',
        subject: `Test Reminder from ${workspace?.name || 'Collectly'}`,
        snippet: 'Test email simulated successfully',
        sent_at: new Date().toISOString(),
        metadata: { 
          recipient: userProfile?.email,
          simulated: true,
        },
      })

      // Update onboarding
      await supabaseAdmin
        .from('workspace_onboarding')
        .update({ test_email_sent: true })
        .eq('workspace_id', workspaceId)

      return jsonResponse({
        success: true,
        message: `Test email simulated for ${userProfile?.email}`,
        method: 'simulated',
      })
    }

    // POST ?action=complete - Complete onboarding
    if (method === 'POST' && action === 'complete') {
      // Enable default policy
      await supabaseAdmin
        .from('reminder_policies')
        .update({ is_enabled: true })
        .eq('workspace_id', workspaceId)
        .eq('is_default', true)

      // Mark onboarding complete
      await supabaseAdmin
        .from('workspace_onboarding')
        .update({
          autopilot_enabled: true,
          completed: true,
          completed_at: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)

      return jsonResponse({
        success: true,
        message: 'Onboarding complete! Autopilot is now active.',
      })
    }

    return errorResponse('Invalid action', 400)

  } catch (error) {
    console.error('Onboarding function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
