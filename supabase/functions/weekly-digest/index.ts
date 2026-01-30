/**
 * Weekly Digest Edge Function
 * 
 * Sends weekly AR summary emails to workspace owners.
 * Called by pg_cron every Monday at 9 AM UTC.
 * 
 * POST /weekly-digest
 * - Requires service role authorization (from pg_cron)
 * - Iterates all workspaces with digest enabled
 * - Aggregates AR metrics
 * - Sends via Resend
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase.ts'
import { sendDigestEmail } from '../_shared/resend.ts'
import { formatCurrency } from '../_shared/stripe.ts'

interface DigestStats {
  workspaceId: string
  workspaceName: string
  ownerEmail: string
  totalOpen: number
  totalOpenAmount: number
  pastDueCount: number
  pastDueAmount: number
  collected7d: number
  collected7dAmount: number
  emailsSent7d: number
  replies7d: number
  currency: string
  topInvoices: Array<{
    customer: string
    amount: number
    daysOverdue: number
  }>
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  console.log('Running weekly digest...')

  let sent = 0
  let failed = 0

  try {
    // Get all workspaces with owners
    // In future: add digest_enabled column to workspaces table
    const { data: workspaces, error: wsError } = await supabaseAdmin
      .from('workspaces')
      .select(`
        id,
        name,
        owner_id,
        users!workspaces_owner_id_fkey (
          email
        )
      `)

    if (wsError) {
      console.error('Failed to fetch workspaces:', wsError)
      return errorResponse('Failed to fetch workspaces', 500)
    }

    if (!workspaces || workspaces.length === 0) {
      return jsonResponse({ sent: 0, failed: 0, message: 'No workspaces found' })
    }

    const now = new Date()
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)

    for (const workspace of workspaces) {
      try {
        const stats = await gatherWorkspaceStats(
          workspace.id,
          workspace.name,
          weekAgo.toISOString()
        )

        if (!stats) {
          continue
        }

        // Get owner email from joined users table
        const ownerEmail = (workspace.users as any)?.email
        if (!ownerEmail) {
          console.log(`No owner email for workspace ${workspace.id}`)
          continue
        }

        // Format amounts for display
        const result = await sendDigestEmail({
          to: ownerEmail,
          workspaceName: stats.workspaceName,
          totalOpen: stats.totalOpen,
          totalOpenAmount: formatCurrency(stats.totalOpenAmount, stats.currency),
          pastDueCount: stats.pastDueCount,
          pastDueAmount: formatCurrency(stats.pastDueAmount, stats.currency),
          collected7d: stats.collected7d,
          collected7dAmount: formatCurrency(stats.collected7dAmount, stats.currency),
          emailsSent7d: stats.emailsSent7d,
          replies7d: stats.replies7d,
          topInvoices: stats.topInvoices.map(inv => ({
            customer: inv.customer,
            amount: formatCurrency(inv.amount, stats.currency),
            daysOverdue: inv.daysOverdue,
          })),
        })

        if (result) {
          sent++
          console.log(`Sent digest to ${ownerEmail} for workspace ${workspace.name}`)
        } else {
          failed++
          console.error(`Failed to send digest to ${ownerEmail}`)
        }
      } catch (error) {
        failed++
        console.error(`Error processing workspace ${workspace.id}:`, error)
      }
    }

    console.log(`Weekly digest complete. Sent: ${sent}, Failed: ${failed}`)
    return jsonResponse({ sent, failed })

  } catch (error) {
    console.error('Weekly digest error:', error)
    return errorResponse('Weekly digest failed', 500)
  }
})

/**
 * Gather AR statistics for a workspace
 */
async function gatherWorkspaceStats(
  workspaceId: string,
  workspaceName: string,
  weekAgoIso: string
): Promise<DigestStats | null> {
  const now = new Date()

  // Get open invoices
  const { data: openInvoices } = await supabaseAdmin
    .from('invoices')
    .select('id, amount_cents, currency, due_date, customer_id')
    .eq('workspace_id', workspaceId)
    .in('status', ['open', 'past_due'])

  if (!openInvoices) {
    return null
  }

  // Calculate totals
  let totalOpen = 0
  let totalOpenAmount = 0
  let pastDueCount = 0
  let pastDueAmount = 0
  let currency = 'usd'

  const pastDueInvoices: Array<{
    customerId: string
    amount: number
    daysOverdue: number
  }> = []

  for (const invoice of openInvoices) {
    totalOpen++
    totalOpenAmount += invoice.amount_cents
    currency = invoice.currency || 'usd'

    const dueDate = new Date(invoice.due_date)
    if (dueDate < now) {
      pastDueCount++
      pastDueAmount += invoice.amount_cents
      pastDueInvoices.push({
        customerId: invoice.customer_id,
        amount: invoice.amount_cents,
        daysOverdue: Math.floor((now.getTime() - dueDate.getTime()) / (1000 * 60 * 60 * 24)),
      })
    }
  }

  // Get paid invoices in last 7 days
  const { data: paidInvoices } = await supabaseAdmin
    .from('invoices')
    .select('id, amount_cents')
    .eq('workspace_id', workspaceId)
    .eq('status', 'paid')
    .gte('paid_at', weekAgoIso)

  const collected7d = paidInvoices?.length || 0
  const collected7dAmount = paidInvoices?.reduce((sum, inv) => sum + inv.amount_cents, 0) || 0

  // Get email activity
  const { count: emailsSent7d } = await supabaseAdmin
    .from('email_events')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('event_type', 'sent')
    .gte('created_at', weekAgoIso)

  const { count: replies7d } = await supabaseAdmin
    .from('email_events')
    .select('*', { count: 'exact', head: true })
    .eq('workspace_id', workspaceId)
    .eq('event_type', 'replied')
    .gte('created_at', weekAgoIso)

  // Get customer names for top past due
  const topPastDue = pastDueInvoices
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 5)

  const customerIds = [...new Set(topPastDue.map(inv => inv.customerId))]
  
  const { data: customers } = await supabaseAdmin
    .from('customers')
    .select('id, name, email')
    .in('id', customerIds)

  const customerMap = new Map(
    (customers || []).map(c => [c.id, c.name || c.email || 'Unknown'])
  )

  const topInvoices = topPastDue.map(inv => ({
    customer: customerMap.get(inv.customerId) || 'Unknown',
    amount: inv.amount,
    daysOverdue: inv.daysOverdue,
  }))

  return {
    workspaceId,
    workspaceName,
    ownerEmail: '', // Filled by caller
    totalOpen,
    totalOpenAmount,
    pastDueCount,
    pastDueAmount,
    collected7d,
    collected7dAmount,
    emailsSent7d: emailsSent7d || 0,
    replies7d: replies7d || 0,
    currency,
    topInvoices,
  }
}
