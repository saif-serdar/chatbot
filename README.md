# Bitrix24 Lead Assistant Chatbot

An AI-powered assistant for sales agents. Connects to Bitrix24 CRM and ChatApp (WhatsApp) to capture lead conversations in real-time, then lets agents query that history using natural language.

---

## How It Works

- WhatsApp messages arrive via **ChatApp webhooks** → stored + embedded in Qdrant
- Call recordings arrive via **Bitrix24 activity webhooks** → transcribed with Whisper → embedded
- Agents open the chat UI and ask questions like *"What did this lead say about pricing?"*
- Claude AI searches the vector database and returns answers grounded in real conversation history

---

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | Node.js, TypeScript, Express |
| Database | PostgreSQL 16 (via Prisma ORM) |
| Vector DB | Qdrant |
| Object Storage | MinIO (S3-compatible) |
| Cache | Redis |
| AI — Chat | Anthropic Claude (claude-sonnet-4-6) |
| AI — Embeddings | OpenAI text-embedding-3-small |
| AI — Transcription | OpenAI Whisper |
| Frontend | React 18, Vite, Tailwind CSS |
| CRM | Bitrix24 |
| WhatsApp | ChatApp |

---

## Project Structure

```
chatbot/
├── backend/
│   ├── prisma/schema.prisma       # Database schema
│   ├── src/
│   │   ├── config/index.ts        # All env config
│   │   ├── routes/                # Express routes
│   │   ├── services/              # Business logic
│   │   │   ├── chatapp.service.ts     # WhatsApp message processing
│   │   │   ├── webhook.service.ts     # Bitrix24 call recording processing
│   │   │   ├── chat.service.ts        # AI chat with RAG
│   │   │   ├── qdrant.service.ts      # Vector DB operations
│   │   │   └── embedding.service.ts   # Text embedding
│   │   ├── mcp/lead-history-server.ts # MCP server (standalone)
│   │   └── utils/scheduler.ts         # Background cron jobs
│   └── scripts/                   # Setup and registration scripts
├── frontend/
│   └── src/pages/
│       ├── AdminLoginPage.tsx     # Admin login
│       └── AgentMappingPage.tsx   # Agent management panel
├── docker-compose.yml
└── .env
```

---

## Local Development Setup

### Prerequisites

- Node.js 20+
- Docker + Docker Compose
- Anthropic API key
- OpenAI API key

### 1. Start Docker services

```bash
docker compose up -d
```

Starts PostgreSQL (5432), Qdrant (6333), MinIO (9000/9001), Redis (6379).

### 2. Configure environment

All configuration lives in a single file: `backend/.env`

Required values:

```env
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-proj-...
JWT_SECRET=<random 64-char string>
BITRIX24_WEBHOOK_URL=https://crm.yourdomain.com/rest/USER_ID/TOKEN/
CHATAPP_EMAIL=...
CHATAPP_PASSWORD=...
CHATAPP_APP_ID=...
```

### 3. Set up the database

```bash
cd backend
npm install
npx prisma db push
```

### 4. Start backend

```bash
cd backend
npm run dev
# Running on http://localhost:3001
```

### 5. Start frontend

```bash
cd frontend
npm install
npm run dev
# Running on http://localhost:5173
```

### 6. Access points

| Service | URL | Credentials |
|---|---|---|
| Admin panel | http://localhost:5173/admin | See `ADMIN_EMAIL` / `ADMIN_PASSWORD` in .env |
| Backend API | http://localhost:3001 | — |
| Qdrant dashboard | http://localhost:6333/dashboard | — |
| MinIO console | http://localhost:9001 | `admin` / `admin123456` |

---

## Admin Panel

The admin panel (`/admin`) is the only active UI for now.

- **Add Agent** — select a Bitrix24 user from a live dropdown, set a login password
- **Bitrix24 User** column — maps the agent to their Bitrix24 account (dropdown populated from Bitrix24 live)
- **ChatApp Responsible ID** — maps the agent to their ChatApp employee ID
- **Sync User Details** — refreshes name + email from Bitrix24 for all mapped agents
- **Save** — saves mappings and pulls latest name/email from Bitrix24

---

## Webhook Setup

### ChatApp (WhatsApp)

Register the webhook once using the script:

```bash
cd backend
node scripts/register-webhook.js
```

This registers your server URL with ChatApp. Incoming WhatsApp messages will POST to:
```
POST /api/webhooks/chatapp
```

> The webhook URL must be publicly accessible (use ngrok in development).
> Re-register if the ngrok URL changes.

### Bitrix24 Call Recordings

Register the Bitrix24 event handlers:

```bash
cd backend
node scripts/register-bitrix-events.js
```

Registers `OnCrmActivityAdd` and `OnCrmActivityUpdate` events. Call recordings POST to:
```
POST /api/webhooks/bitrix24/activity
```

---

## Background Jobs (Scheduler)

All jobs run automatically when the backend starts. Controlled via `.env`:

| Job | Variable | Default |
|---|---|---|
| Transcription retry (calls) | `ENABLE_TRANSCRIPTION_RETRY` | `false` |
| Transcription retry interval | `TRANSCRIPTION_RETRY_CRON` | `*/15 * * * *` |
| Call lookback window | `CALL_RETRY_LOOKBACK_DAYS` | `7` |
| Voice message lookback | `VOICE_RETRY_LOOKBACK_HOURS` | `24` |
| Session summarization | `ENABLE_SESSION_SUMMARY` | `false` |
| Message cleanup | `ENABLE_MESSAGE_CLEANUP` | `false` |

---

## Data Flow

```
WhatsApp message
    → POST /api/webhooks/chatapp
    → Resolve agent (chatappUserId) + lead (phone/bitrixLeadId)
    → Save to messages table
    → Embed in Qdrant
    → (if voice) Transcribe with Whisper → embed

Bitrix24 call activity
    → POST /api/webhooks/bitrix24/activity
    → Resolve agent (bitrixUserId) + lead (bitrixLeadId)
    → Download audio → Transcribe with Whisper
    → Save to call_recordings + messages tables
    → Embed in Qdrant

Agent asks a question
    → POST /api/chat/message
    → Embed question → Search Qdrant (filtered by agentId + leadId)
    → Pass results as context to Claude
    → Stream response back
```

---

## Security

- Agents can only access their own leads (enforced in DB queries and Qdrant filters)
- Admin panel uses a separate JWT token (24h expiry)
- Passwords hashed with bcrypt
- JWT tokens for agent auth (configurable expiry via `JWT_EXPIRES_IN`)

### Roles

| Role | Access |
|---|---|
| `agent` | Own leads only |
| `admin` / `super_admin` | All agents' data |

To promote an agent to admin:
```sql
UPDATE agents SET role = 'super_admin' WHERE email = 'agent@example.com';
```

---

## Useful Commands

```bash
# View all tables in Prisma Studio
cd backend && npx prisma studio

# Re-push schema changes to DB
cd backend && npx prisma db push

# View Docker service logs
docker compose logs -f backend

# Test a Bitrix24 activity webhook manually
cd backend && node scripts/test-bitrix-activity.js <ACTIVITY_ID>
```
