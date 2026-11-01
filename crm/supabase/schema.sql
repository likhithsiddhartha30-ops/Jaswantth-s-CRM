-- Lumen CRM schema for Supabase.
-- Paste into Supabase Dashboard -> SQL Editor -> New query -> Run.
-- Every row belongs to the signed-in user (auth.users), and Row Level Security
-- makes sure each user can only read and write their own rows.
-- Ids are text so the app's existing short ids (uid()) still work.

-- ---------- Settings: one row per user (lists, colours, views, goal) ----------
create table if not exists public.crm_settings (
  user_id       uuid primary key references auth.users (id) on delete cascade default auth.uid(),
  stages        text[]  not null default '{}',
  stage_types   jsonb   not null default '{}'::jsonb,  -- { "PIF": "Won", ... }
  statuses      text[]  not null default '{}',
  sources       text[]  not null default '{}',
  colors        jsonb   not null default '{}'::jsonb,  -- { stages: {}, statuses: {}, sources: {} }
  views         jsonb   not null default '[]'::jsonb,  -- saved smart views on the Leads page
  integrations  jsonb   not null default '{}'::jsonb,
  revenue_goal  numeric not null default 30000,
  updated_at    timestamptz not null default now()
);

-- ---------- Leads / contacts ----------
create table if not exists public.contacts (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name        text not null,
  company     text,
  email       text,
  phone       text,
  status      text,            -- lead stage, e.g. "Call Booked"
  source      text,            -- e.g. "Instagram"
  created     date not null default current_date,
  notes       text,
  inserted_at timestamptz not null default now()
);

-- ---------- Deals / opportunities ----------
create table if not exists public.deals (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title       text not null,
  contact_id  text references public.contacts (id) on delete set null,
  value       numeric not null default 0,
  stage       text,
  close       date,
  inserted_at timestamptz not null default now()
);

-- ---------- Calls ----------
create table if not exists public.calls (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  contact_id  text references public.contacts (id) on delete cascade,
  type        text,            -- Discovery call, Follow-up, Demo, Onboarding, Check-in
  status      text not null default 'Scheduled',  -- Scheduled, Completed, No-show, Cancelled
  date        date,
  time        time,
  duration    integer not null default 30,         -- minutes
  notes       text,
  inserted_at timestamptz not null default now()
);

-- ---------- Tasks ----------
create table if not exists public.tasks (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  title       text not null,
  contact_id  text references public.contacts (id) on delete set null,
  due         date,
  priority    text not null default 'Normal',      -- Normal, High
  done        boolean not null default false,
  inserted_at timestamptz not null default now()
);

-- ---------- Marketing campaigns ----------
create table if not exists public.campaigns (
  id          text primary key default gen_random_uuid()::text,
  user_id     uuid not null references auth.users (id) on delete cascade default auth.uid(),
  name        text not null,
  channel     text,
  start       date,
  spend       numeric not null default 0,
  impressions integer not null default 0,
  clicks      integer not null default 0,
  leads       integer not null default 0,
  inserted_at timestamptz not null default now()
);

-- ---------- Activity feed ----------
create table if not exists public.activity (
  id      text primary key default gen_random_uuid()::text,
  user_id uuid not null references auth.users (id) on delete cascade default auth.uid(),
  text    text not null,
  at      timestamptz not null default now()
);

-- ---------- Indexes ----------
create index if not exists contacts_user_idx  on public.contacts  (user_id);
create index if not exists deals_user_idx     on public.deals     (user_id);
create index if not exists deals_contact_idx  on public.deals     (contact_id);
create index if not exists calls_user_idx     on public.calls     (user_id, date);
create index if not exists calls_contact_idx  on public.calls     (contact_id);
create index if not exists tasks_user_idx     on public.tasks     (user_id, due);
create index if not exists tasks_contact_idx  on public.tasks     (contact_id);
create index if not exists campaigns_user_idx on public.campaigns (user_id);
create index if not exists activity_user_idx  on public.activity  (user_id, at desc);

-- ---------- Row Level Security: each user sees only their own rows ----------
do $$
declare t text;
begin
  foreach t in array array['crm_settings','contacts','deals','calls','tasks','campaigns','activity'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format(
      'create policy "own rows" on public.%I for all to authenticated
         using ((select auth.uid()) = user_id)
         with check ((select auth.uid()) = user_id)', t);
  end loop;
end $$;
