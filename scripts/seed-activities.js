import pg from 'pg';
import dotenv from 'dotenv';
import { readFileSync } from 'fs';

dotenv.config();

const DATABASE_URL = process.env.DATABASE_URL;

if (!DATABASE_URL) {
  console.error('Missing DATABASE_URL in .env');
  process.exit(1);
}

function loadActivities() {
  const raw = readFileSync('activities.json', 'utf-8');
  return JSON.parse(raw);
}

async function main() {
  const activities = loadActivities();
  console.log(`Loaded ${activities.length} activities from activities.json\n`);

  const client = new pg.Client({ connectionString: DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected.\n');

    for (const act of activities) {
      const result = await client.query(
        `insert into activities (code, display_name, color, requires_description)
         values ($1, $2, $3, $4)
         on conflict (code) do update
         set display_name = $2, color = $3, requires_description = $4
         returning (xmin = xmax) as inserted`,
        [act.code, act.display_name, act.color, act.requires_description],
      );
      const action = result.rows[0].inserted ? 'Inserted' : 'Updated';
      console.log(`  ${action}: ${act.display_name} (${act.code}) — ${act.color} — desc: ${act.requires_description}`);
    }

    // Deactivate activities not in the JSON file
    const codes = activities.map((a) => a.code);
    const { rowCount } = await client.query(
      `update activities set is_active = false where code not in (${codes.map((_, i) => `$${i + 1}`).join(', ')}) and is_active = true`,
      codes,
    );
    if (rowCount > 0) {
      console.log(`\nDeactivated ${rowCount} activities not in activities.json`);
    }

    console.log(`\nSeeded ${activities.length} activities successfully!`);
  } catch (err) {
    console.error('Seed failed:', err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
