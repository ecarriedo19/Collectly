/**
 * Gmail Integration Edge Function
 * 
 * Handles Gmail OAuth connection:
 * - GET: Get Gmail connection status
 * - POST: Connect Gmail with OAuth code
 * - DELETE: Disconnect Gmail
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUser, supabaseAdmin } from '../_shared/supabase.ts'
import { getGmailUserEmail } from '../_shared/gmail.ts'

const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token'

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

    // GET - Get Gmail connection status
    if (method === 'GET') {
      const { data: connection, error } = await supabase
        .from('gmail_connections')
        .select('google_user_email, connected_at, is_connected')
        .eq('workspace_id', workspaceId)
        .single()

      if (error || !connection) {
        return jsonResponse({ connected: false })
      }

      return jsonResponse({
        connected: connection.is_connected,
        email: connection.google_user_email,
        connected_at: connection.connected_at,
      })
    }

    // POST - Connect Gmail with OAuth code
    if (method === 'POST') {
      const body = await req.json()
      const { code, redirect_uri } = body

      if (!code || !redirect_uri) {
        return errorResponse('code and redirect_uri are required', 400)
      }

      const clientId = Deno.env.get('GOOGLE_CLIENT_ID')
      const clientSecret = Deno.env.get('GOOGLE_CLIENT_SECRET')

      if (!clientId || !clientSecret) {
        return errorResponse('Google OAuth not configured on server', 500)
      }

      // Exchange code for tokens
      const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri,
          grant_type: 'authorization_code',
        }),
      })

      if (!tokenResponse.ok) {
        const errorText = await tokenResponse.text()
        console.error('Token exchange failed:', errorText)
        return errorResponse('Failed to exchange code for tokens', 400)
      }

      const tokens = await tokenResponse.json()

      if (!tokens.access_token) {
        return errorResponse('No access token received', 400)
      }

      // Get user's email from Gmail
      const gmailEmail = await getGmailUserEmail(tokens.access_token)
      if (!gmailEmail) {
        return errorResponse('Failed to get Gmail user info', 400)
      }

      // Calculate token expiry
      const tokenExpiry = new Date(Date.now() + (tokens.expires_in || 3600) * 1000).toISOString()

      // Check if connection exists
      const { data: existing } = await supabase
        .from('gmail_connections')
        .select('id')
        .eq('workspace_id', workspaceId)
        .single()

      if (existing) {
        // Update existing
        await supabaseAdmin
          .from('gmail_connections')
          .update({
            google_user_email: gmailEmail,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || null,
            token_expiry: tokenExpiry,
            connected_at: new Date().toISOString(),
            is_connected: true,
          })
          .eq('workspace_id', workspaceId)
      } else {
        // Create new
        await supabaseAdmin
          .from('gmail_connections')
          .insert({
            workspace_id: workspaceId,
            google_user_email: gmailEmail,
            access_token: tokens.access_token,
            refresh_token: tokens.refresh_token || '',
            token_expiry: tokenExpiry,
          })
      }

      // Update onboarding
      await supabaseAdmin
        .from('workspace_onboarding')
        .update({ gmail_connected: true })
        .eq('workspace_id', workspaceId)

      return jsonResponse({
        connected: true,
        email: gmailEmail,
      })
    }

    // DELETE - Disconnect Gmail
    if (method === 'DELETE') {
      const { error } = await supabase
        .from('gmail_connections')
        .delete()
        .eq('workspace_id', workspaceId)

      if (error) {
        console.error('Delete Gmail connection error:', error)
        return errorResponse('Failed to disconnect Gmail', 500)
      }

      // Update onboarding
      await supabaseAdmin
        .from('workspace_onboarding')
        .update({ gmail_connected: false })
        .eq('workspace_id', workspaceId)

      return jsonResponse({ connected: false })
    }

    return errorResponse('Method not allowed', 405)

  } catch (error) {
    console.error('Gmail integration function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
