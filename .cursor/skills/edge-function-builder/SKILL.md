---
name: edge-function-builder
description: Generate new Supabase Edge Functions following Collectly conventions including input validation, auth + workspace resolution, typed responses, safe logging, and minimal DB queries. Use when creating a new Edge Function, adding a new API endpoint, or when the user asks to scaffold a Supabase function.
---

# Edge Function Builder

Generate Supabase Edge Functions using existing Collectly patterns.

## Quick Start

When creating a new Edge Function:

1. Create folder: `supabase/functions/<function-name>/index.ts`
2. Use the template below
3. Customize handlers for your use case
4. Test locally with curl

## Template

```typescript
/**
 * <FunctionName> Edge Function
 * 
 * <Brief description of what this function does>
 */

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUserWithWorkspace, supabaseAdmin } from '../_shared/supabase.ts'

// --- Types ---

interface CreatePayload {
  // Define expected fields
  name: string
  // Optional fields
  description?: string
}

// --- Validation ---

function validateCreate(body: unknown): { valid: true; data: CreatePayload } | { valid: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { valid: false, error: 'Request body required' }
  }
  
  const payload = body as Record<string, unknown>
  
  if (!payload.name || typeof payload.name !== 'string') {
    return { valid: false, error: 'name is required and must be a string' }
  }
  
  return {
    valid: true,
    data: {
      name: payload.name.trim(),
      description: typeof payload.description === 'string' ? payload.description.trim() : undefined,
    },
  }
}

// --- Handler ---

serve(async (req: Request) => {
  // 1. CORS
  const corsResponse = handleCors(req)
  if (corsResponse) return corsResponse

  try {
    // 2. Auth + workspace (do this BEFORE parsing body)
    const { user, supabase, workspaceId } = await getUserWithWorkspace(req)
    
    const url = new URL(req.url)
    const method = req.method

    // --- GET ---
    if (method === 'GET') {
      const id = url.searchParams.get('id')
      const limit = Math.min(parseInt(url.searchParams.get('limit') || '50'), 100)
      const offset = parseInt(url.searchParams.get('offset') || '0')

      // Single item
      if (id) {
        const { data, error } = await supabase
          .from('your_table')
          .select('*')
          .eq('workspace_id', workspaceId)
          .eq('id', id)
          .single()

        if (error || !data) {
          return errorResponse('Not found', 404)
        }
        return jsonResponse(data)
      }

      // List
      const { data, count, error } = await supabase
        .from('your_table')
        .select('*', { count: 'exact' })
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .range(offset, offset + limit - 1)

      if (error) {
        console.error('[your_function] List error:', { workspaceId, error: error.message })
        return errorResponse('Failed to fetch data', 500)
      }

      return jsonResponse({ items: data || [], total: count || 0, limit, offset })
    }

    // --- POST ---
    if (method === 'POST') {
      const body = await req.json()
      const validation = validateCreate(body)
      
      if (!validation.valid) {
        return errorResponse(validation.error, 400)
      }

      const { data, error } = await supabase
        .from('your_table')
        .insert({
          workspace_id: workspaceId,
          ...validation.data,
        })
        .select()
        .single()

      if (error) {
        console.error('[your_function] Create error:', { workspaceId, error: error.message })
        return errorResponse('Failed to create', 500)
      }

      console.log('[your_function] Created:', { workspaceId, id: data.id })
      return jsonResponse(data, 201)
    }

    // --- PATCH ---
    if (method === 'PATCH') {
      const body = await req.json()
      const { id, ...updates } = body as { id?: string; [key: string]: unknown }

      if (!id) {
        return errorResponse('id is required', 400)
      }

      // Verify ownership
      const { data: existing, error: findError } = await supabase
        .from('your_table')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .single()

      if (findError || !existing) {
        return errorResponse('Not found', 404)
      }

      // Whitelist allowed updates
      const allowedUpdates: Record<string, unknown> = {}
      if (typeof updates.name === 'string') allowedUpdates.name = updates.name.trim()
      if (typeof updates.description === 'string') allowedUpdates.description = updates.description.trim()

      if (Object.keys(allowedUpdates).length === 0) {
        return errorResponse('No valid updates provided', 400)
      }

      const { data, error } = await supabase
        .from('your_table')
        .update(allowedUpdates)
        .eq('id', id)
        .select()
        .single()

      if (error) {
        console.error('[your_function] Update error:', { workspaceId, id, error: error.message })
        return errorResponse('Failed to update', 500)
      }

      return jsonResponse(data)
    }

    // --- DELETE ---
    if (method === 'DELETE') {
      const id = url.searchParams.get('id')
      
      if (!id) {
        return errorResponse('id is required', 400)
      }

      // Verify ownership before delete
      const { data: existing, error: findError } = await supabase
        .from('your_table')
        .select('id')
        .eq('workspace_id', workspaceId)
        .eq('id', id)
        .single()

      if (findError || !existing) {
        return errorResponse('Not found', 404)
      }

      const { error } = await supabase
        .from('your_table')
        .delete()
        .eq('id', id)

      if (error) {
        console.error('[your_function] Delete error:', { workspaceId, id, error: error.message })
        return errorResponse('Failed to delete', 500)
      }

      return jsonResponse({ ok: true })
    }

    return errorResponse('Method not allowed', 405)

  } catch (error) {
    console.error('[your_function] Unhandled error:', error)
    
    if (error instanceof Error) {
      if (error.message === 'Unauthorized') return errorResponse('Unauthorized', 401)
      if (error.message === 'Workspace not found') return errorResponse('Workspace not found', 403)
    }
    
    return errorResponse('Internal server error', 500)
  }
})
```

