# Activity Tracker System — Codex Implementation Spec

## Objective

Build a personal activity tracking system using:

* Telegram Bot (activity input UI)
* Supabase (single DB + edge functions)
* Local Python script (daily visualization)
* Discord channel (daily timeline delivery)

This document is implementation-complete and should be followed exactly.

---

# Existing Infrastructure

The following already exist and must NOT be recreated:

## Supabase

Supabase project already exists.

Developer will provide:

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=
```

Important:

* Do NOT use legacy anon keys
* Do NOT use legacy service_role keys
* Use publishable + secret only

Use:

* publishable key for safe client operations
* secret key only inside server-side scripts / edge functions

RLS must remain enabled.

---

## Telegram Bot

Telegram bot already exists.

Developer will provide:

```env
TELEGRAM_BOT_TOKEN=
```

Bot should use webhook mode.

---

## Discord

Discord server already exists.

Preferred integration:
Discord webhook.

Developer will provide:

```env
DISCORD_WEBHOOK_URL=
```

Do NOT create a Discord bot unless explicitly requested.

---

# Functional Requirements

---

## Activity Selection UI

When Telegram chat opens or `/start` is called:

Bot must display activity buttons.

Activities (initial set):

* TT
* Gym
* Scrum
* Work Coding
* Personal Coding
* Music
* Conversation

UI must use Telegram inline keyboards.

Example:

```text
Select activity:

[TT] [Gym]
[Scrum] [Work Coding]
[Personal Coding]
[Music]
[Conversation]
```

Activities should come from database, not hardcoded.

---

## Activity Start

When user clicks an activity:

System must:

1. Ensure no active activity exists
2. Create activity session row
3. Timestamp start time
4. Replace UI with STOP button

Rule:
Only one activity can be active at a time.

---

## Activity Stop

When STOP is clicked:

System must:

1. Find active session
2. Set `ended_at = now()`
3. Persist stop timestamp
4. Show activity buttons again

---

## Activities Requiring Description

Some activities need text input.

Initial example:

* conversation

Flow:

User clicks:

```text
Conversation
```

Bot responds:

```text
Send description for conversation
```

User types:

```text
Talked to Rahul about stock market
```

System:

1. Store description
2. Create activity session
3. Timestamp start
4. Show STOP button

This system must be generic.

Activities table includes:

```sql
requires_description boolean
```

Any activity with this set to true follows the description workflow.

---

# Database Schema

Use PostgreSQL inside Supabase.

---

## activities

```sql
create table activities (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    display_name text not null,
    color text not null,
    requires_description boolean default false,
    is_active boolean default true,
    created_at timestamptz default now()
);
```

Seed:

| code            | display_name    | color   | requires_description |
| --------------- | --------------- | ------- | -------------------- |
| tt              | TT              | #FF0000 | false                |
| gym             | Gym             | #00FF00 | false                |
| scrum           | Scrum           | #0000FF | false                |
| work_coding     | Work Coding     | #FFA500 | false                |
| personal_coding | Personal Coding | #00FFFF | false                |
| music           | Music           | #800080 | false                |
| conversation    | Conversation    | #808080 | true                 |

---

## activity_sessions

```sql
create table activity_sessions (
    id uuid primary key default gen_random_uuid(),
    telegram_user_id text not null,
    activity_id uuid references activities(id),
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    description text,
    created_at timestamptz default now()
);
```

Constraint:
Only one active session per user.

```sql
create unique index one_active_session_per_user
on activity_sessions(telegram_user_id)
where ended_at is null;
```

---

## user_state

Tracks temporary state for description input.

```sql
create table user_state (
    telegram_user_id text primary key,
    pending_activity_id uuid references activities(id),
    awaiting_description boolean default false,
    updated_at timestamptz default now()
);
```

---

# RLS

Enable RLS on all tables.

```sql
alter table activities enable row level security;
alter table activity_sessions enable row level security;
alter table user_state enable row level security;
```

Policies:

## activities select

```sql
create policy "read activities"
on activities
for select
using (true);
```

## activity_sessions

```sql
create policy "sessions all"
on activity_sessions
for all
using (true)
with check (true);
```

## user_state

```sql
create policy "state all"
on user_state
for all
using (true)
with check (true);
```

---

# Supabase Setup Script

Need:

```bash
npm install @supabase/supabase-js dotenv
```

Create:

```text
scripts/setup-db.js
```

Responsibilities:

1. Read schema SQL
2. Create tables if absent
3. Seed activities
4. Idempotent

Must be safe to rerun.

---

# Edge Functions

Use Supabase Edge Functions (Deno).

Create:

```text
supabase/functions/
    telegram-webhook/
        index.ts
