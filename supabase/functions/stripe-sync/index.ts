/**
 * Stripe Sync Edge Function
 * 
 * Syncs customers and invoices from Stripe to the database.
 * - Fetches all customers
 * - Fetches open invoices and paid invoices from last 60 days
 * - Updates local database
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUser, supabaseAdmin } from '../_shared/supabase.ts'
import { mapStripeStatus } from '../_shared/stripe.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'POST') {
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
      return errorResponse('Workspace not found', 404)
    }

    const workspaceId = membership.workspace_id

    // Get Stripe connection
    const { data: connection, error: connError } = await supabaseAdmin
      .from('stripe_connections')
      .select('secret_key')
      .eq('workspace_id', workspaceId)
      .single()

    if (connError || !connection?.secret_key) {
      return errorResponse('Stripe not connected', 400)
    }

    const stripe = new Stripe(connection.secret_key, {
      apiVersion: '2023-10-16',
      httpClient: Stripe.createFetchHttpClient(),
    })

    let customersSynced = 0
    let invoicesSynced = 0

    // Sync customers
    const customers = await stripe.customers.list({ limit: 100 })
    
    for (const customer of customers.data) {
      const { error } = await supabaseAdmin
        .from('customers')
        .upsert({
          workspace_id: workspaceId,
          stripe_customer_id: customer.id,
          name: customer.name || null,
          email: customer.email || null,
        }, {
          onConflict: 'workspace_id,stripe_customer_id',
        })

      if (!error) customersSynced++
    }

    // Sync invoices (open and paid from last 60 days)
    const sixtyDaysAgo = Math.floor((Date.now() - 60 * 24 * 60 * 60 * 1000) / 1000)

    for (const status of ['open', 'paid'] as const) {
      const invoices = await stripe.invoices.list({
        limit: 100,
        status,
        ...(status === 'paid' && { created: { gte: sixtyDaysAgo } }),
      })

      for (const invoice of invoices.data) {
        // Get local customer ID
        const { data: localCustomer } = await supabaseAdmin
          .from('customers')
          .select('id')
          .eq('workspace_id', workspaceId)
          .eq('stripe_customer_id', invoice.customer as string)
          .single()

        const dueDate = invoice.due_date 
          ? new Date(invoice.due_date * 1000).toISOString()
          : null

        const invoiceStatus = mapStripeStatus(invoice.status || 'open', dueDate)
        
        // Determine autopilot state
        let autopilotState = 'active'
        if (invoiceStatus === 'paid') {
          autopilotState = 'stopped_paid'
        } else if (invoiceStatus === 'void' || invoiceStatus === 'uncollectible') {
          autopilotState = 'stopped_manual'
        }

        const { error } = await supabaseAdmin
          .from('invoices')
          .upsert({
            workspace_id: workspaceId,
            stripe_invoice_id: invoice.id,
            stripe_customer_id: invoice.customer as string,
            customer_id: localCustomer?.id || null,
            status: invoiceStatus,
            autopilot_state: autopilotState,
            amount_cents: invoice.amount_due,
            currency: invoice.currency,
            due_date: dueDate,
            issued_at: invoice.created 
              ? new Date(invoice.created * 1000).toISOString() 
              : null,
            paid_at: invoice.status === 'paid' && invoice.status_transitions?.paid_at
              ? new Date(invoice.status_transitions.paid_at * 1000).toISOString()
              : null,
            hosted_invoice_url: invoice.hosted_invoice_url || null,
          }, {
            onConflict: 'workspace_id,stripe_invoice_id',
          })

        if (!error) invoicesSynced++
      }
    }

    // Update last sync time
    await supabaseAdmin
      .from('stripe_connections')
      .update({ last_sync_at: new Date().toISOString() })
      .eq('workspace_id', workspaceId)

    // Update system health
    await supabaseAdmin
      .from('system_health')
      .update({
        stripe_sync_status: 'ok',
        stripe_sync_last_run: new Date().toISOString(),
        stripe_sync_error: null,
      })
      .eq('workspace_id', workspaceId)

    // Update onboarding if data imported
    if (invoicesSynced > 0) {
      await supabaseAdmin
        .from('workspace_onboarding')
        .update({ data_imported: true })
        .eq('workspace_id', workspaceId)
    }

    return jsonResponse({
      success: true,
      customers_synced: customersSynced,
      invoices_synced: invoicesSynced,
    })

  } catch (error) {
    console.error('Stripe sync error:', error)

    // Log error to system health
    try {
      const { user, supabase } = await getUser(req)
      const { data: membership } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .single()

      if (membership) {
        await supabaseAdmin
          .from('system_health')
          .update({
            stripe_sync_status: 'error',
            stripe_sync_last_run: new Date().toISOString(),
            stripe_sync_error: error instanceof Error ? error.message : 'Unknown error',
          })
          .eq('workspace_id', membership.workspace_id)
      }
    } catch {
      // Ignore logging errors
    }

    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }

    return errorResponse(`Sync failed: ${error instanceof Error ? error.message : 'Unknown error'}`, 500)
  }
})