## Key Conventions

### 1. Imports
Always import from shared helpers:
```typescript
import { corsHeaders, handleCors, jsonResponse, errorResponse } from '../_shared/cors.ts'
import { getUserWithWorkspace, supabaseAdmin } from '../_shared/supabase.ts'
```

### 2. Auth First
Authenticate **before** reading request body:
```typescript
const { user, supabase, workspaceId } = await getUserWithWorkspace(req)
```

### 3. Input Validation
- Validate at boundary with typed functions
- Reject unknown/unexpected fields
- Trim strings, enforce limits

### 4. Workspace Scoping
Every query **must** include `.eq('workspace_id', workspaceId)`:
```typescript
// CORRECT
.from('invoices').select('*').eq('workspace_id', workspaceId)

// WRONG - never do this
.from('invoices').select('*').eq('id', invoiceId)  // Missing workspace check!
```

### 5. Safe Logging
Log context without PII:
```typescript
// GOOD
console.error('[invoices] Update failed:', { workspaceId, invoiceId, error: error.message })

// BAD - leaks email
console.error('Failed for user:', user.email, body)
```

### 6. Response Shape
Use consistent `{ data }` or `{ error }` envelopes:
```typescript
// Success
jsonResponse({ invoices: [...], total: 100 })

// Error
errorResponse('Not found', 404)  // Returns { error: "Not found" }
```

## When to Use Admin Client

Use `supabaseAdmin` (bypasses RLS) only for:
- Scheduled jobs / cron
- Webhooks
- Cross-workspace operations

User endpoints should use the user-scoped `supabase` from `getUserWithWorkspace`.

## Local Testing

Start local Supabase and serve functions:
```bash
supabase start
supabase functions serve
```

### Test Curl Examples

**GET list:**
```bash
curl -X GET "http://localhost:54321/functions/v1/your-function" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

**GET single:**
```bash
curl -X GET "http://localhost:54321/functions/v1/your-function?id=UUID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

**POST create:**
```bash
curl -X POST "http://localhost:54321/functions/v1/your-function" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Test Item", "description": "Optional description"}'
```

**PATCH update:**
```bash
curl -X PATCH "http://localhost:54321/functions/v1/your-function" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "UUID", "name": "Updated Name"}'
```

**DELETE:**
```bash
curl -X DELETE "http://localhost:54321/functions/v1/your-function?id=UUID" \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

To get a test JWT, sign in via the frontend or use:
```bash
supabase auth sign-in --email test@example.com --password testpass
```

## Checklist

Before merging a new Edge Function:

- [ ] CORS handled via `handleCors(req)`
- [ ] Auth runs before body parsing
- [ ] Every DB query includes `.eq('workspace_id', workspaceId)`
- [ ] Input validated at boundary (no trust of client data)
- [ ] No secrets/PII in logs
- [ ] Errors return consistent `{ error: string }` shape
- [ ] 405 returned for unsupported methods
- [ ] Tested locally with curl
