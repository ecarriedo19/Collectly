/**
 * Health Status Edge Function
 * 
 * Returns system health information for the workspace:
 * - Integration connection status
 * - Sync status
 * - Scheduler status
 * - Warnings/alerts
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUser } from '../_shared/supabase.ts'

interface Warning {
  type: string
  message: string
  action: string
}

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const { user, supabase } = await getUser(req)

    // Get user's workspace
    const { data: membership, error: memberError } = await supabase
      .from('workspace_members')
      .select('workspace_id')
      .eq('user_id', user.id)
      .single()

    if (memberError || !membership) {
      return jsonResponse({ status: 'no_workspace' })
    }

    const workspaceId = membership.workspace_id

    // Get health record
    const { data: health } = await supabase
      .from('system_health')
      .select('*')
      .eq('workspace_id', workspaceId)
      .single()

    // Get connections
    const { data: stripeConn } = await supabase
      .from('stripe_connections')
      .select('stripe_account_id, connected_at, last_sync_at, is_connected')
      .eq('workspace_id', workspaceId)
      .single()

    const { data: gmailConn } = await supabase
      .from('gmail_connections')
      .select('google_user_email, connected_at, is_connected')
      .eq('workspace_id', workspaceId)
      .single()

    // Get onboarding status
    const { data: onboarding } = await supabase
      .from('workspace_onboarding')
      .select('completed')
      .eq('workspace_id', workspaceId)
      .single()

    // Calculate warnings
    const warnings: Warning[] = []
    const now = new Date()

    // Webhook warning (6 hours)
    if (stripeConn?.is_connected) {
      const webhookLast = health?.stripe_webhook_last_received
      if (webhookLast) {
        const webhookTime = new Date(webhookLast)
        if ((now.getTime() - webhookTime.getTime()) > 6 * 60 * 60 * 1000) {
          warnings.push({
            type: 'webhook_stale',
            message: 'No webhook received in 6+ hours. Webhooks may be misconfigured.',
            action: 'test_webhook',
          })
        }
      } else {
        warnings.push({
          type: 'webhook_never',
          message: 'No webhooks received yet. Please configure your Stripe webhook.',
          action: 'configure_webhook',
        })
      }
    }

    // Scheduler warning (30 minutes)
    const schedulerLast = health?.scheduler_last_run
    if (schedulerLast) {
      const schedulerTime = new Date(schedulerLast)
      if ((now.getTime() - schedulerTime.getTime()) > 30 * 60 * 1000) {
        warnings.push({
          type: 'scheduler_delayed',
          message: 'Scheduler hasn\'t run in 30+ minutes.',
          action: 'run_scheduler',
        })
      }
    }

    // Sync error warning
    if (health?.stripe_sync_status === 'error') {
      warnings.push({
        type: 'sync_error',
        message: `Last sync failed: ${health?.stripe_sync_error || 'Unknown error'}`,
        action: 'retry_sync',
      })
    }

    return jsonResponse({
      stripe_connected: stripeConn?.is_connected || false,
      gmail_connected: gmailConn?.is_connected || false,
      stripe_sync: {
        status: health?.stripe_sync_status || 'never',
        last_run: health?.stripe_sync_last_run || null,
        error: health?.stripe_sync_error || null,
      },
      stripe_webhook: {
        status: health?.stripe_webhook_status || 'never',
        last_received: health?.stripe_webhook_last_received || null,
      },
      scheduler: {
        status: health?.scheduler_status || 'never',
        last_run: health?.scheduler_last_run || null,
      },
      reply_check: {
        status: health?.reply_check_status || 'never',
        last_run: health?.reply_check_last_run || null,
      },
      warnings,
      onboarding_complete: onboarding?.completed || false,
    })

  } catch (error) {
    console.error('Health function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
