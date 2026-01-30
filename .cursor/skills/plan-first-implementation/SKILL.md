---
name: plan-first-implementation
description: Enforces structured planning before coding for multi-file or complex changes. Use when implementing features, refactors, or bug fixes that touch multiple files, require architectural decisions, or have non-obvious edge cases.
---

# Plan-first Implementation

Before writing any code for complex or multi-file changes, complete this structured planning process.

## When to Apply

Automatically use this workflow when:
- Change touches 3+ files
- Involves database schema or migrations
- Requires coordination across frontend/backend/functions
- Has unclear requirements or multiple valid approaches
- Risk of breaking existing functionality

Skip for trivial changes (typo fixes, single-line updates, config tweaks).

## Planning Template

### 1. Behavior Summary

**Current behavior:**
Describe what the system does today. Include relevant code paths, data flow, and user-facing behavior.

**Desired behavior:**
Describe the target state. Be specific about what changes and what stays the same.

**Smallest diff:**
Identify the minimal set of changes needed. Avoid scope creep. Ask: "What can I NOT change?"

### 2. Files to Change

List each file with its specific modification:

| File | Change Type | Description |
|------|-------------|-------------|
| `path/to/file.ts` | modify | Add validation to X function |
| `path/to/new.ts` | create | New utility for Y |
| `path/to/old.ts` | delete | No longer needed after Z |

### 3. Edge Cases

Enumerate edge cases that must be handled:

- [ ] Empty/null inputs
- [ ] Concurrent access / race conditions
- [ ] Permission boundaries (RLS, auth)
- [ ] Error states and rollback scenarios
- [ ] Migration of existing data
- [ ] Backward compatibility

Add domain-specific edge cases relevant to the change.

### 4. Test Plan

**Manual verification:**
- Step-by-step actions to verify the change works

**Automated tests:**
- Unit tests needed (list specific scenarios)
- Integration tests needed
- Edge case coverage

**Rollback plan:**
- How to revert if something goes wrong

## Workflow

1. **Draft the plan** using the template above
2. **Review with user** if scope is large or uncertain
3. **Implement** following the file list in order
4. **Verify** using the test plan
5. **Update plan** if implementation reveals new considerations

## Anti-patterns

- Starting to code before understanding current behavior
- Making "while I'm here" changes outside the smallest diff
- Skipping edge case analysis for "simple" changes that aren't
- Implementing without a rollback strategy

## Example

**Task:** Add email notification when invoice becomes overdue

**Current behavior:**
- Scheduler runs daily, updates invoice status to "overdue" when past due_date
- No notification sent

**Desired behavior:**
- Same status update + send email via existing email service
- Only send once per invoice (not on every scheduler run)

**Smallest diff:**
- Add `overdue_notified_at` column to invoices
- Modify scheduler to send email when transitioning to overdue
- Skip if already notified

**Files to change:**
| File | Change | Description |
|------|--------|-------------|
| `supabase/migrations/xxx.sql` | create | Add overdue_notified_at column |
| `supabase/functions/scheduler/index.ts` | modify | Add notification logic |
| `supabase/functions/_shared/email.ts` | modify | Add overdue template |

**Edge cases:**
- [ ] Invoice already overdue before migration
- [ ] Email service failure (retry? skip?)
- [ ] Customer has no email address
- [ ] Workspace email settings disabled

**Test plan:**
- Create invoice with past due_date, run scheduler, verify email sent
- Run scheduler again, verify no duplicate email
- Test with invalid email, verify graceful failure
