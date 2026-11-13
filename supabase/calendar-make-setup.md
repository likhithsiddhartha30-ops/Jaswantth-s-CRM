# Google Calendar sync with Make.com

Calls booked in the CRM appear on Google Calendar, move when they're rescheduled, and disappear when they're cancelled or deleted.

```
CRM call added / changed / deleted
   → Supabase sends it to your Make webhook          (calendar.sql)
   → Make creates, updates or deletes the event       (this scenario)
   → Make saves the event ID back on the call         (set_call_event)
```

## 1. Start the scenario in Make

1. In Make, create a new scenario.
2. Add **Webhooks → Custom webhook**, click **Add**, name it `CRM calls`, and **copy the URL**.

## 2. Connect Supabase to it

In Supabase → **SQL Editor**, run [calendar.sql](calendar.sql) once, then run this with your Make URL:

```sql
update public.calendar_sync set webhook_url = 'PASTE_MAKE_WEBHOOK_URL', enabled = true;
select token from public.calendar_sync;
```

Copy the **token** it shows; Make uses it in step 4.

To teach Make what the data looks like, click **Redetermine data structure** on the webhook module, then schedule a test call in the CRM. Make receives these fields:

| Field | Example |
|---|---|
| `action` | `created`, `updated` or `deleted` |
| `call_id` | `k3x9a1bq` |
| `event_id` | empty until the event exists |
| `status` | `Scheduled`, `Completed`, `No-show`, `Cancelled` |
| `title` | `Discovery call · Priya Raman` |
| `start`, `end` | `2026-11-14T04:30:00+00:00` (exact time, any time zone reads it correctly) |
| `notes`, `lead_name`, `lead_email`, `lead_phone`, `lead_company` | from the call and its lead |
| `attendees` | the guests besides you: the lead (if "Invite the lead" is Yes) and the extra guest. 0–2 people, each with `email` and `displayName` |
| `attendee_1`, `attendee_2` | the same guests as plain emails, empty when there's nobody |

## 3. Add a Router with three routes

After the webhook, add **Flow Control → Router**, then set a filter on each route:

**Route A: Create the event**
- Filter: `status` = `Scheduled` **and** `event_id` does not exist **and** `action` is not `deleted`
- Module: **Google Calendar → Create an event**
  - Calendar: the calendar to fill
  - Event name: `title`
  - Start: `start` · End: `end`
  - Description: `notes`, plus `lead_phone` and `lead_company` if you like
  - Attendees: switch the field to **Map** (the small toggle next to its name) and pick the `attendees` array. That invites whoever the call form says: the lead, the extra guest, both, or nobody.
  - Send updates: **All**, so guests get the invite email
  - Add Google Meet video conferencing: Yes (optional)
- Then add **HTTP → Make a request** to save the event ID (see step 4), with `p_event_id` = the **Event ID** from the Create module.

**Route B: Update the event**
- Filter: `action` = `updated` **and** `event_id` exists **and** `status` is `Scheduled` or `Completed`
- Module: **Google Calendar → Update an event**, Event ID = `event_id`, and the same fields as Route A (name, start, end, description, attendees mapped to `attendees`, Send updates: All). This covers rescheduling, editing the notes or type, and adding or removing guests.

**Route C: Remove the event**
- Filter: `event_id` exists **and** (`action` = `deleted` **or** `status` = `Cancelled`)
- Module: **Google Calendar → Delete an event**, Event ID = `event_id`, Send updates: All (guests get a cancellation email).
- Then **HTTP → Make a request** (step 4) with `p_event_id` left **empty**, so a rebooked call gets a fresh event. Skip this HTTP step when `action` = `deleted` (the call no longer exists).

No-shows keep their event, so the calendar still shows that the slot was booked.

## 4. The "save event ID" request

**HTTP → Make a request**:

- URL: `https://ouxodtabkdratymmveqd.supabase.co/rest/v1/rpc/set_call_event`
- Method: `POST`
- Headers:
  - `apikey`: your publishable key (`sb_publishable_…`, the one in `crm/config.js`)
  - `Authorization`: `Bearer ` + the same publishable key
  - `Content-Type`: `application/json`
- Body type: Raw, JSON:

```json
{ "p_call_id": "{{call_id}}", "p_event_id": "{{event ID}}", "p_token": "PASTE_TOKEN_FROM_STEP_2" }
```

Never use the Supabase **secret** key in Make; the token is all it needs.

## 5. Turn it on

Set the scenario to run **Immediately as data arrives** and switch it **On**. Then in the CRM:

1. Schedule a call → an event appears on Google Calendar.
2. Change its time → the event moves.
3. Mark it Cancelled or delete it → the event disappears.

## Pausing or changing it

```sql
update public.calendar_sync set enabled = false;                 -- pause
update public.calendar_sync set time_zone = 'Asia/Dubai';        -- team works in another time zone
update public.calendar_sync set token = replace(gen_random_uuid()::text, '-', '');  -- new token (update Make too)
```
