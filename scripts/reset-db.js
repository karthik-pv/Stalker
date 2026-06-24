import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

const RESET_SQL = `
-- Drop all tables and policies (order matters for FK constraints)
drop table if exists activity_sessions cascade;
drop table if exists user_state cascade;
drop table if exists activities cascade;

-- Recreate tables
create table activities (
    id uuid primary key default gen_random_uuid(),
    code text unique not null,
    display_name text not null,
    color text not null,
    requires_description boolean default false,
    is_active boolean default true,
    created_at timestamptz default now()
);

create table activity_sessions (
    id uuid primary key default gen_random_uuid(),
    telegram_user_id text not null,
    activity_id uuid references activities(id),
    started_at timestamptz not null default now(),
    ended_at timestamptz,
    description text,
    created_at timestamptz default now()
);

create table user_state (
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

-- Unique index: only one active session per user
create unique index one_active_session_per_user
on activity_sessions(telegram_user_id)
where ended_at is null;

-- Enable RLS
alter table activities enable row level security;
alter table activity_sessions enable row level security;
alter table user_state enable row level security;

-- RLS policies
create policy "read activities" on activities for select using (true);
create policy "sessions all" on activity_sessions for all using (true) with check (true);
create policy "state all" on user_state for all using (true) with check (true);
`;

async function main() {
  console.log('Connecting to database...');
  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected.\n');

    console.log('Dropping all tables and recreating schema...');
    await client.query(RESET_SQL);
    console.log('Schema recreated.\n');

    // Verify
    const { rows: tables } = await client.query(
      "select tablename from pg_tables where schemaname = 'public' order by tablename",
    );
    console.log(`Tables: ${tables.map((t) => t.tablename).join(', ')}`);

    console.log('\nDatabase reset complete!');
    console.log('Next: run "npm run seed-activities" to seed activities from activities.json');
  } catch (err) {
    console.error('Reset failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
