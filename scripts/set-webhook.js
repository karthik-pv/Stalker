import dotenv from 'dotenv';

dotenv.config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;

if (!TELEGRAM_BOT_TOKEN) {
  console.error('Missing TELEGRAM_BOT_TOKEN in .env');
  process.exit(1);
}

if (!SUPABASE_URL) {
  console.error('Missing SUPABASE_URL in .env');
  process.exit(1);
}

// The edge function URL — adjust if your project uses a different path
const WEBHOOK_URL = `${SUPABASE_URL}/functions/v1/telegram-webhook`;

async function main() {
  console.log(`Setting Telegram webhook to: ${WEBHOOK_URL}`);

  const res = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: WEBHOOK_URL }),
    },
  );

  const data = await res.json();

  if (data.ok) {
    console.log('Webhook set successfully!');
    console.log(`  URL: ${WEBHOOK_URL}`);
  } else {
    console.error('Failed to set webhook:', data.description);
    process.exit(1);
  }

  // Verify
  const infoRes = await fetch(
    `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`,
  );
  const info = await infoRes.json();
  if (info.ok) {
    console.log('Current webhook info:');
    console.log(`  URL: ${info.result.url}`);
    console.log(`  Pending updates: ${info.result.pending_update_count}`);
    if (info.result.last_error_message) {
      console.log(`  Last error: ${info.result.last_error_message}`);
    }
  }
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
