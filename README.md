# Collectly

**Automated invoice follow-ups for SaaS businesses.**

Collectly connects to your Stripe and Gmail accounts to automate payment reminders. It syncs invoices from Stripe, sends personalized email reminders from your Gmail, automatically pauses when customers reply, and stops when invoices are paid.

## Features

- **Stripe Integration**: Connect your Stripe account to automatically sync customers and invoices
- **Gmail Integration**: Send reminders from your own Gmail account for better deliverability
- **Smart Autopilot**: Automatically pauses reminders when customers reply
- **Customizable Sequences**: Configure reminder timing and templates
- **Real-time Dashboard**: Track open invoices, past due amounts, and collection progress
- **Multi-tenant**: Secure workspace isolation for multiple users

## Tech Stack

- **Frontend**: React 19 + Tailwind CSS + Shadcn UI
- **Backend**: Supabase Edge Functions (TypeScript/Deno)
- **Database**: Supabase PostgreSQL with Row Level Security
- **Authentication**: Supabase Auth (Google OAuth)
- **Scheduler**: Supabase pg_cron
- **Hosting**: Cloudflare Pages (Frontend) + Supabase (Backend)

## Getting Started

### Prerequisites

- Node.js 18+
- Supabase CLI (`npm install -g supabase`)
- A Supabase account (free tier works for development)

### Local Development

1. **Clone the repository**
   ```bash
   git clone https://github.com/yourusername/collectly.git
   cd collectly
   ```

2. **Set up Supabase**
   ```bash
   # Start local Supabase
   supabase start
   
   # Apply migrations
   supabase db push
   ```

3. **Configure environment variables**
   ```bash
   # Frontend (.env.local)
   cp frontend/.env.example frontend/.env.local
   # Edit with your Supabase URL and anon key
   ```

4. **Start the frontend**
   ```bash
   cd frontend
   npm install
   npm start
   ```

5. **Access the app**
   - Frontend: http://localhost:3000
   - Supabase Studio: http://localhost:54323

### Environment Variables

#### Frontend
```env
REACT_APP_SUPABASE_URL=http://localhost:54321
REACT_APP_SUPABASE_ANON_KEY=your-anon-key
```

#### Supabase (Dashboard > Settings > Secrets)
```env
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
RESEND_API_KEY=your-resend-api-key (optional)
```

## Project Structure

```
collectly/
├── .cursor/skills/              # Cursor AI skills
├── docs/
│   └── ARCHITECTURE.md          # Technical documentation
├── frontend/
│   ├── public/                  # Static assets
│   └── src/
│       ├── components/
│       │   ├── ui/              # Shadcn UI components
│       │   ├── Layout.jsx       # App layout
│       │   ├── OnboardingWizard.jsx
│       │   ├── SetupBanner.jsx
│       │   └── SystemStatus.jsx
│       ├── contexts/            # React contexts
│       │   └── AuthContext.jsx
│       ├── hooks/               # Custom hooks
│       │   └── use-toast.js
│       ├── lib/                 # Utilities & API
│       │   ├── api.js           # API service layer
│       │   ├── date.js          # Date formatting
│       │   ├── supabase.js      # Supabase client
│       │   └── utils.js         # Tailwind utilities
│       ├── pages/               # Route pages
│       │   ├── Dashboard.jsx
│       │   ├── Invoices.jsx
│       │   ├── InvoiceDetail.jsx
│       │   ├── Integrations.jsx
│       │   ├── ReminderPolicy.jsx
│       │   ├── Settings.jsx
│       │   └── ...
│       ├── types/               # TypeScript types
│       │   └── index.ts
│       ├── App.js               # Main app + routing
│       └── index.js             # Entry point
├── supabase/
│   ├── config.toml              # Supabase configuration
│   ├── migrations/              # Database migrations
│   │   ├── 001_initial_schema.sql
│   │   └── ...
│   └── functions/               # Edge Functions
│       ├── _shared/             # Shared utilities
│       │   ├── cors.ts
│       │   ├── gmail.ts
│       │   ├── resend.ts
│       │   ├── stripe.ts
│       │   └── supabase.ts
│       ├── check-replies/       # Detect Gmail replies
│       ├── customers/           # Customer list
│       ├── dashboard/           # KPI metrics
│       ├── health/              # System health
│       ├── integrations-gmail/  # Gmail OAuth
│       ├── integrations-stripe/ # Stripe connection
│       ├── invoices/            # Invoice management
│       ├── notifications/       # User notifications
│       ├── onboarding/          # Onboarding flow
│       ├── policies/            # Reminder policies
│       ├── scheduler/           # Send reminders
│       ├── stripe-sync/         # Sync from Stripe
│       ├── stripe-webhook/      # Handle Stripe events
│       ├── weekly-digest/       # Weekly AR email
│       └── workspaces/          # Workspace CRUD
└── README.md
```

## Deployment

### Production Hosting ($25/month)

| Service | Purpose | Cost |
|---------|---------|------|
| Supabase Pro | Database, Auth, Edge Functions | $25/mo |
| Cloudflare Pages | Frontend hosting | Free |

### Deploy to Production

1. **Create Supabase project** at [supabase.com](https://supabase.com)

2. **Run migrations**
   ```bash
   supabase link --project-ref your-project-ref
   supabase db push
   ```

3. **Deploy Edge Functions**
   ```bash
   supabase functions deploy
   ```

4. **Set up Cloudflare Pages**
   - Connect your GitHub repository
   - Build command: `cd frontend && npm run build`
   - Output directory: `frontend/build`

5. **Configure secrets** in Supabase Dashboard > Settings > Secrets

## Documentation

- [Architecture Guide](docs/ARCHITECTURE.md) - Technical details, database schema, API reference
- [Supabase Docs](https://supabase.com/docs) - Edge Functions, Auth, Database

## Development Status

### Completed
- [x] Project structure and Supabase setup
- [x] Database schema with RLS (14 tables)
- [x] All core Edge Functions (15 functions)
- [x] Gmail OAuth integration + email sending
- [x] Stripe integration + webhook handling
- [x] Reminder scheduler (pg_cron)
- [x] Reply detection
- [x] Frontend with Supabase client
- [x] API service layer
- [x] Weekly digest Edge Function
- [x] TypeScript types for frontend

### MVP Sprint (In Progress)
- [ ] Stripe sync with UI-configurable schedule
- [ ] TypeScript migration for frontend (.jsx → .tsx)
- [ ] CORS restriction for production
- [ ] pg_cron jobs setup in production

### Post-MVP
- [ ] Real-time notifications (Supabase Realtime)
- [ ] Test coverage
- [ ] Error monitoring (Sentry)
- [ ] Production deployment

## License

MIT
