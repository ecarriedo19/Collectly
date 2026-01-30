---
name: frontend-engineer
description: Build and review React UI components following Collectly patterns including shadcn/Tailwind, loading/error/empty states, accessibility, state predictability, and clean component boundaries. Use when creating pages, components, or reviewing frontend code.
---

# Frontend Engineer

Build React UIs using Collectly's existing patterns. Focus on UI quality, state predictability, accessibility, and clean component boundaries.

## Quick Start

When creating or modifying frontend code:

1. Check existing patterns in `frontend/src/pages/` and `frontend/src/components/`
2. Use shadcn components from `frontend/src/components/ui/`
3. Follow the state patterns below
4. Include loading/error/empty states

## Component Structure

### Page Template

```jsx
import { useState, useEffect } from "react";
import Layout from "../components/Layout";
import api from "../lib/api";
import { RefreshCw } from "lucide-react";

export default function YourPage({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.yourEndpoint.get();
      setData(result);
    } catch (err) {
      console.error('Error fetching data:', err);
      setError(err.message || 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  // Loading state
  if (loading) {
    return (
      <Layout user={user}>
        <div className="flex items-center justify-center h-64">
          <RefreshCw className="w-6 h-6 animate-spin text-slate-400" />
        </div>
      </Layout>
    );
  }

  // Error state
  if (error) {
    return (
      <Layout user={user}>
        <div className="text-center py-12">
          <p className="text-rose-600">{error}</p>
          <Button onClick={fetchData} variant="outline" className="mt-4">
            Try again
          </Button>
        </div>
      </Layout>
    );
  }

  // Empty state
  if (!data || data.items?.length === 0) {
    return (
      <Layout user={user}>
        <div className="text-center py-12">
          <p className="text-slate-500">No items yet.</p>
          {/* Add CTA if applicable */}
        </div>
      </Layout>
    );
  }

  // Main content
  return (
    <Layout user={user}>
      {/* Your content */}
    </Layout>
  );
}
```

### Small Component Pattern

Keep components focused. Extract when a component exceeds ~100 lines or has distinct responsibility.

```jsx
// Good: Focused sub-component
function MetricCard({ title, value, subtitle, icon, iconBg }) {
  return (
    <Card className="card-hover">
      <CardContent className="p-6">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-sm font-medium text-slate-500 uppercase tracking-wider">{title}</p>
            <p className="text-2xl font-bold text-slate-900 mt-2 tabular-nums">{value}</p>
            <p className="text-sm text-slate-500 mt-1">{subtitle}</p>
          </div>
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${iconBg}`}>
            {icon}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
```

## UI Components

### shadcn Components

Import from `../components/ui/`:

```jsx
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
```

Available: accordion, alert, badge, button, card, checkbox, dialog, dropdown-menu, form, input, label, popover, select, sheet, skeleton, switch, table, tabs, textarea, toast, tooltip.

### Icons

Use lucide-react:

```jsx
import { DollarSign, AlertTriangle, CheckCircle, RefreshCw, ExternalLink } from "lucide-react";
```

### Tailwind Patterns

Standard color scales:
- Primary: `indigo-600`, `indigo-700` (hover)
- Success: `emerald-*`
- Warning: `amber-*`
- Error: `rose-*`
- Neutral: `slate-*`

Common utility classes:
```jsx
// Cards with hover
className="card-hover"

// Button active state
className="btn-active"

// Table rows
className="border-b border-slate-100 table-row-hover"

// Monospace numbers
className="tabular-nums"

// Truncate text
className="truncate"
```

## State Management

### Predictable State

1. **Single source of truth**: One state variable per concept
2. **Derived state**: Compute in render, don't store
3. **Clear updates**: setLoading → fetch → setData/setError → setLoading(false)

```jsx
// Good: Derived state
const isPastDue = invoice.status === 'past_due';
const daysOverdue = invoice.due_date ? getDaysDiff(invoice.due_date) : null;

