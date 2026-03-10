/**
 * Bitrix24 Activity Webhook Test Script
 *
 * Simulates a Bitrix24 ONCRMACTIVITYADD webhook POST to your local server.
 * Use this to test the call recording pipeline without waiting for a real call.
 *
 * Usage (run from backend/ folder):
 *   node scripts/test-bitrix-activity.js <activityId> [add|update]
 *
 * Examples:
 *   node scripts/test-bitrix-activity.js 123          # test ADD event
 *   node scripts/test-bitrix-activity.js 123 update   # test UPDATE event
 *
 * The script POSTs the same payload structure that Bitrix24 sends to your server.
 * Your server then fetches the full activity from Bitrix24 using crm.activity.get.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load backend/.env ────────────────────────────────────────────────────────
function loadEnv() {
  try {
    const envFile = readFileSync(join(__dirname, '..', '.env'), 'utf-8');
    envFile.split('\n').forEach(line => {
      line = line.trim();
      if (!line || line.startsWith('#')) return;
      const [key, ...rest] = line.split('=');
      if (key) process.env[key.trim()] = rest.join('=').trim();
    });
  } catch {
    console.warn('⚠  No .env file found.\n');
  }
}

loadEnv();

const PORT        = process.env.PORT || 3001;
const SERVER_URL  = `http://localhost:${PORT}`;
const ENDPOINT    = `${SERVER_URL}/api/webhooks/bitrix24/activity`;

const activityId  = process.argv[2];
const eventSuffix = (process.argv[3] || 'add').toLowerCase() === 'update' ? 'UPDATE' : 'ADD';
const eventName   = `ONCRMACTIVITY${eventSuffix}`;

if (!activityId) {
  console.error('❌ Please provide an activity ID:');
  console.error('   node scripts/test-bitrix-activity.js <activityId> [add|update]');
  console.error('\nTo find a real activity ID, go to Bitrix24 CRM > Leads > open a lead > Activities.');
  process.exit(1);
}

// ─── Simulate Bitrix24 event payload (form-encoded, same as real webhook) ─────
async function sendTestPayload() {
  console.log('═'.repeat(55));
  console.log('  Bitrix24 Activity Webhook — Test');
  console.log('═'.repeat(55));
  console.log(`\n  Activity ID : ${activityId}`);
  console.log(`  Event       : ${eventName}`);
  console.log(`  Endpoint    : ${ENDPOINT}\n`);

  // Bitrix24 sends form-encoded data
  const body = new URLSearchParams({
    event:             eventName,
    'data[FIELDS][ID]': activityId,
    'auth[domain]':    process.env.BITRIX24_DOMAIN || 'crm.example.com',
    'auth[member_id]': 'test',
    'auth[application_token]': process.env.BITRIX24_WEBHOOK_TOKEN || '',
  });

  try {
    console.log('📤 Sending payload to local server...\n');
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const text = await res.text();
    let json;
    try { json = JSON.parse(text); } catch { json = { raw: text }; }

    if (res.ok) {
      console.log(`✅ Server responded ${res.status}:`);
      console.log(JSON.stringify(json, null, 2));
      console.log('\n💡 Check your server logs for processing details.');
      console.log('   The server fetches the activity from Bitrix24 asynchronously.');
      console.log('   Wait a few seconds, then check the DB:\n');
      console.log('   SELECT * FROM call_recordings ORDER BY created_at DESC LIMIT 5;');
      console.log('   SELECT * FROM webhook_logs ORDER BY created_at DESC LIMIT 5;');
    } else {
      console.error(`❌ Server responded ${res.status}:`);
      console.error(JSON.stringify(json, null, 2));
    }
  } catch (err) {
    if (err.cause?.code === 'ECONNREFUSED') {
      console.error(`❌ Cannot connect to ${SERVER_URL}`);
      console.error('   Make sure your backend server is running:');
      console.error('   npm run dev   (from backend/ folder)');
    } else {
      console.error('❌ Request failed:', err.message);
    }
  }
}

sendTestPayload();
