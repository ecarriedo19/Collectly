---
name: rls-migration-author
description: Generate SQL migrations with indexes and RLS policies for Collectly schema changes. Use when creating new tables, adding columns, or modifying database schema. Ensures multi-tenant isolation and prevents cross-workspace data leaks.
---

# RLS + Migration Author

Generate production-ready Supabase migrations with proper indexes and Row Level Security for Collectly's multi-tenant architecture.

## Quick Start

When given a table change request:

1. Determine change type (new table, add column, modify constraint)
2. Generate migration SQL with required components
3. Run the cross-tenant checklist
4. Output the complete migration file

## Migration File Naming

```
supabase/migrations/XXX_description.sql
```

- Use next sequential number (check existing migrations)
- Use lowercase snake_case description
- Example: `005_add_payment_attempts.sql`

## Required Components by Change Type

### New Tenant-Scoped Table

Every tenant-scoped table MUST include:

```sql
-- 1. Table with workspace_id
CREATE TABLE public.table_name (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  -- ... other columns ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Required indexes
CREATE INDEX idx_table_name_workspace_id ON public.table_name(workspace_id);
-- Add composite indexes for common query patterns:
-- CREATE INDEX idx_table_name_workspace_status ON public.table_name(workspace_id, status);

-- 3. Enable RLS
ALTER TABLE public.table_name ENABLE ROW LEVEL SECURITY;

-- 4. RLS Policy (use existing helper function)
CREATE POLICY "Workspace scoped access" ON public.table_name
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- 5. Updated_at trigger (if table has updated_at)
CREATE TRIGGER set_updated_at BEFORE UPDATE ON public.table_name
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at();
```

### Child Table (FK to tenant-scoped parent)

For tables that reference a tenant-scoped parent (e.g., `reminder_steps` → `reminder_policies`):

```sql
CREATE TABLE public.child_table (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id UUID NOT NULL REFERENCES public.parent_table(id) ON DELETE CASCADE,
  -- ... columns (NO workspace_id needed) ...
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_child_table_parent_id ON public.child_table(parent_id);

ALTER TABLE public.child_table ENABLE ROW LEVEL SECURITY;

-- RLS via parent lookup
CREATE POLICY "Workspace scoped access" ON public.child_table
  FOR ALL USING (
    parent_id IN (
      SELECT id FROM public.parent_table 
      WHERE workspace_id IN (SELECT public.user_workspace_ids())
    )
  );
```

### Adding Columns

```sql
-- Add column
ALTER TABLE public.table_name ADD COLUMN column_name TYPE [NOT NULL] [DEFAULT value];

-- If adding filterable column, add index
CREATE INDEX idx_table_name_column_name ON public.table_name(column_name);
-- Or composite with workspace_id for tenant queries:
CREATE INDEX idx_table_name_workspace_column ON public.table_name(workspace_id, column_name);
```

### Adding Enum Types

```sql
-- Create enum
CREATE TYPE enum_name AS ENUM ('value1', 'value2', 'value3');

-- Later in same migration, use in table
```

## Index Guidelines

| Query Pattern | Index Type |
|--------------|------------|
| Filter by workspace | `(workspace_id)` |
| Filter by workspace + status | `(workspace_id, status)` |
| Filter by workspace + date range | `(workspace_id, date_column)` |
| Lookup by external ID | `(workspace_id, external_id)` UNIQUE |
| Partial index for active only | `(column) WHERE condition` |
| Text search | Consider `gin` index |

**Always index:**
- `workspace_id` (mandatory for tenant tables)
- Foreign keys
- Columns used in WHERE/ORDER BY frequently
- Unique external identifiers (stripe_id, etc.)

## RLS Policy Patterns

### Standard workspace access (most common)
```sql
CREATE POLICY "Workspace scoped access" ON public.table_name
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));
```

### Separate SELECT/INSERT/UPDATE/DELETE (when needed)
```sql
CREATE POLICY "Users can view" ON public.table_name
  FOR SELECT USING (workspace_id IN (SELECT public.user_workspace_ids()));

CREATE POLICY "Admins can insert" ON public.table_name
  FOR INSERT WITH CHECK (
    workspace_id IN (SELECT public.user_workspace_ids())
    AND EXISTS (
      SELECT 1 FROM public.workspace_members 
      WHERE workspace_id = table_name.workspace_id 
      AND user_id = auth.uid() 
      AND role IN ('owner', 'admin')
    )
  );
```

### User-specific table (e.g., notifications)
```sql
CREATE POLICY "Users can view own" ON public.notifications
  FOR SELECT USING (user_id = auth.uid());
```

---

## Cross-Tenant Data Leak Checklist

Run this checklist for EVERY schema change:

