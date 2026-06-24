import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const SCHEMA_SQL = `
-- activities table
create table if not exists activities (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    display_name text not null,
    color text not null,
    requires_description boolean default false,
    is_active boolean default true,
    created_at timestamptz default now()
);

-- activity_sessions table
create table if not exists activity_sessions (
    id uuid primary key default gen_random_uuid(),
    telegram_user_id text not null,
    activity_id uuid references activities(id),
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    description text,
    created_at timestamptz default now()
);

-- user_state table
create table if not exists user_state (
    telegram_user_id text primary key,
    pending_activity_id uuid references activities(id),
    awaiting_description boolean default false,
    repair_mode boolean default false,
    repair_step text,
    repair_hour int,
    repair_minute int,
    repair_description text,
    updated_at timestamptz default now()
);

-- add repair columns if table already exists (for upgrades)
alter table user_state add column if not exists repair_mode boolean default false;
alter table user_state add column if not exists repair_step text;
alter table user_state add column if not exists repair_hour int;
alter table user_state add column if not exists repair_minute int;
alter table user_state add column if not exists repair_description text;

-- unique index: only one active session per user
create unique index if not exists one_active_session_per_user
on activity_sessions(telegram_user_id)
where ended_at is null;

-- enable RLS
alter table activities enable row level security;
alter table activity_sessions enable row level security;
alter table user_state enable row level security;

-- RLS policies (drop if exists then recreate for idempotency)
drop policy if exists "read activities" on activities;
create policy "read activities"
on activities
for select
using (true);

drop policy if exists "sessions all" on activity_sessions;
create policy "sessions all"
on activity_sessions
for all
using (true)
with check (true);

drop policy if exists "state all" on user_state;
create policy "state all"
on user_state
for all
using (true)
with check (true);
`;

const SEED_SQL = `
insert into activities (code, display_name, color, requires_description) values
  ('tt', 'TT', '#FF0000', false),
  ('gym', 'Gym', '#00FF00', false),
  ('scrum', 'Scrum', '#0000FF', false),
  ('work_coding', 'Work Coding', '#FFA500', false),
  ('personal_coding', 'Personal Coding', '#00FFFF', false),
  ('music', 'Music', '#800080', false),
  ('conversation', 'Conversation', '#808080', true)
on conflict (code) do nothing;
`;

async function main() {
  console.log('Connecting to database...');
  console.log(`  DATABASE_URL: ${DATABASE_URL.replace(/:[^:@]+@/, ':****@')}`);

  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected.\n');

    console.log('Running schema setup...');
    await client.query(SCHEMA_SQL);
    console.log('Schema setup complete.\n');

    console.log('Seeding activities...');
    const seedResult = await client.query(SEED_SQL);
    console.log(`Seeded ${seedResult.rowCount} activities.\n`);

    // Verify
    const { rows } = await client.query('select code, display_name, color, requires_description from activities order by display_name');
    console.log('Current activities:');
    for (const row of rows) {
      console.log(`  ${row.display_name} (${row.code}) — ${row.color} — requires_description: ${row.requires_description}`);
    }

    console.log('\nSetup complete!');
    console.log('Next steps:');
    console.log('  1. Deploy edge function:  npm run deploy');
    console.log('  2. Set Telegram webhook:  npm run set-webhook');
  } catch (err) {
    console.error('Setup failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
