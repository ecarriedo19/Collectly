/**
 * Workspaces Edge Function
 * 
 * Handles workspace CRUD operations:
 * - GET: Get current user's workspace
 * - POST: Create new workspace
 * - PATCH: Update workspace settings
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUser, getUserWithWorkspace, supabaseAdmin } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { user, supabase } = await getUser(req)
    const method = req.method

    // GET - Get user's workspace
    if (method === 'GET') {
      // Get workspace membership
      const { data: membership, error: memberError } = await supabase
        .from('workspace_members')
        .select(`
          role,
          workspaces (
            id,
            name,
            timezone,
            owner_id,
            created_at
          )
        `)
        .eq('user_id', user.id)
        .single()

      if (memberError || !membership) {
        return jsonResponse({ workspace: null })
      }

      return jsonResponse({ 
        workspace: membership.workspaces,
        role: membership.role
      })
    }

    // POST - Create workspace
    if (method === 'POST') {
      const body = await req.json()
      const { name, timezone = 'America/New_York' } = body

      if (!name || typeof name !== 'string') {
        return errorResponse('Workspace name is required', 400)
      }

      // Check if user already has a workspace
      const { data: existing } = await supabase
        .from('workspace_members')
        .select('workspace_id')
        .eq('user_id', user.id)
        .single()

      if (existing) {
        return errorResponse('User already has a workspace', 400)
      }

      // Create workspace (triggers will handle member + policy creation)
      const { data: workspace, error } = await supabase
        .from('workspaces')
        .insert({
          name: name.trim(),
          timezone,
          owner_id: user.id,
        })
        .select()
        .single()

      if (error) {
        console.error('Create workspace error:', error)
        return errorResponse('Failed to create workspace', 500)
      }

      return jsonResponse({ workspace }, 201)
    }

    // PATCH - Update workspace
    if (method === 'PATCH') {
      const body = await req.json()
      const { name, timezone } = body

      const { user, supabase, workspaceId } = await getUserWithWorkspace(req)

      // Get role to check permissions
      const { data: membership, error: memberError } = await supabase
        .from('workspace_members')
        .select('role')
        .eq('user_id', user.id)
        .eq('workspace_id', workspaceId)
        .single()

      if (memberError || !membership) {
        return errorResponse('Workspace not found', 404)
      }

      // Only owners can update workspace settings
      if (membership.role !== 'owner') {
        return errorResponse('Only workspace owner can update settings', 403)
      }

      const updates: Record<string, unknown> = {}
      if (name) updates.name = name.trim()
      if (timezone) updates.timezone = timezone

      if (Object.keys(updates).length === 0) {
        return errorResponse('No updates provided', 400)
      }

      const { data: workspace, error } = await supabase
        .from('workspaces')
        .update(updates)
        .eq('id', workspaceId)
        .select()
        .single()

      if (error) {
        console.error('Update workspace error:', error)
        return errorResponse('Failed to update workspace', 500)
      }

      return jsonResponse({ workspace })
    }

    return errorResponse('Method not allowed', 405)

  } catch (error) {
    console.error('Workspaces function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
