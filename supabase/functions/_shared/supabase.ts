/**
 * Supabase Client for Edge Functions
 * 
 * Provides both:
 * - Admin client (service role) for backend operations
 * - User client (from JWT) for RLS-protected queries
 */

import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

const supabaseUrl = Deno.env.get('SUPABASE_URL')!
const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * Admin client - bypasses RLS
 * Use for: scheduled jobs, webhooks, system operations
 */
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

/**
 * Create a user-scoped client from the request's JWT
 * Use for: all user-facing API endpoints
 */
export function createUserClient(req: Request): SupabaseClient {
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    throw new Error('Missing Authorization header')
  }
  
  const token = authHeader.replace('Bearer ', '')
  
  return createClient(supabaseUrl, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    },
  })
}

/**
 * Get the authenticated user from a request
 */
export async function getUser(req: Request) {
  const supabase = createUserClient(req)
  const { data: { user }, error } = await supabase.auth.getUser()
  
  if (error || !user) {
    throw new Error('Unauthorized')
  }
  
  return { user, supabase }
}

/**
 * Get the user's workspace (most users have one workspace)
 */
export async function getUserWorkspace(userId: string) {
  const { data, error } = await supabaseAdmin
    .from('workspace_members')
    .select('workspace_id, role, workspaces(*)')
    .eq('user_id', userId)
    .single()
  
  if (error) {
    return null
  }
  
  return data
}

/**
 * Database types (generated from schema)
 * TODO: Generate with `supabase gen types typescript`
 */
export interface Database {
  public: {
    Tables: {
      users: {
        Row: {
          id: string
          email: string
          name: string
          avatar_url: string | null
          created_at: string
        }
      }
      workspaces: {
        Row: {
          id: string
          name: string
          timezone: string
          owner_id: string
          created_at: string
        }
      }
      workspace_members: {
        Row: {
          id: string
          workspace_id: string
          user_id: string
          role: string
          created_at: string
        }
      }
      customers: {
        Row: {
          id: string
          workspace_id: string
          stripe_customer_id: string
          name: string | null
          email: string | null
          created_at: string
        }
      }
      invoices: {
        Row: {
          id: string
          workspace_id: string
          stripe_invoice_id: string
          customer_id: string | null
          status: string
          autopilot_state: string
          amount_cents: number
          currency: string
          due_date: string | null
          hosted_invoice_url: string | null
          next_action_at: string | null
          created_at: string
          updated_at: string
        }
      }
      // Add more as needed
    }
  }
}
