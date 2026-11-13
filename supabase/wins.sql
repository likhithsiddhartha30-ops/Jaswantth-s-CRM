-- Win alerts: when a deal moves into a Won status (PIF, In-House Finance, or any status marked
-- "Won" in Settings), send the client and payment details to a Make webhook that posts to Discord.
-- Run AFTER schema.sql and roles.sql: Supabase Dashboard -> SQL Editor -> paste all -> Run. Safe to run again.
--
-- Then turn it on with your Make webhook URL:
--   update public.win_alerts set webhook_url = 'https://hook.us2.make.com/...', enabled = true;
-- Pause it:
--   update public.win_alerts set enabled = false;

create extension if not exists pg_net;

-- What was collected when the deal closed. The CRM's deal form fills these in.
alter table public.deals add column if not exists paid_upfront numeric not null default 0;
alter table public.deals add column if not exists payment_method text;

-- One settings row. No access rules are granted, so the webhook URL never reaches the browser.
create table if not exists public.win_alerts (
  id          boolean primary key default true check (id),
  webhook_url text,
  enabled     boolean not null default false
);
alter table public.win_alerts enable row level security;
insert into public.win_alerts default values on conflict (id) do nothing;

create or replace function public.usd(amount numeric) returns text
language sql immutable
as $$ select '$' || to_char(coalesce(amount, 0), 'FM999,999,999,990') $$;

create or replace function public.send_win_alert() returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  cfg     public.win_alerts;
  types   jsonb;
  lead    public.contacts;
  closer  public.members;
  balance numeric;
  who     text;
begin
  select * into cfg from public.win_alerts where id;
  if not found or not cfg.enabled or coalesce(cfg.webhook_url, '') = '' then return null; end if;

  -- Only the moment a deal becomes Won: not edits to an already-won deal.
  select stage_types into types from public.workspace where id;
  if coalesce(types ->> new.stage, '') <> 'Won' then return null; end if;
  if tg_op = 'UPDATE' and coalesce(types ->> old.stage, '') = 'Won' then return null; end if;

  select * into lead from public.contacts where id = new.contact_id;
  -- Whoever saved the change in the CRM.
  select * into closer from public.members where email = lower(coalesce(auth.jwt() ->> 'email', ''));
  who     := coalesce(nullif(closer.name, ''), split_part(closer.email, '@', 1), 'Someone');
  balance := greatest(coalesce(new.value, 0) - coalesce(new.paid_upfront, 0), 0);

  perform net.http_post(
    url     := cfg.webhook_url,
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body    := jsonb_build_object(
      'event',          'deal_won',
      'deal_id',        new.id,
      'deal_title',     new.title,
      'stage',          new.stage,
      'deal_value',     coalesce(new.value, 0),
      'paid_upfront',   coalesce(new.paid_upfront, 0),
      'balance_due',    balance,
      'payment_method', coalesce(nullif(new.payment_method, ''), 'Not recorded'),
      'closed_on',      coalesce(new.close, current_date),
      'closed_by',      who,
      'closed_by_role', closer.role,
      'client_name',    lead.name,
      'client_company', lead.company,
      'client_email',   lead.email,
      'client_phone',   lead.phone,
      'client_source',  lead.source,
      'client_added',   lead.created,
      -- Ready to post as-is in Discord.
      'discord_message', format(
        -- One text value: a line break between the pieces joins them, and the E on the first piece
        -- makes \n a new line in all of them (Postgres only allows the E on the first).
        E'🎉 **New client closed!**\n'
        '**Client:** %s%s\n'
        '**Deal:** %s (%s)\n'
        '**Deal value:** %s\n'
        '**Paid upfront:** %s via %s\n'
        '**Balance due:** %s\n'
        '**Closed by:** %s\n'
        '**Source:** %s',
        coalesce(lead.name, 'Unknown'), coalesce(' · ' || nullif(lead.company, ''), ''),
        new.title, new.stage,
        public.usd(new.value),
        public.usd(new.paid_upfront), coalesce(nullif(new.payment_method, ''), 'not recorded'),
        public.usd(balance),
        who,
        coalesce(nullif(lead.source, ''), 'Unknown')
      )
    )
  );
  return null;
end $$;

drop trigger if exists deals_win_alert on public.deals;
create trigger deals_win_alert after insert or update on public.deals
  for each row execute function public.send_win_alert();
