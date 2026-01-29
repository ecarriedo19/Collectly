/**
 * Check Replies Edge Function
 * 
 * Checks Gmail threads for customer replies.
 * Called by pg_cron every 5 minutes.
 * 
 * For each workspace:
 * 1. Get recent email events with gmail_thread_id
 * 2. Check each thread for replies
 * 3. If reply found, pause invoice and create notification
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase.ts'
import { getGmailTokens, checkThreadForReplies } from '../_shared/gmail.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  console.log('Running reply check...')
  
  let totalChecked = 0
  let repliesFound = 0

  try {
    // Get all workspaces with Gmail connected
    const { data: gmailConnections } = await supabaseAdmin
      .from('gmail_connections')
      .select('workspace_id')
      .eq('is_connected', true)

    if (!gmailConnections || gmailConnections.length === 0) {
      return jsonResponse({ checked: 0, replies: 0 })
    }

    const now = new Date()
    // Check emails from last 7 days
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString()

    for (const { workspace_id: workspaceId } of gmailConnections) {
      // Update health status
      await supabaseAdmin
        .from('system_health')
        .update({
          reply_check_status: 'ok',
          reply_check_last_run: now.toISOString(),
        })
        .eq('workspace_id', workspaceId)

      // Get Gmail tokens
      const tokens = await getGmailTokens(workspaceId)
      if (!tokens) {
        continue
      }

      // Get recent sent emails with thread IDs
      const { data: events } = await supabaseAdmin
        .from('email_events')
        .select(`
          id,
          invoice_id,
          gmail_thread_id,
          gmail_message_id,
          invoices (
            id,
            autopilot_state,
            customer_id,
            workspace_id
          )
        `)
        .eq('workspace_id', workspaceId)
        .eq('event_type', 'sent')
        .not('gmail_thread_id', 'is', null)
        .gte('created_at', weekAgo)

      if (!events || events.length === 0) {
        continue
      }

      for (const event of events) {
        // Skip if invoice already paused
        const invoice = event.invoices as any
        if (!invoice || invoice.autopilot_state !== 'active') {
          continue
        }

        totalChecked++

        try {
          const replies = await checkThreadForReplies(
            tokens.access_token,
            event.gmail_thread_id!,
            event.gmail_message_id!
          )

          if (replies.length > 0) {
            repliesFound++
            
            // Pause the invoice
            await supabaseAdmin
              .from('invoices')
              .update({ autopilot_state: 'paused_replied' })
              .eq('id', invoice.id)

            // Log the reply event
            const reply = replies[0]
            await supabaseAdmin.from('email_events').insert({
              workspace_id: workspaceId,
              invoice_id: invoice.id,
              customer_id: invoice.customer_id,
              direction: 'inbound',
              event_type: 'replied',
              gmail_message_id: reply.id,
              gmail_thread_id: event.gmail_thread_id,
              snippet: reply.snippet,
              received_at: now.toISOString(),
            })

            // Create notification
            const { data: workspace } = await supabaseAdmin
              .from('workspaces')
              .select('owner_id')
              .eq('id', workspaceId)
              .single()

            const { data: customer } = await supabaseAdmin
              .from('customers')
              .select('name, email')
              .eq('id', invoice.customer_id)
              .single()

            if (workspace) {
              await supabaseAdmin.from('notifications').insert({
                workspace_id: workspaceId,
                user_id: workspace.owner_id,
                type: 'reply_received',
                title: 'Customer Replied',
                message: `${customer?.name || customer?.email || 'A customer'} replied to your invoice reminder`,
                payload: {
                  invoice_id: invoice.id,
                  customer_id: invoice.customer_id,
                  snippet: reply.snippet?.slice(0, 100),
                },
              })
            }

            console.log(`Reply detected for invoice ${invoice.id}`)
          }
        } catch (error) {
          console.error(`Error checking thread ${event.gmail_thread_id}:`, error)
        }
      }
    }

    console.log(`Reply check complete. Checked: ${totalChecked}, Replies: ${repliesFound}`)
    return jsonResponse({ checked: totalChecked, replies: repliesFound })

  } catch (error) {
    console.error('Reply check error:', error)
    return errorResponse('Reply check failed', 500)
  }
})
