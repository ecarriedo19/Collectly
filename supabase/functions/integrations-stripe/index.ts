/**
 * Stripe Integration Edge Function
 * 
 * Handles Stripe connection management:
 * - GET: Get Stripe connection status
 * - POST: Connect Stripe with API key
 * - DELETE: Disconnect Stripe
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import Stripe from 'https://esm.sh/stripe@14?target=deno'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUser, supabaseAdmin } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { user, supabase } = await getUser(req)
    const method = req.method

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

    // GET - Get Stripe connection status
    if (method === 'GET') {
      const { data: connection, error } = await supabase
        .from('stripe_connections')
        .select('stripe_account_id, connected_at, last_sync_at, is_connected')
        .eq('workspace_id', workspaceId)
        .single()

      if (error || !connection) {
        return jsonResponse({ connected: false })
      }

      return jsonResponse({
        connected: connection.is_connected,
        account_id: connection.stripe_account_id,
        connected_at: connection.connected_at,
        last_sync_at: connection.last_sync_at,
      })
    }

    // POST - Connect Stripe
    if (method === 'POST') {
      const body = await req.json()
      const { secret_key, webhook_secret } = body

      if (!secret_key || typeof secret_key !== 'string') {
        return errorResponse('secret_key is required', 400)
      }

      if (!secret_key.startsWith('sk_')) {
        return errorResponse('Invalid Stripe API key format', 400)
      }

      // Verify the key works by fetching account info
      let accountId: string
      try {
        const stripe = new Stripe(secret_key, {
          apiVersion: '2023-10-16',
          httpClient: Stripe.createFetchHttpClient(),
        })
        
        const account = await stripe.accounts.retrieve()
        accountId = account.id
      } catch (stripeError) {
        console.error('Stripe verification error:', stripeError)
        return errorResponse('Invalid Stripe API key', 400)
      }

      // Check if connection already exists
      const { data: existing } = await supabase
        .from('stripe_connections')
        .select('id')
        .eq('workspace_id', workspaceId)
        .single()

      if (existing) {
        // Update existing connection
        const { error } = await supabaseAdmin
          .from('stripe_connections')
          .update({
            stripe_account_id: accountId,
            secret_key,
            webhook_secret: webhook_secret || null,
            connected_at: new Date().toISOString(),
            is_connected: true,
          })
          .eq('workspace_id', workspaceId)

        if (error) {
          console.error('Update Stripe connection error:', error)
          return errorResponse('Failed to update Stripe connection', 500)
        }
      } else {
        // Create new connection
        const { error } = await supabaseAdmin
          .from('stripe_connections')
          .insert({
            workspace_id: workspaceId,
            stripe_account_id: accountId,
            secret_key,
            webhook_secret: webhook_secret || null,
          })

        if (error) {
          console.error('Create Stripe connection error:', error)
          return errorResponse('Failed to create Stripe connection', 500)
        }
      }

      // Update onboarding status
      await supabaseAdmin
        .from('workspace_onboarding')
        .update({ stripe_connected: true })
        .eq('workspace_id', workspaceId)

      return jsonResponse({
        connected: true,
        account_id: accountId,
      })
    }

    // DELETE - Disconnect Stripe
    if (method === 'DELETE') {
      const { error } = await supabase
        .from('stripe_connections')
        .delete()
        .eq('workspace_id', workspaceId)

      if (error) {
        console.error('Delete Stripe connection error:', error)
        return errorResponse('Failed to disconnect Stripe', 500)
      }

      // Update onboarding status
      await supabaseAdmin
        .from('workspace_onboarding')
        .update({ stripe_connected: false })
        .eq('workspace_id', workspaceId)

      return jsonResponse({ connected: false })
    }

    return errorResponse('Method not allowed', 405)

  } catch (error) {
    console.error('Stripe integration function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
