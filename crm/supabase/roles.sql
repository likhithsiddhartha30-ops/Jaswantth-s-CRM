-- Team, roles and a shared CRM. Run AFTER schema.sql:
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run. Safe to run again.
--
-- Everyone on the team works in the same leads, deals, calls and campaigns.
-- What each role can see and change is enforced here, by Row Level Security:
--
--   role         reads                                      writes
--   admin        everything                                 everything, plus the team list
--   setter       leads, deals, calls, tasks, campaigns      leads, calls, tasks
--   closer       leads, deals, calls, tasks, campaigns      leads, deals, calls, tasks
--   media_buyer  leads, deals, campaigns                    campaigns
--   client       deals, campaigns, lead names only          nothing
--
-- Only people on the team list can create an account (see the auth.users trigger below).

-- ---------- Team list ----------
create table if not exists public.members (
  email    text primary key check (email = lower(email)),
  name     text not null default '',
  role     text not null check (role in ('admin', 'setter', 'closer', 'media_buyer', 'client')),
  added_at timestamptz not null default now()
);

insert into public.members (email, role)
values ('likhithsiddhartha30@gmail.com', 'admin')
on conflict (email) do update set role = 'admin';

-- The signed-in person's role, or null if they aren't on the team.
create or replace function public.crm_role() returns text
language sql stable security definer set search_path = public
as $$ select role from public.members where email = lower(coalesce(auth.jwt() ->> 'email', '')) $$;
revoke all on function public.crm_role() from public, anon;
grant execute on function public.crm_role() to authenticated;

alter table public.members enable row level security;
drop policy if exists "read own or admin" on public.members;
drop policy if exists "admin manages" on public.members;
create policy "read own or admin" on public.members for select to authenticated
  using (email = lower(auth.jwt() ->> 'email') or public.crm_role() = 'admin');
create policy "admin manages" on public.members for all to authenticated
  using (public.crm_role() = 'admin') with check (public.crm_role() = 'admin');

-- Never leave the CRM without an admin.
create or replace function public.keep_one_admin() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if old.role = 'admin' and (tg_op = 'DELETE' or new.role <> 'admin')
     and (select count(*) from public.members where role = 'admin') <= 1 then
    raise exception 'The CRM needs at least one admin';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists keep_one_admin on public.members;
create trigger keep_one_admin before update or delete on public.members
  for each row execute function public.keep_one_admin();

-- Team page: everyone on the list, and whether they have set up their account yet.
create or replace function public.team_members()
returns table (email text, name text, role text, added_at timestamptz, joined boolean, last_sign_in timestamptz)
language sql stable security definer set search_path = public
as $$
  select m.email, m.name, m.role, m.added_at,
         coalesce(u.email_confirmed_at is not null, false), u.last_sign_in_at
  from public.members m
  left join auth.users u on lower(u.email) = m.email
  where public.crm_role() = 'admin'
  order by m.added_at
$$;
revoke all on function public.team_members() from public, anon;
grant execute on function public.team_members() to authenticated;

-- ---------- Invite-only sign-up ----------
-- Accounts can only be created for emails on the team list, whether through the CRM's
-- "Set up your account" screen, a dashboard invite, or the API.
create or replace function public.only_team_signups() returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.members where email = lower(new.email)) then
    raise exception 'This email has not been added to the CRM team';
  end if;
  return new;
end $$;
drop trigger if exists only_team_signups on auth.users;
create trigger only_team_signups before insert on auth.users
  for each row execute function public.only_team_signups();

-- ---------- Shared settings (stages, sources, colours, views, goal) ----------
create table if not exists public.workspace (
  id            boolean primary key default true check (id),
  stages        text[]  not null default '{}',
  stage_types   jsonb   not null default '{}'::jsonb,
  statuses      text[]  not null default '{}',
  sources       text[]  not null default '{}',
  colors        jsonb   not null default '{}'::jsonb,
  views         jsonb   not null default '[]'::jsonb,
  integrations  jsonb   not null default '{}'::jsonb,
  revenue_goal  numeric not null default 30000,
  updated_at    timestamptz not null default now()
);
-- Carry over the per-person settings from before, preferring the admin's.
insert into public.workspace (stages, stage_types, statuses, sources, colors, views, integrations, revenue_goal)
select s.stages, s.stage_types, s.statuses, s.sources, s.colors, s.views, s.integrations, s.revenue_goal
from public.crm_settings s
left join auth.users u on u.id = s.user_id
order by (u.email = 'likhithsiddhartha30@gmail.com') desc nulls last, s.updated_at desc
limit 1
on conflict (id) do nothing;

-- ---------- Records belong to the team, not to whoever created them ----------
-- user_id stays as "created by"; removing a person's account no longer deletes their records.
do $$
declare t text;
begin
  foreach t in array array['contacts', 'deals', 'calls', 'tasks', 'campaigns', 'activity'] loop
    execute format('alter table public.%I alter column user_id drop not null', t);
    execute format('alter table public.%I drop constraint if exists %I', t, t || '_user_id_fkey');
    execute format('alter table public.%I add constraint %I foreign key (user_id) references auth.users (id) on delete set null', t, t || '_user_id_fkey');
  end loop;
end $$;

-- Clients see lead names (for the pipeline and revenue views) but not emails or phone numbers.
create or replace view public.contact_names as
  select id, name, company, status, source, created, inserted_at
  from public.contacts
  where public.crm_role() is not null;
revoke all on public.contact_names from anon;
grant select on public.contact_names to authenticated;

-- ---------- Access rules ----------
do $$
declare t text; readers text[]; writers text[];
begin
  for t, readers, writers in select * from (values
    ('contacts',  array['admin','setter','closer','media_buyer'],          array['admin','setter','closer']),
    ('deals',     array['admin','setter','closer','media_buyer','client'], array['admin','closer']),
    ('calls',     array['admin','setter','closer'],                        array['admin','setter','closer']),
    ('tasks',     array['admin','setter','closer'],                        array['admin','setter','closer']),
    ('campaigns', array['admin','setter','closer','media_buyer','client'], array['admin','media_buyer']),
    ('activity',  array['admin','setter','closer','media_buyer'],          array['admin','setter','closer','media_buyer']),
    ('workspace', array['admin','setter','closer','media_buyer','client'], array['admin'])
  ) as v(t, r, w) loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "own rows" on public.%I', t);
    execute format('drop policy if exists "team reads" on public.%I', t);
    execute format('drop policy if exists "team adds" on public.%I', t);
    execute format('drop policy if exists "team edits" on public.%I', t);
    execute format('drop policy if exists "team deletes" on public.%I', t);
    execute format('create policy "team reads" on public.%I for select to authenticated using (public.crm_role() = any (%L::text[]))', t, readers);
    execute format('create policy "team adds" on public.%I for insert to authenticated with check (public.crm_role() = any (%L::text[]))', t, writers);
    execute format('create policy "team edits" on public.%I for update to authenticated using (public.crm_role() = any (%L::text[])) with check (public.crm_role() = any (%L::text[]))', t, writers, writers);
    execute format('create policy "team deletes" on public.%I for delete to authenticated using (public.crm_role() = any (%L::text[]))', t, writers);
  end loop;
end $$;
