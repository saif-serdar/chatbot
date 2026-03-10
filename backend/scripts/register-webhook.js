/**
 * ChatApp Webhook Registration Script
 *
 * Registers your server URL with ChatApp so every message
 * automatically POSTs to your webhook endpoint.
 *
 * Run from the backend/ folder:
 *   node scripts/register-webhook.js register https://your-server.com/api/webhooks/chatapp
 *   node scripts/register-webhook.js check
 *   node scripts/register-webhook.js remove
 *
 * Reads credentials from backend/.env (CHATAPP_EMAIL, CHATAPP_PASSWORD, CHATAPP_APP_ID)
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

const BASE_URL    = 'https://api.chatapp.online';
const EMAIL       = process.env.CHATAPP_EMAIL    || '';
const PASSWORD    = process.env.CHATAPP_PASSWORD || '';
const APP_ID      = process.env.CHATAPP_APP_ID   || '';
const WEBHOOK_URL = process.env.CHATAPP_WEBHOOK_URL || '';
let   TOKEN       = process.env.CHATAPP_TOKEN    || '';

// ─── Helpers ──────────────────────────────────────────────────────────────────
async function apiFetch(method, path, body = null) {
  const headers = { 'Content-Type': 'application/json' };
  if (TOKEN) headers['Authorization'] = TOKEN;

  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  return { ok: res.ok, status: res.status, data: json };
}

// ─── Authenticate ─────────────────────────────────────────────────────────────
async function authenticate() {
  if (TOKEN) {
    console.log('✅ Using existing token from .env\n');
    return true;
  }

  console.log(`🔑 Logging in as: ${EMAIL}`);
  const { ok, data } = await apiFetch('POST', '/v1/tokens', {
    email: EMAIL, password: PASSWORD, appId: APP_ID
  });

  if (!ok) {
    console.error('❌ Login failed:', JSON.stringify(data, null, 2));
    return false;
  }

  TOKEN = data?.data?.accessToken || '';
  if (!TOKEN) { console.error('❌ No token in response'); return false; }

  console.log('✅ Authenticated\n');
  return true;
}

// ─── Get license + messenger info ─────────────────────────────────────────────
async function getLicenseInfo() {
  const { ok, data } = await apiFetch('GET', '/v1/licenses');
  if (!ok || !data?.data?.length) {
    console.error('❌ Could not fetch licenses');
    return null;
  }

  const license       = data.data[0];
  const licenseId     = license.licenseId;
  const messengerType = license.messenger?.[0]?.type || 'grWhatsApp';

  console.log(`📋 License: ${licenseId}  |  Messenger: ${messengerType}\n`);
  return { licenseId, messengerType };
}

// ─── Register webhook ─────────────────────────────────────────────────────────
async function registerWebhook(url, licenseId, messengerType) {
  console.log(`📡 Registering webhook...`);
  console.log(`   URL      : ${url}`);
  console.log(`   License  : ${licenseId}`);
  console.log(`   Messenger: ${messengerType}\n`);

  const { ok, status, data } = await apiFetch(
    'PUT',
    `/v1/licenses/${licenseId}/messengers/${messengerType}/callbackUrl`,
    { url, events: ['message'] }
  );

  if (ok) {
    console.log('✅ Webhook registered successfully!');
    console.log(JSON.stringify(data, null, 2));
    console.log('\n💡 ChatApp will now POST every message to:');
    console.log(`   ${url}`);
  } else {
    console.error(`❌ Registration failed (HTTP ${status}):`);
    console.error(JSON.stringify(data, null, 2));
  }
}

// ─── Check current webhook ────────────────────────────────────────────────────
async function checkWebhook() {
  console.log('🔍 Checking registered webhooks...\n');

  const { ok, data } = await apiFetch('GET', '/v1/callbackUrls');
  if (!ok) {
    console.error('❌ Could not fetch callback URLs');
    return;
  }

  const list = data?.data || [];
  if (list.length === 0) {
    console.log('⚠  No webhooks registered yet.');
    console.log('   Run: node scripts/register-webhook.js register https://your-server.com/api/webhooks/chatapp');
  } else {
    console.log('📋 Registered webhooks:');
    console.log(JSON.stringify(list, null, 2));
  }
}

// ─── Remove webhook ───────────────────────────────────────────────────────────
async function removeWebhook(licenseId, messengerType) {
  console.log(`🗑  Removing webhook for ${messengerType} on license ${licenseId}...`);

  const { ok, status, data } = await apiFetch(
    'DELETE',
    `/v1/licenses/${licenseId}/messengers/${messengerType}/callbackUrl`
  );

  if (ok) {
    console.log('✅ Webhook removed.');
  } else {
    console.error(`❌ Failed (HTTP ${status}):`, JSON.stringify(data, null, 2));
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const command = process.argv[2] || 'check';
  const urlArg  = process.argv[3] || WEBHOOK_URL;

  console.log('═'.repeat(50));
  console.log(`  ChatApp Webhook Manager — command: ${command}`);
  console.log('═'.repeat(50) + '\n');

  const authed = await authenticate();
  if (!authed) return;

  const info = await getLicenseInfo();
  if (!info) return;

  const { licenseId, messengerType } = info;

  if (command === 'register') {
    if (!urlArg) {
      console.error('❌ Please provide your webhook URL:');
      console.error('   node scripts/register-webhook.js register https://your-server.com/api/webhooks/chatapp');
      return;
    }
    await registerWebhook(urlArg, licenseId, messengerType);

  } else if (command === 'check') {
    await checkWebhook();

  } else if (command === 'remove') {
    await removeWebhook(licenseId, messengerType);

  } else {
    console.log('Usage:');
    console.log('  node scripts/register-webhook.js register https://your-server.com/api/webhooks/chatapp');
    console.log('  node scripts/register-webhook.js check');
    console.log('  node scripts/register-webhook.js remove');
  }
}

main().catch(err => console.error('💥 Error:', err.message));
