/**
 * Stripe Client for Edge Functions
 * 
 * Creates Stripe clients using workspace-specific API keys
 * retrieved from Supabase Vault.
 */

import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { supabaseAdmin } from './supabase.ts'

/**
 * Get Stripe client for a workspace
 * Retrieves the API key from the stripe_connections table
 */
export async function getStripeClient(workspaceId: string): Promise<Stripe | null> {
  const { data: connection, error } = await supabaseAdmin
    .from('stripe_connections')
    .select('secret_key')
    .eq('workspace_id', workspaceId)
    .single()
  
  if (error || !connection?.secret_key) {
    return null
  }
  
  // In production, secret_key should reference a Vault secret
  // For now, we store it directly (TODO: migrate to Vault)
  return new Stripe(connection.secret_key, {
    apiVersion: '2023-10-16',
    httpClient: Stripe.createFetchHttpClient(),
  })
}

/**
 * Verify Stripe webhook signature
 */
export function verifyWebhookSignature(
  payload: string,
  signature: string,
  webhookSecret: string
): Stripe.Event | null {
  try {
    const stripe = new Stripe('', { apiVersion: '2023-10-16' })
    return stripe.webhooks.constructEvent(payload, signature, webhookSecret)
  } catch {
    return null
  }
}

/**
 * Map Stripe invoice status to our internal status
 */
export function mapStripeStatus(stripeStatus: string, dueDate: string | null): string {
  if (stripeStatus === 'paid') return 'paid'
  if (stripeStatus === 'void') return 'void'
  if (stripeStatus === 'uncollectible') return 'uncollectible'
  
  // Check if past due
  if (dueDate && new Date(dueDate) < new Date()) {
    return 'past_due'
  }
  
  return 'open'
}

/**
 * Format currency amount for display
 */
export function formatCurrency(cents: number, currency = 'usd'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(cents / 100)
}
