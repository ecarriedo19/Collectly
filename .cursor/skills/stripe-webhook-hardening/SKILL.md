---
name: stripe-webhook-hardening
description: Harden Stripe webhook handlers with signature verification, event deduplication, idempotent processing, and safe retries. Use when creating or reviewing Stripe webhook endpoints, investigating duplicate charges or emails, or when implementing payment event handling.
---

# Stripe Webhook Hardening

Prevent double charges, duplicate emails, and data corruption in Stripe webhook handlers.

## DANGER: Double-Processing Risks

Stripe retries webhooks up to 3 days. Without hardening, the same event can be processed multiple times causing:

| Risk | Consequence |
|------|-------------|
| **Double charge** | Customer charged twice for same invoice (refund + support ticket) |
| **Double email** | Multiple "Invoice Paid" emails to same customer (looks spammy/broken) |
| **Data corruption** | Status toggled back and forth, audit log polluted |
| **Race conditions** | Two workers process same event simultaneously |

**Rule:** Every webhook handler must be **idempotent**—processing the same event twice produces the same result.

---

## Required Safeguards

### 1. Signature Verification (CRITICAL)

Always verify using the **raw request body** before JSON parsing.

```typescript
// ✅ CORRECT - verify with raw body
const rawBody = await req.text()
const signature = req.headers.get('Stripe-Signature')

if (!signature) {
  return errorResponse('Missing signature', 401)
}

let event: Stripe.Event
try {
  const stripe = new Stripe(stripeSecretKey, { apiVersion: '2023-10-16' })
  event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret)
} catch (err) {
  console.warn('[stripe-webhook] Signature verification failed')
  return errorResponse('Invalid signature', 401)
}

// ❌ WRONG - parsing before verification allows spoofed events
const body = await req.json()  // DON'T DO THIS FIRST
```

**Why raw body?** Stripe signs the exact bytes sent. JSON.parse→stringify changes whitespace, breaking the signature.

### 2. Event Deduplication (CRITICAL)

Store processed event IDs to prevent replay attacks and retry double-processing.

**Schema (add via migration):**
```sql
CREATE TABLE IF NOT EXISTS processed_stripe_events (
  event_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  workspace_id UUID REFERENCES workspaces(id),
  processed_at TIMESTAMPTZ DEFAULT NOW(),
  payload JSONB
);

-- Auto-cleanup old events (keep 30 days for debugging)
CREATE INDEX idx_processed_stripe_events_processed_at 
  ON processed_stripe_events(processed_at);
```

**Handler pattern:**
```typescript
// Check if already processed BEFORE any mutations
const { data: existing } = await supabaseAdmin
  .from('processed_stripe_events')
  .select('event_id')
  .eq('event_id', event.id)
  .single()

if (existing) {
  console.log(`[stripe-webhook] Event ${event.id} already processed, skipping`)
  return jsonResponse({ received: true, duplicate: true })
}

// Record event BEFORE processing (claim it)
const { error: insertError } = await supabaseAdmin
  .from('processed_stripe_events')
  .insert({
    event_id: event.id,
    event_type: event.type,
    workspace_id: workspaceId,
    payload: event.data.object,
  })

if (insertError?.code === '23505') { // unique_violation = race condition
  console.log(`[stripe-webhook] Event ${event.id} claimed by another worker`)
  return jsonResponse({ received: true, duplicate: true })
}
```

### 3. Idempotent Handlers

Design handlers so re-running them has no additional effect.

```typescript
// ✅ IDEMPOTENT - check current state before mutating
if (event.type === 'invoice.paid') {
  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('id, status, workspace_id')
    .eq('stripe_invoice_id', stripeInvoice.id)
    .single()

  if (!invoice) {
    console.warn(`[stripe-webhook] Invoice not found: ${stripeInvoice.id}`)
    return jsonResponse({ received: true, skipped: 'invoice_not_found' })
  }

  // Already paid? Skip all mutations
  if (invoice.status === 'paid') {
    console.log(`[stripe-webhook] Invoice ${invoice.id} already paid, skipping`)
    return jsonResponse({ received: true, skipped: 'already_paid' })
  }

  // Now safe to update
  await supabaseAdmin
    .from('invoices')
    .update({
      status: 'paid',
      autopilot_state: 'stopped_paid',
      paid_at: new Date().toISOString(),
    })
    .eq('id', invoice.id)
    .eq('status', 'open') // Extra guard: only update if still open
}

// ❌ NON-IDEMPOTENT - blindly updates without checking
await supabaseAdmin
  .from('invoices')
  .update({ status: 'paid' })
  .eq('stripe_invoice_id', eventData.id)  // Will toggle back if called twice
```

