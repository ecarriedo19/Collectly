/**
 * Scheduler Edge Function
 * 
 * Processes reminder queue and sends emails.
 * Called by pg_cron every 15 minutes.
 * 
 * For each workspace:
 * 1. Get active invoices needing action
 * 2. Find applicable reminder step
 * 3. Check rate limits
 * 4. Send email via Gmail
 * 5. Update invoice next_action_at
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase.ts'
import { getGmailTokens, sendGmailEmail } from '../_shared/gmail.ts'
import { formatCurrency } from '../_shared/stripe.ts'

interface Invoice {
  id: string
  workspace_id: string
  customer_id: string
  stripe_invoice_id: string
  amount_cents: number
  currency: string
  due_date: string
  hosted_invoice_url: string
  autopilot_state: string
}

interface Customer {
  id: string
  name: string | null
  email: string | null
}

interface ReminderStep {
  id: string
  step_order: number
  trigger_type: string
  trigger_offset_days: number
  subject_template: string
  body_template: string
}

interface Policy {
  id: string
  max_emails_per_week_per_customer: number
  email_footer: string
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  // Optional: Verify this is from pg_cron or authenticated user
  // For now, we allow any POST request (should add security in production)

  console.log('Running reminder scheduler...')
  
  let totalProcessed = 0
  let totalSent = 0

  try {
    // Get all workspaces with Gmail connected
    const { data: gmailConnections } = await supabaseAdmin
      .from('gmail_connections')
      .select('workspace_id')
      .eq('is_connected', true)

    if (!gmailConnections || gmailConnections.length === 0) {
      console.log('No workspaces with Gmail connected')
      return jsonResponse({ processed: 0, sent: 0 })
    }

    const now = new Date()

    for (const { workspace_id: workspaceId } of gmailConnections) {
      // Update scheduler health
      await supabaseAdmin
        .from('system_health')
        .update({
          scheduler_status: 'ok',
          scheduler_last_run: now.toISOString(),
        })
        .eq('workspace_id', workspaceId)

      // Get default policy
      const { data: policy } = await supabaseAdmin
        .from('reminder_policies')
        .select('id, max_emails_per_week_per_customer, email_footer')
        .eq('workspace_id', workspaceId)
        .eq('is_default', true)
        .eq('is_enabled', true)
        .single()

      if (!policy) {
        console.log(`No enabled policy for workspace ${workspaceId}`)
        continue
      }

      // Get enabled steps
      const { data: steps } = await supabaseAdmin
        .from('reminder_steps')
        .select('*')
        .eq('policy_id', policy.id)
        .eq('is_enabled', true)
        .order('step_order', { ascending: true })

      if (!steps || steps.length === 0) {
        continue
      }

      // Get workspace info
      const { data: workspace } = await supabaseAdmin
        .from('workspaces')
        .select('name')
        .eq('id', workspaceId)
        .single()

      // Get invoices needing action
      const { data: invoices } = await supabaseAdmin
        .from('invoices')
        .select('*')
        .eq('workspace_id', workspaceId)
        .in('status', ['open', 'past_due'])
        .eq('autopilot_state', 'active')
        .or(`next_action_at.lte.${now.toISOString()},next_action_at.is.null`)
        .limit(50)

      if (!invoices || invoices.length === 0) {
        continue
      }

      // Get Gmail tokens
      const tokens = await getGmailTokens(workspaceId)
      if (!tokens) {
        console.log(`No valid Gmail tokens for workspace ${workspaceId}`)
        continue
      }

      for (const invoice of invoices) {
        totalProcessed++

        try {
          await processInvoice(
            invoice as Invoice,
            policy as Policy,
            steps as ReminderStep[],
            tokens.access_token,
            workspace?.name || 'Collectly',
            workspaceId
          )
          totalSent++
        } catch (error) {
          console.error(`Error processing invoice ${invoice.id}:`, error)
        }
      }
    }

    console.log(`Scheduler complete. Processed: ${totalProcessed}, Sent: ${totalSent}`)
    return jsonResponse({ processed: totalProcessed, sent: totalSent })

  } catch (error) {
    console.error('Scheduler error:', error)
    return errorResponse('Scheduler failed', 500)
  }
})

async function processInvoice(
  invoice: Invoice,
  policy: Policy,
  steps: ReminderStep[],
  accessToken: string,
  companyName: string,
  workspaceId: string
): Promise<void> {
  // Get customer
  const { data: customer } = await supabaseAdmin
    .from('customers')
    .select('id, name, email')
    .eq('id', invoice.customer_id)
    .single()

  if (!customer?.email) {
    console.log(`No email for customer ${invoice.customer_id}`)
    return
  }

  // Check rate limit
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString()
  const { count: recentEmails } = await supabaseAdmin
    .from('email_events')
    .select('*', { count: 'exact', head: true })
    .eq('customer_id', customer.id)
    .eq('event_type', 'sent')
    .gte('created_at', weekAgo)

  if ((recentEmails || 0) >= policy.max_emails_per_week_per_customer) {
    console.log(`Rate limit reached for customer ${customer.id}`)
    return
  }

  // Find applicable step
  const dueDate = new Date(invoice.due_date)
  const now = new Date()
  const daysUntilDue = Math.floor((dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  let applicableStep: ReminderStep | null = null

  for (const step of steps) {
    let shouldSend = false

    if (step.trigger_type === 'before_due' && daysUntilDue === step.trigger_offset_days) {
      shouldSend = true
    } else if (step.trigger_type === 'on_due' && daysUntilDue === 0) {
      shouldSend = true
    } else if (step.trigger_type === 'after_due' && daysUntilDue === -step.trigger_offset_days) {
      shouldSend = true
    }

    if (shouldSend) {
      // Check if already sent
      const { data: existing } = await supabaseAdmin
        .from('email_events')
        .select('id')
        .eq('invoice_id', invoice.id)
        .eq('event_type', 'sent')
        .eq('metadata->step_id', step.id)
        .single()

      if (!existing) {
        applicableStep = step
        break
      }
    }
  }

  if (!applicableStep) {
    // Calculate next action time
    let nextAction: Date | null = null
    
    for (const step of steps) {
      let stepDate: Date

      if (step.trigger_type === 'before_due') {
        stepDate = new Date(dueDate.getTime() - step.trigger_offset_days * 24 * 60 * 60 * 1000)
      } else if (step.trigger_type === 'on_due') {
        stepDate = dueDate
      } else {
        stepDate = new Date(dueDate.getTime() + step.trigger_offset_days * 24 * 60 * 60 * 1000)
      }

      if (stepDate > now && (!nextAction || stepDate < nextAction)) {
        nextAction = stepDate
      }
    }

    if (nextAction) {
      await supabaseAdmin
        .from('invoices')
        .update({ next_action_at: nextAction.toISOString() })
        .eq('id', invoice.id)
    }

    return
  }

  // Render template
  const variables: Record<string, string> = {
    customer_name: customer.name || customer.email.split('@')[0],
    invoice_number: invoice.stripe_invoice_id.slice(-8).toUpperCase(),
    amount: formatCurrency(invoice.amount_cents, invoice.currency),
    due_date: dueDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
    invoice_url: invoice.hosted_invoice_url || '#',
    company_name: companyName,
    footer: policy.email_footer || '',
  }

  let subject = applicableStep.subject_template
  let body = applicableStep.body_template

  for (const [key, value] of Object.entries(variables)) {
    subject = subject.replace(new RegExp(`{{${key}}}`, 'g'), value)
    body = body.replace(new RegExp(`{{${key}}}`, 'g'), value)
  }

  // Send email
  const result = await sendGmailEmail(accessToken, customer.email, subject, body)

  if (!result) {
    console.error(`Failed to send email to ${customer.email}`)
    return
  }

  // Log email event
  await supabaseAdmin.from('email_events').insert({
    workspace_id: workspaceId,
    invoice_id: invoice.id,
    customer_id: customer.id,
    direction: 'outbound',
    event_type: 'sent',
    gmail_message_id: result.messageId,
    gmail_thread_id: result.threadId,
    subject,
    snippet: body.slice(0, 200),
    sent_at: new Date().toISOString(),
    metadata: {
      step_id: applicableStep.id,
      step_order: applicableStep.step_order,
    },
  })

  // Update invoice
  await supabaseAdmin
    .from('invoices')
    .update({ last_step_sent_at: new Date().toISOString() })
    .eq('id', invoice.id)

  console.log(`Sent reminder to ${customer.email} for invoice ${invoice.stripe_invoice_id}`)
}
