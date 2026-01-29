/**
 * CORS Headers for Supabase Edge Functions
 * 
 * Usage:
 * import { corsHeaders, handleCors } from '../_shared/cors.ts'
 * 
 * // In your function:
 * if (req.method === 'OPTIONS') {
 *   return new Response('ok', { headers: corsHeaders })
 * }
 */

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*', // TODO: Restrict in production
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
}

/**
 * Handle CORS preflight requests
 */
export function handleCors(req: Request): Response | null {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }
  return null
}

/**
 * Create a JSON response with CORS headers
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json',
    },
  })
}

/**
 * Create an error response with CORS headers
 */
export function errorResponse(message: string, status = 400): Response {
  return jsonResponse({ error: message }, status)
}