### 4. Safe Notifications (Prevent Double Emails)

Notifications are the most visible double-processing issue.

```typescript
// ✅ SAFE - use upsert with conflict handling
await supabaseAdmin
  .from('notifications')
  .upsert({
    // Unique constraint on (workspace_id, type, invoice_id)
    workspace_id: invoice.workspace_id,
    type: 'invoice_paid',
    invoice_id: invoice.id,
    user_id: workspace.owner_id,
    title: 'Invoice Paid',
    message: `Invoice ${invoice.id.slice(-8)} paid`,
  }, {
    onConflict: 'workspace_id,type,invoice_id',
    ignoreDuplicates: true,
  })

// ❌ DANGEROUS - insert creates duplicates
await supabaseAdmin.from('notifications').insert({
  workspace_id: invoice.workspace_id,
  type: 'invoice_paid',
  // ... every retry creates another notification
})
```

**Unique constraint (add via migration):**
```sql
ALTER TABLE notifications 
ADD CONSTRAINT notifications_unique_event 
UNIQUE (workspace_id, type, invoice_id);
```

### 5. Safe Retries (Return 200)

Stripe retries on 4xx/5xx. Return 200 even for "soft" failures to prevent retry storms.

```typescript
// Return 200 for expected failures (missing data, already processed)
if (!invoice) {
  console.warn(`[stripe-webhook] Invoice not found: ${stripeInvoice.id}`)
  return jsonResponse({ received: true, skipped: 'not_found' }, 200)  // 200, not 404
}

// Return 5xx ONLY for unexpected errors that should be retried
try {
  await processInvoice(event)
  return jsonResponse({ received: true })
} catch (error) {
  console.error('[stripe-webhook] Processing failed:', { eventId: event.id, error })
  
  // Transient DB error? Return 500 to trigger retry
  if (isTransientError(error)) {
    return errorResponse('Temporary failure', 500)
  }
  
  // Permanent error? Return 200 to stop retries
  return jsonResponse({ received: true, error: 'permanent_failure' }, 200)
}
```

---

## Complete Handler Template