// Bad: Redundant state
const [isPastDue, setIsPastDue] = useState(false); // Don't store derived values
```

### Form State

For simple forms, use local state. For complex forms, use react-hook-form (already available via shadcn form).

```jsx
// Simple form
const [name, setName] = useState('');
const [saving, setSaving] = useState(false);

const handleSubmit = async (e) => {
  e.preventDefault();
  setSaving(true);
  try {
    await api.resource.create({ name });
    // Handle success
  } catch (err) {
    // Handle error
  } finally {
    setSaving(false);
  }
};
```

## Data Fetching

### API Layer

Always use `lib/api.js`. Never call Supabase directly from components for operations that need workspace scoping.

```jsx
// Good
import api from "../lib/api";
const data = await api.invoices.list({ status: 'open' });

// Bad - bypasses auth/workspace scoping
import { supabase } from "../lib/supabase";
const { data } = await supabase.from('invoices').select('*'); // Wrong!
```

### Safe for Direct Supabase

Only use direct Supabase client for:
- Auth operations via `useAuth` context
- Real-time subscriptions (if needed)

## Security Rules

### Never in Client Code

- API keys or secrets
- Service role tokens
- Direct database queries that bypass RLS
- Workspace IDs from user input (derive from auth)

```jsx
// Bad - hardcoded secret
const STRIPE_KEY = 'sk_live_...';

// Bad - trusting user input for workspace
await api.get(`/data?workspace_id=${userInput}`);

// Good - let backend derive workspace from auth token
await api.invoices.list();
```

### Auth Pattern

Use AuthContext, never localStorage for tokens:

```jsx
import { useAuth } from "../contexts/AuthContext";

function MyComponent() {
  const { user, signOut } = useAuth();
  // user is null when not authenticated
}
```

## Accessibility

### Required Practices

1. **Interactive elements**: All buttons, links, inputs must be keyboard accessible
2. **Labels**: Form inputs need associated labels
3. **Test IDs**: Add `data-testid` for testable elements
4. **Color contrast**: Don't rely solely on color to convey information
5. **Focus states**: Visible focus indicators (Tailwind handles most)

```jsx
// Good: Labeled input
<div>
  <Label htmlFor="email">Email</Label>
  <Input id="email" type="email" data-testid="email-input" />
</div>

// Good: Accessible button with icon
<Button data-testid="refresh-btn" aria-label="Refresh data">
  <RefreshCw className="w-4 h-4" />
</Button>

// Good: Status with both color and text
<span className="text-rose-600">Error: {message}</span>
```

## Review Checklist

Before submitting frontend code:

- [ ] Loading state shows spinner or skeleton
- [ ] Error state shows message + retry option
- [ ] Empty state has helpful message (+ CTA if applicable)
- [ ] Uses shadcn components from `ui/`
- [ ] Data fetched via `lib/api.js`
- [ ] No secrets or tokens in client code
- [ ] Form inputs have labels
- [ ] Interactive elements have `data-testid`
- [ ] Component < 200 lines (extract if larger)
- [ ] State is predictable (no redundant/derived state stored)
- [ ] Tailwind classes follow existing patterns

## Common Patterns Reference

### Status Badges

```jsx
<span className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium ${
  status === 'paid' ? 'text-emerald-700 bg-emerald-50' :
  status === 'past_due' ? 'text-rose-700 bg-rose-50' :
  'text-slate-700 bg-slate-100'
}`}>
  {statusText}
</span>
```

### Responsive Grid

```jsx
<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
  {/* Cards */}
</div>
```

### Table with Empty State

```jsx
{items.length === 0 ? (
  <div className="text-center py-12">
    <p className="text-slate-500">No items found.</p>
  </div>
) : (
  <table className="w-full">
    {/* Table content */}
  </table>
)}
```

### Action Button

```jsx
<Button 
  onClick={handleAction}
  disabled={loading}
  className="bg-indigo-600 hover:bg-indigo-700 text-white btn-active"
  data-testid="action-btn"
>
  {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : 'Action'}
</Button>
```
