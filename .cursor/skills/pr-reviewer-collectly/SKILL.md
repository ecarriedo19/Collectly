---
name: pr-reviewer-collectly
description: Review pull requests for Collectly-specific concerns including workspace isolation, RLS correctness, secret handling, retry safety, webhook idempotency, UI states, and response shapes. Use when reviewing PRs, code changes, or when the user asks to review code in this project.
---

# PR Reviewer (Collectly)

Review code changes against Collectly's multi-tenant SaaS requirements. Output a punchy fix list.

## Review Checklist

### 1. Workspace Isolation
- [ ] Every DB query scoped to `workspace_id`
- [ ] No cross-workspace data leaks via joins or subqueries
- [ ] User derived from `auth.uid()`, not request body
- [ ] Workspace membership verified before access

**Red flags:**
- Raw `SELECT * FROM table` without workspace filter
- `workspace_id` taken from client payload
- Missing `workspace_id` in INSERT statements

### 2. RLS Correctness
- [ ] New tables have RLS enabled (`ALTER TABLE ... ENABLE ROW LEVEL SECURITY`)
- [ ] Policies use `workspace_id IN (SELECT workspace_id FROM workspace_members WHERE user_id = auth.uid())`
- [ ] No `SECURITY DEFINER` functions bypassing RLS without explicit need
- [ ] Indexes exist for `workspace_id` + common filters

**Red flags:**
- RLS disabled or missing on tenant-scoped tables
- Policies that trust client-provided IDs
- `auth.uid()` not used in policy expressions

### 3. Secret Handling
- [ ] API keys/tokens stored in Supabase Vault, not columns
- [ ] Vault references use `secret_key_id`, `access_token_id` patterns
- [ ] No secrets in logs, error messages, or frontend responses
- [ ] Service role key only in Edge Functions, never frontend

**Red flags:**
- `console.log(token)` or `console.log(key)`
- Secrets in `.env` committed or exposed
- `SUPABASE_SERVICE_ROLE_KEY` in frontend code

### 4. Retry Safety
- [ ] Scheduler/jobs use locking to prevent double execution
- [ ] Operations are idempotent or use unique constraints
- [ ] External API calls handle rate limits with backoff
- [ ] Failed operations logged with context for debugging

**Red flags:**
- No `FOR UPDATE SKIP LOCKED` on job claims
- Missing deduplication for email sends
- Infinite retry loops without backoff

### 5. Webhook Idempotency
- [ ] Stripe signature verified using raw body
- [ ] `processed_event_ids` table prevents replay
- [ ] Event processing is atomic (transaction or all-or-nothing)
- [ ] Provider errors not leaked to webhook response

**Red flags:**
- Missing `stripe.webhooks.constructEvent()` verification
- No check for previously processed event IDs
- Partial updates without rollback

### 6. UI States
- [ ] Loading state while fetching
- [ ] Error state with user-friendly message
- [ ] Empty state when no data
- [ ] Disabled states during mutations

**Red flags:**
- Raw `data.map()` without null check
- Missing `isLoading` / `isError` handling
- No feedback on button click (spinner, disable)

### 7. Response Shapes
- [ ] Consistent envelope: `{ ok: boolean, data?: T, error?: string }`
- [ ] HTTP status codes match semantics (401, 403, 404, 500)
- [ ] No raw exception messages to client
- [ ] CORS headers present on all responses

**Red flags:**
- Mixed response formats (`{ success }` vs `{ ok }`)
- Stack traces in production errors
- Missing `corsHeaders` on error paths

---

## Output Format

After reviewing, output a fix list:

```markdown
## Required Fixes

🔴 **CRITICAL** (block merge)
- [file:line] Issue description → fix

🟡 **IMPORTANT** (fix before/after merge)
- [file:line] Issue description → fix

🟢 **NITPICK** (optional)
- [file:line] Issue description → fix

---
**Verdict:** APPROVE / REQUEST CHANGES / NEEDS DISCUSSION
```

### Example Output

```markdown
## Required Fixes

🔴 **CRITICAL**
- [invoices/index.ts:42] Missing workspace_id filter → add `.eq('workspace_id', workspaceId)`
- [stripe-webhook/index.ts:15] No signature verification → use `stripe.webhooks.constructEvent(rawBody, sig, secret)`

🟡 **IMPORTANT**
- [Dashboard.jsx:28] No loading state → add `if (isLoading) return <Skeleton />`
- [policies/index.ts:67] Inconsistent response → change `{ success: true }` to `{ ok: true, data }`

🟢 **NITPICK**
- [customers/index.ts:12] Could use shared CORS helper

---
**Verdict:** REQUEST CHANGES (2 critical issues)
```

---

## Quick Reference

| Check | Key Pattern |
|-------|-------------|
| Workspace isolation | `.eq('workspace_id', wsId)` on every query |
| RLS | `auth.uid()` in policy, RLS enabled |
| Secrets | `vault.secret_id` refs, no plaintext |
| Retry | `FOR UPDATE SKIP LOCKED`, dedup table |
| Webhooks | `constructEvent()`, `processed_event_ids` |
| UI states | Loading/Error/Empty/Disabled |
| Response | `{ ok, data?, error? }` envelope |
