/**
 * Customers Edge Function
 * 
 * Returns list of customers for the workspace.
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUser } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  if (req.method !== 'GET') {
    return errorResponse('Method not allowed', 405)
  }

  try {
    const { user, supabase } = await getUser(req)
    const url = new URL(req.url)

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
    const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
    const offset = parseInt(url.searchParams.get('offset') || '0')
    const search = url.searchParams.get('search')

    let query = supabase
      .from('customers')
      .select('*', { count: 'exact' })
      .eq('workspace_id', workspaceId)
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1)

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`)
    }

    const { data: customers, count, error } = await query

    if (error) {
      console.error('List customers error:', error)
      return errorResponse('Failed to fetch customers', 500)
    }

    return jsonResponse({
      customers: customers || [],
      total: count || 0,
      limit,
      offset,
    })

  } catch (error) {
    console.error('Customers function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