```

Only one edge function is required.

Responsibilities:

* Receive Telegram webhook payload
* Handle button clicks
* Handle text messages
* Query DB
* Update sessions
* Send Telegram responses

---

# Telegram Flow Logic

---

## /start

1. Fetch active activities
2. Render inline keyboard
3. Send activity selection message

---

## Button Click — Activity Selected

Input:

```text
activity:tt
```

Process:

1. Check active session:

```sql
select * from activity_sessions
where telegram_user_id = ?
and ended_at is null
limit 1;
```

If active session exists:

Return:

```text
Stop current activity first.
```

Else continue.

---

### Activity Requires Description?

Check activity row.

If true:

Insert/update user_state:

```sql
awaiting_description = true
pending_activity_id = activity.id
```

Reply:

```text
Send description.
```

Do NOT create session yet.

---

### Activity Does Not Need Description

Insert:

```sql
insert into activity_sessions (...)
```

Reply:

```text
Current activity: Gym
[STOP]
```

STOP callback:

```text
stop
```

---

## Text Message Handler

When user sends normal text:

Check:

```sql
select * from user_state where telegram_user_id=?
```

If awaiting description:

1. Read description
2. Create activity session with description
3. Clear user_state
4. Show STOP button

Else:

Reply:

```text
Please use activity buttons.
```

---

## STOP Click

Find active session:

```sql
select * from activity_sessions
where telegram_user_id=?
and ended_at is null
```

Update:

```sql
update activity_sessions
set ended_at = now()
```

Then show activities again.

---

# Telegram Utility Module

Create helpers:

```text
sendMessage(chatId, text)
sendActivityKeyboard(chatId)
sendStopKeyboard(chatId, activityName)
```

Use Telegram API:

https://api.telegram.org/bot<TOKEN>/sendMessage

---

# Local Python Script

Create:

```text
python/
    generate_daily_report.py
```

Responsibilities:

1. Fetch all sessions for a day
2. Convert timestamps to minute offsets
3. Draw 24-hour timeline
4. Save PNG
5. Send to Discord

---

# Python Environment

requirements.txt

```txt
supabase
matplotlib
pandas
numpy
requests
python-dotenv
Pillow
```

Install:

```bash
pip install -r requirements.txt
```

---

# Fetch Sessions

Query:

```sql
started_at >= day_start
started_at < day_end
```

Need joined activity colors.

---

# Timeline Rendering

Canvas represents:

```text
00:00 -------------------------------------- 24:00
```

Width recommendation:

* 2400 px
* 100 px per hour

Each session becomes colored segment.

Example:

* Gym = green
* Coding = orange
* Music = purple

Label hours:

0,1,2...24

Render using matplotlib.

Output:

```text
timeline_YYYY_MM_DD.png
```

---

# Discord Delivery

Use webhook.

POST multipart form.

Payload:

Message:

```text
Daily Activity Report - YYYY-MM-DD
```

Attach PNG.

Example using requests:

```python
requests.post(
    webhook_url,
    files={"file": open(path, "rb")}
)
```

---

# Project Structure

```text
activity-tracker/
│
├── package.json
├── requirements.txt
├── .env
│
├── scripts/
│   └── setup-db.js
│
├── supabase/
│   └── functions/
│       └── telegram-webhook/
│           └── index.ts
│
└── python/
    └── generate_daily_report.py
```

---

# package.json

```json
{
  "name": "activity-tracker",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "setup": "node scripts/setup-db.js",
    "serve": "supabase functions serve",
    "deploy": "supabase functions deploy telegram-webhook"
  },
  "dependencies": {
    "@supabase/supabase-js": "^2.53.0",
    "dotenv": "^16.4.5"
  }
}
```

---

# Required .env Template

```env
SUPABASE_URL=
SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=

TELEGRAM_BOT_TOKEN=

DISCORD_WEBHOOK_URL=
```

---

# Deployment Sequence

1. Fill `.env`
2. Run DB setup script
3. Deploy edge function
4. Set Telegram webhook
5. Test activity start/stop
6. Run Python report generator
7. Verify Discord image delivery

---

# Error Handling Requirements

Must handle:

* Duplicate activity starts
* Stop without active session
* Missing description
* Telegram retries
* Supabase failures
* Discord upload failures

Log all errors clearly.

---

# Future Extensibility

Design code for easy addition of:

* Weekly summaries
* AI productivity analysis
* Burnout detection
* Mood/activity correlation
* Activity streaks

Architecture should remain modular.
