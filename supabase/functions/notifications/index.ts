/**
 * Notifications Edge Function
 * 
 * Handles user notifications:
 * - GET: List notifications
 * - PATCH: Mark as read
 * - POST: Mark all as read
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUserWithWorkspace } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { user, supabase, workspaceId } = await getUserWithWorkspace(req)
    const url = new URL(req.url)
    const method = req.method

    // GET - List notifications
    if (method === 'GET') {
      const unreadOnly = url.searchParams.get('unread_only') === 'true'
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)

      let query = supabase
        .from('notifications')
        .select('*')
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(limit)

      if (unreadOnly) {
        query = query.eq('is_read', false)
      }

      const { data: notifications, error } = await query

      if (error) {
        console.error('List notifications error:', error)
        return errorResponse('Failed to fetch notifications', 500)
      }

      // Get unread count
      const { count } = await supabase
        .from('notifications')
        .select('*', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .eq('is_read', false)

      return jsonResponse({
        notifications: notifications || [],
        unread_count: count || 0,
      })
    }

    // PATCH - Mark single notification as read
    if (method === 'PATCH') {
      const body = await req.json()
      const { notification_id } = body

      if (!notification_id) {
        return errorResponse('notification_id is required', 400)
      }

      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('id', notification_id)
        .eq('user_id', user.id)

      if (error) {
        console.error('Mark read error:', error)
        return errorResponse('Failed to mark notification as read', 500)
      }

      return jsonResponse({ success: true })
    }

    // POST - Mark all as read
    if (method === 'POST') {
      const { error } = await supabase
        .from('notifications')
        .update({ is_read: true })
        .eq('workspace_id', workspaceId)
        .eq('user_id', user.id)
        .eq('is_read', false)

      if (error) {
        console.error('Mark all read error:', error)
        return errorResponse('Failed to mark notifications as read', 500)
      }

      return jsonResponse({ success: true })
    }

    return errorResponse('Method not allowed', 405)

  } catch (error) {
    console.error('Notifications function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
