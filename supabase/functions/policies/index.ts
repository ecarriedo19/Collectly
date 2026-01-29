/**
 * Policies Edge Function
 * 
 * Handles reminder policy CRUD:
 * - GET: Get default policy with steps
 * - PATCH: Update policy settings
 * - POST: Create new step
 * - DELETE: Delete step
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUser } from '../_shared/supabase.ts'

serve(async (req: Request) => {
  // Handle CORS preflight
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    const { user, supabase } = await getUser(req)
    const url = new URL(req.url)
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

    // GET - Get default policy with steps
    if (method === 'GET') {
      const policyId = url.searchParams.get('policy_id')

      let query = supabase
        .from('reminder_policies')
        .select('*')
        .eq('workspace_id', workspaceId)

      if (policyId) {
        query = query.eq('id', policyId)
      } else {
        query = query.eq('is_default', true)
      }

      const { data: policy, error } = await query.single()

      if (error || !policy) {
        return errorResponse('Policy not found', 404)
      }

      // Get steps
      const { data: steps } = await supabase
        .from('reminder_steps')
        .select('*')
        .eq('policy_id', policy.id)
        .order('step_order', { ascending: true })

      return jsonResponse({
        ...policy,
        steps: steps || [],
      })
    }

    // PATCH - Update policy or step
    if (method === 'PATCH') {
      const body = await req.json()
      const { policy_id, step_id, ...updates } = body

      if (!policy_id) {
        return errorResponse('policy_id is required', 400)
      }

      // Verify policy belongs to workspace
      const { data: policy, error: findError } = await supabase
        .from('reminder_policies')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('id', policy_id)
        .single()

      if (findError || !policy) {
        return errorResponse('Policy not found', 404)
      }

      // Update step
      if (step_id) {
        const stepUpdates: Record<string, unknown> = {}
        const validFields = ['step_order', 'trigger_type', 'trigger_offset_days', 'subject_template', 'body_template', 'is_enabled']
        
        for (const field of validFields) {
          if (field in updates) {
            stepUpdates[field] = updates[field]
          }
        }

        if (Object.keys(stepUpdates).length === 0) {
          return errorResponse('No valid updates provided', 400)
        }

        const { data: step, error } = await supabase
          .from('reminder_steps')
          .update(stepUpdates)
          .eq('id', step_id)
          .eq('policy_id', policy_id)
          .select()
          .single()

        if (error) {
          console.error('Update step error:', error)
          return errorResponse('Failed to update step', 500)
        }

        return jsonResponse(step)
      }

      // Update policy
      const policyUpdates: Record<string, unknown> = {}
      const validFields = ['name', 'is_enabled', 'max_emails_per_week_per_customer', 'quiet_hours_start', 'quiet_hours_end', 'from_name', 'reply_to_email', 'email_footer']
      
      for (const field of validFields) {
        if (field in updates) {
          policyUpdates[field] = updates[field]
        }
      }

      if (Object.keys(policyUpdates).length === 0) {
        return errorResponse('No valid updates provided', 400)
      }

      const { error } = await supabase
        .from('reminder_policies')
        .update(policyUpdates)
        .eq('id', policy_id)

      if (error) {
        console.error('Update policy error:', error)
        return errorResponse('Failed to update policy', 500)
      }

      // Return updated policy with steps
      const { data: updatedPolicy } = await supabase
        .from('reminder_policies')
        .select('*')
        .eq('id', policy_id)
        .single()

      const { data: steps } = await supabase
        .from('reminder_steps')
        .select('*')
        .eq('policy_id', policy_id)
        .order('step_order', { ascending: true })

      return jsonResponse({
        ...updatedPolicy,
        steps: steps || [],
      })
    }

    // POST - Create new step
    if (method === 'POST') {
      const body = await req.json()
      const { policy_id, step_order, trigger_type, trigger_offset_days, subject_template, body_template, is_enabled = true } = body

      if (!policy_id || step_order === undefined || !trigger_type || trigger_offset_days === undefined || !subject_template || !body_template) {
        return errorResponse('Missing required fields', 400)
      }

      // Verify policy belongs to workspace
      const { data: policy, error: findError } = await supabase
        .from('reminder_policies')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('id', policy_id)
        .single()

      if (findError || !policy) {
        return errorResponse('Policy not found', 404)
      }

      const { data: step, error } = await supabase
        .from('reminder_steps')
        .insert({
          policy_id,
          step_order,
          trigger_type,
          trigger_offset_days,
          subject_template,
          body_template,
          is_enabled,
        })
        .select()
        .single()

      if (error) {
        console.error('Create step error:', error)
        return errorResponse('Failed to create step', 500)
      }

      return jsonResponse(step, 201)
    }

    // DELETE - Delete step
    if (method === 'DELETE') {
      const stepId = url.searchParams.get('step_id')
      const policyId = url.searchParams.get('policy_id')

      if (!stepId || !policyId) {
        return errorResponse('step_id and policy_id are required', 400)
      }

      // Verify policy belongs to workspace
      const { data: policy, error: findError } = await supabase
        .from('reminder_policies')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('id', policyId)
        .single()

      if (findError || !policy) {
        return errorResponse('Policy not found', 404)
      }

      const { error } = await supabase
        .from('reminder_steps')
        .delete()
        .eq('id', stepId)
        .eq('policy_id', policyId)

      if (error) {
        console.error('Delete step error:', error)
        return errorResponse('Failed to delete step', 500)
      }

      return jsonResponse({ deleted: true })
    }

    return errorResponse('Method not allowed', 405)

  } catch (error) {
    console.error('Policies function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
