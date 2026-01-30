/**
 * Invoices Edge Function
 * 
 * Handles invoice operations:
 * - GET: List invoices or get single invoice
 * - PATCH: Update invoice (pause/resume/stop autopilot)
 * - POST: Add note to invoice
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

    // GET - List invoices or get single invoice
    if (method === 'GET') {
      const invoiceId = url.searchParams.get('id')
      
      // Get single invoice with details
      if (invoiceId) {
        const { data: invoice, error } = await supabase
          .from('invoices')
          .select(`
            *,
            customers (
              id,
              name,
              email,
              stripe_customer_id
            )
          `)
          .eq('workspace_id', workspaceId)
          .eq('id', invoiceId)
          .single()

        if (error || !invoice) {
          return errorResponse('Invoice not found', 404)
        }

        // Get email events for this invoice
        const { data: events } = await supabase
          .from('email_events')
          .select('*')
          .eq('invoice_id', invoiceId)
          .order('created_at', { ascending: false })
          .limit(50)

        return jsonResponse({
          ...invoice,
          customer: invoice.customers,
          events: events || [],
        })
      }

      // List invoices with filters
      const status = url.searchParams.get('status')
      const autopilotState = url.searchParams.get('autopilot_state')
      const customerId = url.searchParams.get('customer_id')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
      const offset = parseInt(url.searchParams.get('offset') || '0')

      let query = supabase
        .from('invoices')
        .select(`
          *,
          customers (
            id,
            name,
            email
          )
        `, { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (status) {
        query = query.eq('status', status)
      }
      if (autopilotState) {
        query = query.eq('autopilot_state', autopilotState)
      }
      if (customerId) {
        query = query.eq('customer_id', customerId)
      }

      const { data: invoices, count, error } = await query

      if (error) {
        console.error('List invoices error:', error)
        return errorResponse('Failed to fetch invoices', 500)
      }

      // Transform to include customer at top level
      const transformedInvoices = (invoices || []).map(inv => ({
        ...inv,
        customer: inv.customers,
      }))

      return jsonResponse({
        invoices: transformedInvoices,
        total: count || 0,
        limit,
        offset,
      })
    }

    // PATCH - Update invoice
    if (method === 'PATCH') {
      const body = await req.json()
      const { invoice_id, autopilot_state, status } = body

      if (!invoice_id) {
        return errorResponse('invoice_id is required', 400)
      }

      // Verify invoice belongs to workspace
      const { data: existingInvoice, error: findError } = await supabase
        .from('invoices')
        .select('id, autopilot_state, status')
        .eq('workspace_id', workspaceId)
        .eq('id', invoice_id)
        .single()

      if (findError || !existingInvoice) {
        return errorResponse('Invoice not found', 404)
      }

      const updates: Record<string, unknown> = {}
      let eventType: string | null = null

      // Handle autopilot state changes
      if (autopilot_state) {
        const validStates = ['active', 'paused_manual', 'stopped_manual']
        if (!validStates.includes(autopilot_state)) {
          return errorResponse('Invalid autopilot_state', 400)
        }
        
        updates.autopilot_state = autopilot_state
        
        if (autopilot_state === 'paused_manual') {
          eventType = 'paused'
        } else if (autopilot_state === 'active') {
          eventType = 'resumed'
        } else if (autopilot_state === 'stopped_manual') {
          eventType = 'stopped'
        }
      }

      // Handle status changes
      if (status) {
        updates.status = status
        if (status === 'paid') {
          updates.autopilot_state = 'stopped_paid'
          updates.paid_at = new Date().toISOString()
          eventType = 'stopped'
        }
      }

      if (Object.keys(updates).length === 0) {
        return errorResponse('No updates provided', 400)
      }

      const { data: invoice, error } = await supabase
        .from('invoices')
        .update(updates)
        .eq('id', invoice_id)
        .select()
        .single()

      if (error) {
        console.error('Update invoice error:', error)
        return errorResponse('Failed to update invoice', 500)
      }

      // Create email event for the action
      if (eventType) {
        await supabase.from('email_events').insert({
          workspace_id: workspaceId,
          invoice_id,
          customer_id: invoice.customer_id,
          direction: 'outbound',
          event_type: eventType,
          metadata: { updated_by: user.id },
        })
      }

      return jsonResponse(invoice)
    }

    // POST - Add note to invoice
    if (method === 'POST') {
      const body = await req.json()
      const { invoice_id, note } = body

      if (!invoice_id || !note) {
        return errorResponse('invoice_id and note are required', 400)
      }

      // Verify invoice belongs to workspace
      const { data: invoice, error: findError } = await supabase
        .from('invoices')
        .select('id, customer_id')
        .eq('workspace_id', workspaceId)
        .eq('id', invoice_id)
        .single()

      if (findError || !invoice) {
        return errorResponse('Invoice not found', 404)
      }

      // Create manual note event
      const { error } = await supabase.from('email_events').insert({
        workspace_id: workspaceId,
        invoice_id,
        customer_id: invoice.customer_id,
        direction: 'outbound',
        event_type: 'manual_note',
        snippet: note,
        metadata: { added_by: user.id },
      })

      if (error) {
        console.error('Add note error:', error)
        return errorResponse('Failed to add note', 500)
      }

      return jsonResponse({ success: true })
    }

    return errorResponse('Method not allowed', 405)

  } catch (error) {
    console.error('Invoices function error:', error)
    
    if (error instanceof Error && error.message === 'Unauthorized') {
      return errorResponse('Unauthorized', 401)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