```typescript
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { corsHeaders, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { supabaseAdmin } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed', 405)
  }

  // 1. Verify signature with RAW body
  const rawBody = await req.text()
  const signature = req.headers.get('Stripe-Signature')

  if (!signature) {
    console.warn('[stripe-webhook] Missing signature header')
    return errorResponse('Missing signature', 401)
  }

  let event: Stripe.Event
  let workspaceId: string | null = null

  // Find matching workspace by webhook secret
  const { data: connections } = await supabaseAdmin
    .from('stripe_connections')
    .select('workspace_id, webhook_secret')
    .not('webhook_secret', 'is', null)

  for (const conn of connections || []) {
    try {
      const stripe = new Stripe('', { apiVersion: '2023-10-16' })
      event = stripe.webhooks.constructEvent(rawBody, signature, conn.webhook_secret!)
      workspaceId = conn.workspace_id
      break
    } catch {
      continue
    }
  }

  if (!event!) {
    console.warn('[stripe-webhook] No matching webhook secret found')
    return errorResponse('Invalid signature', 401)
  }

  // 2. Deduplicate event
  const { data: existing } = await supabaseAdmin
    .from('processed_stripe_events')
    .select('event_id')
    .eq('event_id', event.id)
    .single()

  if (existing) {
    console.log(`[stripe-webhook] Duplicate event ${event.id}`)
    return jsonResponse({ received: true, duplicate: true })
  }

  // Claim the event (insert before processing)
  const { error: claimError } = await supabaseAdmin
    .from('processed_stripe_events')
    .insert({
      event_id: event.id,
      event_type: event.type,
      workspace_id: workspaceId,
    })

  if (claimError?.code === '23505') {
    console.log(`[stripe-webhook] Event ${event.id} claimed by another worker`)
    return jsonResponse({ received: true, duplicate: true })
  }

  console.log(`[stripe-webhook] Processing ${event.type}`, { eventId: event.id, workspaceId })

  try {
    // 3. Process with idempotent handlers
    const eventData = event.data.object as Stripe.Invoice

    if (event.type === 'invoice.paid') {
      await handleInvoicePaid(eventData, workspaceId)
    } else if (event.type === 'invoice.payment_failed') {
      await handlePaymentFailed(eventData)
    } else if (event.type === 'invoice.voided') {
      await handleInvoiceVoided(eventData)
    }

    return jsonResponse({ received: true })

  } catch (error) {
    console.error('[stripe-webhook] Handler error:', { eventId: event.id, error })
    // Return 200 to prevent retry storm for non-transient errors
    return jsonResponse({ received: true, error: 'handler_failed' })
  }
})

// Idempotent handler: checks state before mutating
async function handleInvoicePaid(stripeInvoice: Stripe.Invoice, workspaceId: string | null) {
  const { data: invoice } = await supabaseAdmin
    .from('invoices')
    .select('id, status, workspace_id')
    .eq('stripe_invoice_id', stripeInvoice.id)
    .single()

  if (!invoice) {
    console.warn(`[stripe-webhook] Invoice not found: ${stripeInvoice.id}`)
    return
  }

  // Idempotency check: skip if already paid
  if (invoice.status === 'paid') {
    console.log(`[stripe-webhook] Invoice ${invoice.id} already paid`)
    return
  }

  // Update with optimistic lock (only if still open)
  const { error: updateError } = await supabaseAdmin
    .from('invoices')
    .update({
      status: 'paid',
      autopilot_state: 'stopped_paid',
      paid_at: new Date().toISOString(),
    })
    .eq('id', invoice.id)
    .eq('status', 'open')

  if (updateError) {
    console.error('[stripe-webhook] Invoice update failed:', updateError)
    return
  }

  // Safe notification with upsert
  const { data: workspace } = await supabaseAdmin
    .from('workspaces')
    .select('owner_id')
    .eq('id', invoice.workspace_id)
    .single()

  if (workspace) {
    await supabaseAdmin.from('notifications').upsert({
      workspace_id: invoice.workspace_id,
      user_id: workspace.owner_id,
      type: 'invoice_paid',
      invoice_id: invoice.id,
      title: 'Invoice Paid',
      message: `Invoice ${stripeInvoice.id.slice(-8).toUpperCase()} has been paid`,
    }, {
      onConflict: 'workspace_id,type,invoice_id',
      ignoreDuplicates: true,
    })
  }

  console.log(`[stripe-webhook] Invoice ${invoice.id} marked as paid`)
}

async function handlePaymentFailed(stripeInvoice: Stripe.Invoice) {
  // Only transition from open → past_due
  await supabaseAdmin
    .from('invoices')
    .update({ status: 'past_due' })
    .eq('stripe_invoice_id', stripeInvoice.id)
    .eq('status', 'open')
}

async function handleInvoiceVoided(stripeInvoice: Stripe.Invoice) {
  // Only void if not already terminal
  await supabaseAdmin
    .from('invoices')
    .update({ status: 'void', autopilot_state: 'stopped_manual' })
    .eq('stripe_invoice_id', stripeInvoice.id)
    .neq('status', 'void')
}
```

---

## Migration Checklist

When hardening an existing webhook:

- [ ] Add `processed_stripe_events` table
- [ ] Add unique constraint on notifications table
- [ ] Replace `req.json()` with `req.text()` + signature verification
- [ ] Add event deduplication check before processing
- [ ] Add state checks in each handler (already paid? skip)
- [ ] Replace `.insert()` with `.upsert()` for notifications
- [ ] Add `.eq('status', 'expected_status')` guards on updates
- [ ] Ensure 200 response for handled failures

## Testing Checklist

- [ ] Replay same event ID → logged as duplicate, no mutations
- [ ] Send without signature → 401 rejected
- [ ] Send with wrong signature → 401 rejected
- [ ] Send invoice.paid twice → invoice updated once, one notification
- [ ] Kill handler mid-process, retry → completes without duplicates
