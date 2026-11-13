-- Google Calendar sync through Make.com. Run AFTER schema.sql and roles.sql:
-- Supabase Dashboard -> SQL Editor -> New query -> paste all of this -> Run. Safe to run again.
--
-- Every time a call is added, changed or deleted in the CRM, the database sends the call
-- (with the lead's name, email and phone) to your Make webhook. Make creates, moves or deletes
-- the Google Calendar event, then saves the event's ID back on the call with set_call_event(),
-- so later changes update the same event instead of making a new one.
--
-- After running this, connect it to your Make scenario:
--   update public.calendar_sync set webhook_url = 'https://hook.<region>.make.com/...', enabled = true;
--   select token from public.calendar_sync;   -- paste this into Make (see set_call_event below)
-- Change time_zone if the team doesn't work in India time:
--   update public.calendar_sync set time_zone = 'Asia/Dubai';

create extension if not exists pg_net;

-- The Google Calendar event a call belongs to. Only Make sets this; the CRM never sends it.
alter table public.calls add column if not exists gcal_event_id text;
-- Calendar guests besides the host, set on the call form: the lead ('Yes'/'No') and one more email.
alter table public.calls add column if not exists invite_lead text not null default 'Yes';
alter table public.calls add column if not exists guest_email text;

-- One settings row. No access rules are granted, so only the functions below can read it:
-- the webhook URL and token never reach the browser.
create table if not exists public.calendar_sync (
  id          boolean primary key default true check (id),
  webhook_url text,
  token       text not null default replace(gen_random_uuid()::text, '-', ''),
  time_zone   text not null default 'Asia/Kolkata',
  enabled     boolean not null default false
);
alter table public.calendar_sync enable row level security;
insert into public.calendar_sync default values on conflict (id) do nothing;

-- ---------- CRM -> Make ----------
create or replace function public.send_call_to_calendar() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  cfg    public.calendar_sync;
  c      public.calls;
  lead   public.contacts;
  action text;
  starts timestamptz;
  guests jsonb := '[]'::jsonb;
begin
  select * into cfg from public.calendar_sync where id;
  if not found or not cfg.enabled or coalesce(cfg.webhook_url, '') = '' then return null; end if;

  if tg_op = 'DELETE' then
    c := old; action := 'deleted';
  else
    c := new;
    -- Make saving the event ID back is not a change worth sending again (it would loop).
    if tg_op = 'UPDATE' and (to_jsonb(new) - 'gcal_event_id') = (to_jsonb(old) - 'gcal_event_id') then return null; end if;
    action := case tg_op when 'INSERT' then 'created' else 'updated' end;
  end if;

  select * into lead from public.contacts where id = c.contact_id;
  -- Calls store a plain date and time; read them in the team's time zone.
  if c.date is not null then starts := (c.date + coalesce(c.time, time '09:00')) at time zone cfg.time_zone; end if;
  -- Up to two guests besides the host: the lead (unless switched off) and the extra guest.
  if coalesce(c.invite_lead, 'Yes') <> 'No' and coalesce(lead.email, '') <> '' then
    guests := guests || jsonb_build_array(jsonb_build_object('email', lower(lead.email), 'displayName', lead.name));
  end if;
  if coalesce(c.guest_email, '') <> '' and lower(c.guest_email) <> lower(coalesce(lead.email, '')) then
    guests := guests || jsonb_build_array(jsonb_build_object('email', lower(c.guest_email)));
  end if;

  perform net.http_post(
    url     := cfg.webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'action',       action,                 -- created | updated | deleted
      'call_id',      c.id,
      'event_id',     c.gcal_event_id,        -- empty until Make has created the event
      'status',       c.status,               -- Scheduled | Completed | No-show | Cancelled
      'type',         c.type,
      'title',        coalesce(c.type, 'Call') || ' · ' || coalesce(lead.name, 'Lead'),
      'start',        starts,
      'end',          starts + make_interval(mins => coalesce(c.duration, 30)),
      'time_zone',    cfg.time_zone,
      'notes',        c.notes,
      'attendees',    guests,                 -- [{ "email": ..., "displayName": ... }], 0-2 people
      'attendee_1',   guests -> 0 ->> 'email',
      'attendee_2',   guests -> 1 ->> 'email',
      'lead_name',    lead.name,
      'lead_email',   lead.email,
      'lead_phone',   lead.phone,
      'lead_company', lead.company
    )
  );
  return null;
end $$;

drop trigger if exists calls_to_calendar on public.calls;
create trigger calls_to_calendar after insert or update or delete on public.calls
  for each row execute function public.send_call_to_calendar();

-- ---------- Make -> CRM ----------
-- Make saves the Google Calendar event ID on a call. It calls this with the publishable key plus the
-- token from calendar_sync, so Make never needs the Supabase secret key. An empty event ID clears it.
create or replace function public.set_call_event(p_call_id text, p_event_id text, p_token text) returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not exists (select 1 from public.calendar_sync where id and token = p_token) then
    raise exception 'Invalid calendar sync token';
  end if;
  update public.calls set gcal_event_id = nullif(p_event_id, '') where id = p_call_id;
end $$;
revoke all on function public.set_call_event(text, text, text) from public;
grant execute on function public.set_call_event(text, text, text) to anon, authenticated;