```
Cross-Tenant Security Checklist:
================================

□ 1. WORKSPACE_ID PRESENT
   - Does this table need workspace_id?
   - If yes, is it NOT NULL with FK to workspaces(id)?
   - If no, does it properly inherit isolation via parent FK?

□ 2. RLS ENABLED
   - Is RLS enabled on the table?
   - Command: ALTER TABLE public.X ENABLE ROW LEVEL SECURITY;

□ 3. RLS POLICY EXISTS
   - Is there a policy for ALL or (SELECT + INSERT + UPDATE + DELETE)?
   - Does the policy use user_workspace_ids() helper or equivalent?
   - Are there any paths that bypass workspace check?

□ 4. FK CASCADES
   - ON DELETE CASCADE for workspace_id FK? (prevents orphaned rows)
   - ON DELETE behavior correct for other FKs?

□ 5. NO GUESSABLE IDS
   - Are UUIDs used (not sequential integers)?
   - Can an attacker enumerate records by guessing IDs?
   - Even with correct IDs, does RLS block access?

□ 6. QUERY PATTERNS
   - Will application queries always filter by workspace_id?
   - Are there any queries that could accidentally leak data?
   - Edge functions: Is workspace_id derived from auth, not request body?

□ 7. INDEXES SUPPORT RLS
   - Is workspace_id indexed for efficient policy checks?
   - Will the RLS policy cause full table scans?

□ 8. SERVICE ROLE ACCESS
   - Do any Edge Functions use service role on this table?
   - If yes, do they properly filter by workspace_id in code?
```

## Migration Template

```sql
-- Collectly Database Migration
-- Migration: XXX_description
-- Description: [What this migration does]

-- ============================================
-- ENUMS (if any)
-- ============================================

-- ============================================
-- TABLES
-- ============================================

-- ============================================
-- INDEXES
-- ============================================

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

-- ============================================
-- TRIGGERS (if any)
-- ============================================

-- ============================================
-- ROLLBACK (keep commented, for reference)
-- ============================================
-- DROP POLICY IF EXISTS "..." ON public.table_name;
-- DROP INDEX IF EXISTS idx_...;
-- DROP TABLE IF EXISTS public.table_name;
-- DROP TYPE IF EXISTS type_name;
```

## Example: Complete New Table Migration

Request: "Add a `payment_attempts` table to track retry attempts for failed payments"

```sql
-- Collectly Database Migration
-- Migration: 005_add_payment_attempts
-- Description: Track payment retry attempts per invoice

-- ============================================
-- ENUMS
-- ============================================

CREATE TYPE payment_attempt_status AS ENUM (
  'pending',
  'processing', 
  'succeeded',
  'failed'
);

-- ============================================
-- TABLES
-- ============================================

CREATE TABLE public.payment_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  invoice_id UUID NOT NULL REFERENCES public.invoices(id) ON DELETE CASCADE,
  status payment_attempt_status NOT NULL DEFAULT 'pending',
  amount_cents INTEGER NOT NULL,
  stripe_payment_intent_id TEXT,
  error_code TEXT,
  error_message TEXT,
  attempted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_payment_attempts_workspace_id ON public.payment_attempts(workspace_id);
CREATE INDEX idx_payment_attempts_invoice_id ON public.payment_attempts(invoice_id);
CREATE INDEX idx_payment_attempts_workspace_status ON public.payment_attempts(workspace_id, status);
CREATE INDEX idx_payment_attempts_stripe_pi ON public.payment_attempts(stripe_payment_intent_id) 
  WHERE stripe_payment_intent_id IS NOT NULL;

-- ============================================
-- ROW LEVEL SECURITY
-- ============================================

ALTER TABLE public.payment_attempts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Workspace scoped access" ON public.payment_attempts
  FOR ALL USING (workspace_id IN (SELECT public.user_workspace_ids()));

-- ============================================
-- ROLLBACK
-- ============================================
-- DROP POLICY IF EXISTS "Workspace scoped access" ON public.payment_attempts;
-- DROP TABLE IF EXISTS public.payment_attempts;
-- DROP TYPE IF EXISTS payment_attempt_status;
```

## Common Mistakes to Avoid

| Mistake | Consequence | Fix |
|---------|-------------|-----|
| Missing `workspace_id` | Cross-tenant data exposure | Always add for tenant tables |
| RLS not enabled | No isolation even with policies | `ALTER TABLE ... ENABLE ROW LEVEL SECURITY` |
| Policy uses request body | Attacker controls workspace_id | Derive from `auth.uid()` + membership |
| Missing workspace_id index | Slow queries, timeouts | Add index before adding data |
| Sequential integer IDs | Enumeration attacks | Use UUIDs |
| `FOR ALL` when you need granular | Over-permissive access | Split into SELECT/INSERT/UPDATE/DELETE |

## Validation Commands

After applying migration, verify:

```sql
-- Check RLS is enabled
SELECT tablename, rowsecurity FROM pg_tables 
WHERE schemaname = 'public' AND tablename = 'your_table';

-- Check policies exist
SELECT * FROM pg_policies WHERE tablename = 'your_table';

-- Check indexes
SELECT indexname, indexdef FROM pg_indexes 
WHERE tablename = 'your_table';

-- Test isolation (as different workspace user)
-- Should return 0 rows if RLS working
SELECT * FROM your_table WHERE workspace_id = 'other-workspace-uuid';
```
