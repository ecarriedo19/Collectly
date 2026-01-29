/**
 * Stripe Webhook Edge Function
 * 
 * Handles incoming Stripe webhooks:
 * - invoice.paid
 * - invoice.payment_failed
 * - invoice.voided
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  // Webhooks only accept POST
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const payload = await req.text()
    const signature = req.headers.get('Stripe-Signature')

    if (!signature) {
      console.warn('No Stripe signature header')
      // Allow processing without signature for development
    }

    // Try to verify signature with any workspace's webhook secret
    let event: Stripe.Event | null = null
    let workspaceId: string | null = null

    if (signature) {
      const { data: connections } = await supabaseAdmin
        .from('stripe_connections')
        .select('workspace_id, webhook_secret')
        .not('webhook_secret', 'is', null)

      for (const conn of connections || []) {
        try {
          const stripe = new Stripe('', { apiVersion: '2023-10-16' })
          event = stripe.webhooks.constructEvent(payload, signature, conn.webhook_secret!)
          workspaceId = conn.workspace_id
          break
        } catch {
          // Try next connection
          continue
        }
      }
    }

    // If signature verification failed, try to parse as JSON for development
    if (!event) {
      try {
        event = JSON.parse(payload) as Stripe.Event
        console.warn('Processing webhook without signature verification')
      } catch {
        return errorResponse('Invalid webhook payload', 400)
      }
    }

    console.log(`Received Stripe webhook: ${event.type}`)

    const eventData = event.data.object as Stripe.Invoice

    // Handle invoice.paid
    if (event.type === 'invoice.paid' || event.type === 'invoice.payment_succeeded') {
      const { data: invoice } = await supabaseAdmin
        .from('invoices')
        .select('id, workspace_id')
        .eq('stripe_invoice_id', eventData.id)
        .single()

      if (invoice) {
        await supabaseAdmin
          .from('invoices')
          .update({
            status: 'paid',
            autopilot_state: 'stopped_paid',
            paid_at: new Date().toISOString(),
          })
          .eq('id', invoice.id)

        // Create notification
        const { data: workspace } = await supabaseAdmin
          .from('workspaces')
          .select('owner_id')
          .eq('id', invoice.workspace_id)
          .single()

        if (workspace) {
          await supabaseAdmin.from('notifications').insert({
            workspace_id: invoice.workspace_id,
            user_id: workspace.owner_id,
            type: 'invoice_paid',
            title: 'Invoice Paid',
            message: `Invoice ${eventData.id.slice(-8).toUpperCase()} has been paid`,
            payload: {
              invoice_id: invoice.id,
              amount: eventData.amount_paid,
              currency: eventData.currency,
            },
          })
        }

        console.log(`Invoice ${eventData.id} marked as paid`)
        workspaceId = invoice.workspace_id
      }
    }

    // Handle invoice.payment_failed
    if (event.type === 'invoice.payment_failed') {
      await supabaseAdmin
        .from('invoices')
        .update({ status: 'past_due' })
        .eq('stripe_invoice_id', eventData.id)

      console.log(`Invoice ${eventData.id} marked as past_due`)
    }

    // Handle invoice.voided
    if (event.type === 'invoice.voided') {
      await supabaseAdmin
        .from('invoices')
        .update({
          status: 'void',
          autopilot_state: 'stopped_manual',
        })
        .eq('stripe_invoice_id', eventData.id)

      console.log(`Invoice ${eventData.id} marked as void`)
    }

    // Update webhook health status
    if (workspaceId) {
      await supabaseAdmin
        .from('system_health')
        .update({
          stripe_webhook_status: 'ok',
          stripe_webhook_last_received: new Date().toISOString(),
        })
        .eq('workspace_id', workspaceId)
    }

    return jsonResponse({ received: true })

  } catch (error) {
    console.error('Stripe webhook error:', error)
    return errorResponse('Webhook processing failed', 500)
  }
})
