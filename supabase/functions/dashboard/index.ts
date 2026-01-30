/**
 * Dashboard Edge Function
 * 
 * Returns KPI summary metrics for the workspace:
 * - Total open invoices and amount
 * - Total past due invoices and amount
 * - Paid this month count and amount
 * - Paused invoices count
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUserWithWorkspace } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const { user, supabase, workspaceId } = await getUserWithWorkspace(req)

    // Get open invoices
    const { data: openInvoices, error: openError } = await supabase
      .from('invoices')
      .select('amount_cents, currency')
      .eq('workspace_id', workspaceId)
      .eq('status', 'open')

    if (openError) {
      console.error('Open invoices query error:', openError)
    }

    // Get past due invoices
    const { data: pastDueInvoices, error: pastDueError } = await supabase
      .from('invoices')
      .select('amount_cents, currency')
      .eq('workspace_id', workspaceId)
      .eq('status', 'past_due')

    if (pastDueError) {
      console.error('Past due invoices query error:', pastDueError)
    }

    // Get paid this month
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString()
    
    const { data: paidInvoices, error: paidError } = await supabase
      .from('invoices')
      .select('amount_cents, currency')
      .eq('workspace_id', workspaceId)
      .eq('status', 'paid')
      .gte('paid_at', monthStart)

    if (paidError) {
      console.error('Paid invoices query error:', paidError)
    }

    // Get paused count
    const { count: pausedCount, error: pausedError } = await supabase
      .from('invoices')
      .select('*', { count: 'exact', head: true })
      .eq('workspace_id', workspaceId)
      .in('autopilot_state', ['paused_replied', 'paused_manual'])

    if (pausedError) {
      console.error('Paused invoices query error:', pausedError)
    }

    // Calculate totals
    const open = openInvoices || []
    const pastDue = pastDueInvoices || []
    const paid = paidInvoices || []

    const totalOpenAmount = open.reduce((sum, inv) => sum + (inv.amount_cents || 0), 0)
    const totalPastDueAmount = pastDue.reduce((sum, inv) => sum + (inv.amount_cents || 0), 0)
    const paidThisMonthAmount = paid.reduce((sum, inv) => sum + (inv.amount_cents || 0), 0)

    // Get currency from first invoice or default to USD
    const currency = open[0]?.currency || pastDue[0]?.currency || paid[0]?.currency || 'usd'

    return jsonResponse({
      total_open: open.length,
      total_open_amount: totalOpenAmount,
      total_past_due: pastDue.length,
      total_past_due_amount: totalPastDueAmount,
      paid_this_month: paid.length,
      paid_this_month_amount: paidThisMonthAmount,
      invoices_paused: pausedCount || 0,
      currency,
    })

  } catch (error) {
    console.error('Dashboard function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
