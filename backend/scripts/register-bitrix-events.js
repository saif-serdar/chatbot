/**
 * Bitrix24 Event Handler Registration Script
 *
 * Registers OnCrmActivityAdd + OnCrmActivityUpdate event handlers
 * in Bitrix24 so call recordings are automatically sent to our server.
 *
 * Run from the backend/ folder:
 *   node scripts/register-bitrix-events.js check
 *   node scripts/register-bitrix-events.js register https://your-ngrok.ngrok-free.app/api/webhooks/bitrix24/activity
 *   node scripts/register-bitrix-events.js remove
 *
 * Reads BITRIX24_WEBHOOK_URL from backend/.env
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
    console.warn('⚠  No .env file found in backend/.\n');
  }
}

loadEnv();

const BITRIX_URL = process.env.BITRIX24_WEBHOOK_URL || '';
const EVENTS = ['ONCRMACTIVITYADD', 'ONCRMACTIVITYUPDATE'];

if (!BITRIX_URL) {
  console.error('❌ BITRIX24_WEBHOOK_URL not set in .env');
  process.exit(1);
}

// ─── Bitrix24 REST call ───────────────────────────────────────────────────────
async function bitrixCall(method, params = {}) {
  const url = `${BITRIX_URL.replace(/\/$/, '')}/${method}.json`;
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    body.append(k, String(v));
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const json = await res.json();
  if (json.error) throw new Error(`${json.error}: ${json.error_description}`);
  return json.result;
}

// ─── Commands ─────────────────────────────────────────────────────────────────
async function checkHandlers() {
  console.log('🔍 Checking registered event handlers...\n');
  try {
    const result = await bitrixCall('event.get');
    const handlers = Array.isArray(result) ? result : [];
    if (handlers.length === 0) {
      console.log('⚠  No event handlers registered.');
    } else {
      console.log(`📋 Found ${handlers.length} handler(s):\n`);
      handlers.forEach(h => {
        const relevant = EVENTS.includes(h.event?.toUpperCase()) ? ' ← (activity handler)' : '';
        console.log(`  Event   : ${h.event}${relevant}`);
        console.log(`  Handler : ${h.handler}`);
        console.log(`  Auth    : ${h.auth_type}`);
        console.log();
      });
    }
  } catch (err) {
    console.error('❌ Failed to get handlers:', err.message);
  }
}

async function registerHandlers(handlerUrl) {
  console.log(`📡 Registering event handlers → ${handlerUrl}\n`);
  for (const event of EVENTS) {
    try {
      await bitrixCall('event.bind', { event, handler: handlerUrl, auth_type: 0 });
      console.log(`✅ Registered: ${event}`);
    } catch (err) {
      // Already bound = not necessarily an error
      if (err.message.includes('already')) {
        console.log(`⚠  ${event}: already registered (will update)`);
        try {
          await bitrixCall('event.unbind', { event, handler: handlerUrl });
          await bitrixCall('event.bind', { event, handler: handlerUrl, auth_type: 0 });
          console.log(`✅ Re-registered: ${event}`);
        } catch (e2) {
          console.error(`❌ Failed to re-register ${event}:`, e2.message);
        }
      } else {
        console.error(`❌ Failed to register ${event}:`, err.message);
      }
    }
  }
  console.log('\n💡 Bitrix24 will now POST activity events to:');
  console.log(`   ${handlerUrl}`);
}

async function removeHandlers(handlerUrl) {
  console.log(`🗑  Removing event handlers for ${handlerUrl || 'ALL'}\n`);
  for (const event of EVENTS) {
    try {
      const params = { event };
      if (handlerUrl) params.handler = handlerUrl;
      await bitrixCall('event.unbind', params);
      console.log(`✅ Removed: ${event}`);
    } catch (err) {
      console.warn(`⚠  ${event}: ${err.message}`);
    }
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const command = process.argv[2] || 'check';
  const urlArg  = process.argv[3] || '';

  console.log('═'.repeat(55));
  console.log(`  Bitrix24 Event Handler Manager — command: ${command}`);
  console.log('═'.repeat(55) + '\n');
  console.log(`  Bitrix24 URL: ${BITRIX_URL}\n`);

  if (command === 'check') {
    await checkHandlers();

  } else if (command === 'register') {
    if (!urlArg) {
      console.error('❌ Please provide your webhook URL:');
      console.error('   node scripts/register-bitrix-events.js register https://your-ngrok.ngrok-free.app/api/webhooks/bitrix24/activity');
      return;
    }
    await registerHandlers(urlArg);

  } else if (command === 'remove') {
    await removeHandlers(urlArg);

  } else {
    console.log('Usage:');
    console.log('  node scripts/register-bitrix-events.js check');
    console.log('  node scripts/register-bitrix-events.js register https://your-ngrok.app/api/webhooks/bitrix24/activity');
    console.log('  node scripts/register-bitrix-events.js remove [optional-url-to-match]');
  }
}

main().catch(err => console.error('💥 Error:', err.message));
