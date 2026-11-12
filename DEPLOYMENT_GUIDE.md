# دليل الرفع والنشر السحابي — Deployment Guide

GDG Evaluation Platform runs as **three services and one database**:

| # | Service | Folder | Tech | Suggested host | Health check |
|---|---------|--------|------|----------------|--------------|
| 0 | Database | `02-Backend/db` | PostgreSQL 14+ | Supabase / Neon / Railway | `SELECT 1` |
| 1 | Backend API | `02-Backend` | Node.js 24, Express 5, TypeScript | Render / Railway | `GET /api/health`, `GET /api/ready` |
| 2 | AI chatbot | `03-AI/Anas_Musleh` | Python 3.13, FastAPI, Gemini | Render / Railway | `GET /health` |
| 3 | Frontend | `01-Frontend` | React 19 + Vite, Clerk | Vercel | open the site |

```
Browser ──► Frontend (Vercel) ──► Backend /api (Render) ──► PostgreSQL
                                        │  ▲
                        POST /chat      ▼  │  GET /api/assistant/data/*
                                  AI chatbot (Render) ──► Gemini API
```

The browser **never** talks to the chatbot directly. The backend forwards `/api/assistant` to it with a shared secret (`CHATBOT_INTERNAL_KEY`), and the chatbot reads platform data back through the backend using the signed-in user's token.

**Deploy in this order:** Database → Backend → AI chatbot → Frontend → update the backend's `CORS_ORIGINS` and `CHATBOT_URL` → smoke checks.

> **Secrets.** Never commit a real `.env`. Each folder has a `.env.example` with every variable and a comment; copy the names into the host's environment-variable settings. The Clerk secret key, the database password, `CHATBOT_INTERNAL_KEY` and `GEMINI_API_KEY` are server-only.

---

## Before you start: accounts and keys

1. **Clerk** (sign-in). Create a production instance in the Clerk dashboard, then:
   - Copy the **publishable key** (`pk_live_...`) and the **secret key** (`sk_live_...`).
   - Add the frontend's production domain under *Domains*.
   - Enable email sign-up with **email verification**. The backend links accounts only through a *verified* email.
2. **Gemini.** Create an API key in Google AI Studio. The free tier has a small daily quota, so enable billing on the key for real use.
3. **Shared chatbot secret.** Generate it once and keep it in a password manager:
   ```bash
   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
   ```

---

## 0. PostgreSQL database

### 0.1 Create the database

| Provider | What to do | Connection to use |
|----------|------------|-------------------|
| **Supabase** | New project → *Project Settings → Database* | The **direct connection** (port 5432) or the **session-mode** pooler. **Do not** use the transaction-mode pooler (port 6543), because the backend uses session-level advisory locks and per-connection timezone settings. |
| **Neon** | New project → *Connection details* | The **direct** (non-pooled) connection string, without `-pooler` in the host. |
| **Railway** | *New → Database → PostgreSQL* | Use the *public* URL from your laptop when running migrations. If the backend is also on Railway, it can use the private host and doesn't need `PGSSLMODE`. |

You will get a connection string like this:

```
postgresql://USER:PASSWORD@HOST:PORT/DBNAME
```

**The backend does not read `DATABASE_URL`.** Split the string into the five variables it uses: `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER` and `DB_PASSWORD`. Hosted providers also require TLS, so set `PGSSLMODE=require` (see §1).

### 0.2 Run the schema and migrations (exact order)

You need `psql` (PostgreSQL client 14+) on your machine. Run it from the `02-Backend` folder against the **new, empty** database:

```bash
cd 02-Backend
psql "postgresql://USER:PASSWORD@HOST:PORT/DBNAME?sslmode=require" -v ON_ERROR_STOP=1 -f db/setup-new-database.sql
```

`db/setup-new-database.sql` runs these files in order and stops at the first error:

| Order | File | What it does |
|------:|------|--------------|
| 001 | `db/GDG_evaluation_database.final.postgresql.sql` | Base schema. Creates the campuses **Jenin** and **Ramallah**. |
| 002 | `db/migrations/002_user_invitations.sql` | Invitation columns on `users` |
| 003 | `db/migrations/003_user_soft_delete.sql` | Soft delete |
| 004 | `db/migrations/004_final_backend_schema.sql` | Final backend schema |
| 005 | `db/migrations/005_manager_evaluation_four_criteria.sql` | Manager evaluation with four criteria |
| 006 | `db/migrations/006_asia_hebron_timestamps.sql` | Asia/Hebron month boundaries |
| 007 | `db/migrations/007_snapshot_rows_per_team_and_campus.sql` | Monthly ranking snapshots |
| 008 | `db/migrations/008_enable_remaining_modules.sql` | Remaining modules |
| 009 | `db/migrations/009_registration_approval_flow.sql` | Self-registration with organizer approval |
| 010 | `db/migrations/010_points_spec_alignment.sql` | Points: `-100..100`, nonzero; idempotency keys; global board disabled |

Rules:
- **Run this only on an empty database.** The base schema and 002 are not repeatable. For an existing database, apply only the migration files that haven't run yet, in numeric order, with the same `psql ... -v ON_ERROR_STOP=1 -f db/migrations/0XX_....sql`.
- **Back up before migrating a database that has data:**
  ```bash
  pg_dump "postgresql://..." -Fc -f db-backups/gdg_evaluation-before-0XX-YYYYMMDD-HHMMSS.dump
  ```

Check that it worked:

```sql
SELECT campus_id, campus_name FROM campuses ORDER BY campus_id;         -- 1 Jenin, 2 Ramallah
SELECT to_regclass('point_idempotency_keys'), to_regclass('registration_requests');  -- both non-null
```

### 0.3 Create the first Organizer (bootstrap)

The app has no default admin. Sign-in goes through Clerk, and the backend matches the Clerk user to a `users` row by Clerk ID or by **verified email**. Once the first organizer exists, every other account is created or approved from the app (**الأعضاء** / **طلبات الانضمام**).

**Option A (recommended): the person has NOT signed up yet.**

1. Insert the organizer row by email, using the email they will sign up with:
   ```sql
   INSERT INTO users (full_name, email, role, team_id, invitation_status)
   VALUES ('Organizer Full Name', 'organizer@example.com', 'Organizer', NULL, 'pending');
   ```
2. The person opens the deployed site, signs up with **exactly that email**, and verifies it.
3. On first sign-in the backend links the Clerk account automatically. This writes the audit entry `link_clerk_account_by_email` and sets `invitation_status` to `accepted`.

**Option B: the person already signed up and sees "waiting for organizer approval".**

Their sign-up was recorded in `registration_requests`. Promote it in one transaction:

```sql
BEGIN;
WITH r AS (
  SELECT request_id, clerk_user_id, email, full_name
  FROM registration_requests
  WHERE LOWER(email) = LOWER('organizer@example.com') AND registration_status = 'pending'
), u AS (
  INSERT INTO users (clerk_user_id, full_name, email, role, team_id, invitation_status)
  SELECT clerk_user_id, full_name, email, 'Organizer', NULL, 'accepted' FROM r
  RETURNING user_id
)
UPDATE registration_requests
SET registration_status = 'approved', decided_at = now(), approved_user_id = (SELECT user_id FROM u)
WHERE request_id = (SELECT request_id FROM r);
COMMIT;
```

The person then reloads the site and gets the Organizer menu.

Check it:

```sql
SELECT user_id, full_name, email, role, is_active, clerk_user_id IS NOT NULL AS linked
FROM users WHERE role = 'Organizer';
```

> Create **at least two** organizers. The app refuses to demote or deactivate the last active organizer, and an organizer can never demote, deactivate or delete themselves (`SELF_LOCKOUT`). A second organizer is the recovery path.

---

## 1. Backend API (`02-Backend`) on Render or Railway

### 1.1 Service settings

| Setting | Value |
|---------|-------|
| Root directory | `02-Backend` |
| Runtime | Node **24** (Render: env `NODE_VERSION=24`; Railway: Nixpacks reads `.nvmrc` or `engines`, or set `NIXPACKS_NODE_VERSION=24`) |
| Build command | `npm ci --include=dev && npm run build` |
| Start command | `node src/server.js` |
| Health check path | `/api/health` |
| Instance | Always-on is recommended. A free instance that sleeps makes the first request slow. |

Why these commands:
- **TypeScript is a dev dependency.** With `NODE_ENV=production`, a plain `npm ci` skips it and `npm run build` (`tsc`) fails. `--include=dev` keeps it.
- **`npm start` rebuilds first** (`prestart`). Starting with `node src/server.js` skips that rebuild and uses the `dist/` output from the build step.
- **The server checks the database before listening.** If PostgreSQL is unreachable, it logs `Database connection failed: ...` and exits, so a crash loop on boot almost always means wrong `DB_*` values or TLS settings.

### 1.2 Environment variables

| Variable | Required | Example / notes |
|----------|:--------:|-----------------|
| `NODE_ENV` | ✅ | `production`. This turns on Clerk's strict clock check and quiet auth logs. |
| `PORT` | auto | Injected by Render and Railway. The local default is 3001. |
| `DB_HOST` | ✅ | e.g. `db.xxxx.supabase.co` or `ep-xxx.eu-central-1.aws.neon.tech` |
| `DB_PORT` | ✅ | `5432` |
| `DB_NAME` | ✅ | `postgres` (Supabase), `neondb` (Neon), … |
| `DB_USER` | ✅ | from the connection string |
| `DB_PASSWORD` | ✅ | secret |
| `PGSSLMODE` | ✅ hosted DB | `require`. Use `no-verify` only if the provider's certificate chain is rejected. Leave unset for a local database or Railway's private network. |
| `CLERK_PUBLISHABLE_KEY` | ✅ | `pk_live_...` (the same key as the frontend) |
| `CLERK_SECRET_KEY` | ✅ | `sk_live_...`, secret |
| `CLERK_INVITATION_REDIRECT_URL` | ✅ | `https://<frontend-domain>/`, where invited users land |
| `CORS_ORIGINS` | ✅ | `https://<frontend-domain>`. Comma-separated, no path, no trailing slash. Add the Vercel preview domain only if testers use it. |
| `CHATBOT_URL` | ✅ | `https://<ai-service-domain>` (no trailing slash). This is the "AI service URL". |
| `CHATBOT_INTERNAL_KEY` | ✅ | The shared secret. It must equal the chatbot's value. |
| `CHATBOT_TIMEOUT_MS` | optional | `30000`. Keep it above the chatbot's `CHAT_DEADLINE_S` (25 s). |
| `CLERK_CLOCK_SKEW_MS` | optional | Leave unset in production (the default is 5000). |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `FROM_EMAIL` | optional | Approve/reject emails for registrations. If `SMTP_HOST` is empty, emails are skipped and decisions still work. |

**CORS.** The backend allows only the origins in `CORS_ORIGINS`. It already allows the request headers `Authorization`, `Content-Type`, `Accept` and `Idempotency-Key`, and exposes `Retry-After` and `Idempotent-Replayed`. If the frontend shows *Network error* when adding points, check `CORS_ORIGINS` first: it must match the browser's address bar origin **exactly** (scheme + host, no trailing `/`).

### 1.3 Verify

```bash
curl -s https://<backend-domain>/api/health
# {"status":"ok","message":"GDG Backend is running"}

curl -s https://<backend-domain>/api/ready
# 200 when PostgreSQL answers; 503 when it does not

curl -s -o /dev/null -w "%{http_code}\n" https://<backend-domain>/api/users
# 401 (authentication required) = Clerk middleware active

curl -s -i -X OPTIONS https://<backend-domain>/api/points \
  -H "Origin: https://<frontend-domain>" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: authorization,content-type,idempotency-key" | grep -i "access-control"
# access-control-allow-origin: https://<frontend-domain>
# access-control-allow-headers: Authorization,Content-Type,Accept,Idempotency-Key
```

The logs should show `PostgreSQL connected successfully` and `GDG Backend is running on port ...`.

---

## 2. AI chatbot (`03-AI/Anas_Musleh`) on Render or Railway

### 2.1 Service settings

| Setting | Value |
|---------|-------|
| Root directory | `03-AI/Anas_Musleh` |
| Python version | **3.13** (Render: env `PYTHON_VERSION=3.13.0` or newer 3.13.x; Railway: env `NIXPACKS_PYTHON_VERSION=3.13`) |
| Build / install command | `pip install -r requirements.txt` |
| Start command | `uvicorn app.server:app --host 0.0.0.0 --port $PORT` |
| Health check path | `/health` |
| Instance | Always-on is recommended. A free instance that sleeps can make the first question time out after 30 s. |

At startup the service checks the Gemini key and model and logs a clear message if either is rejected. `/health` still answers in that case and reports the problem in its `ai` field.

### 2.2 Environment variables

| Variable | Required | Example / notes |
|----------|:--------:|-----------------|
| `BACKEND_MODE` | ✅ | `real`. The HTTP service refuses to run in `mock`. |
| `BACKEND_URL` | ✅ | `https://<backend-domain>`, **without** `/api` |
| `CHATBOT_INTERNAL_KEY` | ✅ | Same value as the backend's |
| `GEMINI_API_KEY` | ✅ | secret |
| `GEMINI_MODEL` | optional | Default `gemini-3.8-flash`. It must be a model your key can call. |
| `GEMINI_FALLBACK_MODELS` | optional | Comma-separated models tried when the main one is busy or rate-limited |
| `GEMINI_TIMEOUT_MS` | optional | `12000`, the limit for one model call |
| `CHAT_DEADLINE_S` | optional | `25`, the total budget for one question. Keep it below the backend's `CHATBOT_TIMEOUT_MS`. |
| `GEMINI_THINKING_LEVEL`, `GEMINI_MAX_OUTPUT_TOKENS`, `GEMINI_TEMPERATURE`, `LLM_RETRIES`, `MAX_TOOL_ROUNDS` | optional | Defaults are in `.env.example` |

Network: the chatbot's URL can be public. `/chat` rejects calls without the internal key. Railway's private networking also works: set the backend's `CHATBOT_URL` to the private address.

### 2.3 Verify

```bash
curl -s https://<ai-service-domain>/health
# {"status":"ok","models":[...],"ai":{"ok":true,"code":null,"model":"..."}}
```

- `ai.ok: false` → read `ai.code`:
  - `AI_KEY_INVALID`: wrong key
  - `AI_MODEL_UNAVAILABLE`: the key can't use that model
  - `AI_QUOTA_EXCEEDED`: the daily quota is used up
- After the frontend is up, ask the assistant a question while signed in. If the backend answers `503 ASSISTANT_UNAVAILABLE` with `CHATBOT_NOT_CONFIGURED`, the backend's `CHATBOT_URL` or key is wrong.
- **Quick answers** (how-to questions, "my points", "my team's points this month") don't call Gemini, so they work even when the quota is used up.

---

## 3. Frontend (`01-Frontend`) on Vercel

### 3.1 Project settings

| Setting | Value |
|---------|-------|
| Root directory | `01-Frontend` |
| Framework preset | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node.js version | 22.x or newer (`engines: >=22`) |

Routing uses the URL hash (`/#/leaderboard`), so **no rewrite rules or `vercel.json` are needed**. Refreshing any page works.

### 3.2 Environment variables (Production, and Preview if testers use it)

| Variable | Required | Value |
|----------|:--------:|-------|
| `VITE_USE_MOCK` | ✅ | **`false`**. If it is missing or `true`, the site runs on built-in demo data and never calls the backend. |
| `VITE_API_URL` | ✅ | `https://<backend-domain>/api`. Keep `/api`, no trailing slash. |
| `VITE_CLERK_PUBLISHABLE_KEY` | ✅ | `pk_live_...`. Public, but **never** the `sk_...` key. |

Vite bakes these values in **at build time**. After changing any of them, click **Redeploy**.

### 3.3 Post-deploy wiring

1. Set the backend's `CORS_ORIGINS` to the final Vercel domain, e.g. `https://gdg-eval.vercel.app`, and redeploy the backend.
2. Set the backend's `CLERK_INVITATION_REDIRECT_URL` to `https://<frontend-domain>/`.
3. In Clerk, add the Vercel domain under *Domains* and confirm the allowed redirect URLs.

### 3.4 Smoke checks (10 minutes)

| # | Check | Expected |
|---|-------|----------|
| 1 | Open the site, then DevTools → Console and Network | No red errors, no CORS errors |
| 2 | Network tab: requests go to `https://<backend-domain>/api/...` | Not `localhost`, and no demo data (demo names would mean `VITE_USE_MOCK` isn't `false`) |
| 3 | Sign in as the bootstrap Organizer | The Organizer menu appears: **نظرة عامة، الأعضاء، إضافة نقاط، تقييم المدراء، الأرشيف الشهري، سجل التدقيق …** |
| 4 | **الحرمان والفرق** (campuses and teams) | Jenin and Ramallah are listed |
| 5 | Create a team, invite or approve a Member, and add points (+5) | 201 Created; it shows in **سجل النقاط** and in **سجل التدقيق** |
| 6 | **الترتيب** (leaderboard) | Separate boards for Jenin and Ramallah, no global board |
| 7 | **المساعد** (assistant): ask «كم نقاطي هذا الشهر؟» ("How many points do I have this month?") | An answer within a few seconds |
| 8 | Mobile width (DevTools device mode, 375 px) | Arabic RTL layout and the bottom navigation bar |

Full role-by-role tests are in [`QA_TESTING_CHECKLIST.md`](QA_TESTING_CHECKLIST.md).

---

## 4. Troubleshooting

| Symptom | Likely cause → fix |
|---------|--------------------|
| Backend restarts in a loop, log says `Database connection failed` | Wrong `DB_*` values, `PGSSLMODE` missing for a hosted DB, or a transaction pooler → use the direct or session connection |
| `self-signed certificate in certificate chain` | `PGSSLMODE=no-verify` |
| Build fails: `tsc: not found` | The build command needs `npm ci --include=dev` |
| Browser shows *Network error* or a CORS error | `CORS_ORIGINS` doesn't match the site origin exactly (check for a trailing slash or http vs https) → fix and redeploy the backend |
| Every API call returns 401 `INVALID_TOKEN` | Clerk keys from different instances (test vs live) on the frontend and backend, or the server clock is off |
| Signed in but "waiting for organizer approval" | Expected for new sign-ups → approve them in **طلبات الانضمام**. For the very first organizer, see §0.3 option B. |
| Site shows demo data | `VITE_USE_MOCK` isn't `false` → set it and redeploy |
| Assistant: `ASSISTANT_TIMEOUT` (504) | The chatbot was sleeping (free tier) or Gemini was slow → use an always-on instance and keep `CHAT_DEADLINE_S` < `CHATBOT_TIMEOUT_MS` |
| Assistant: «وصل المساعد إلى حد الاستخدام اليومي» ("the assistant reached its daily usage limit") | The Gemini daily quota is used up → enable billing on the key. Quick answers still work. |
| Assistant: `CHATBOT_NOT_CONFIGURED` | `CHATBOT_URL` or `CHATBOT_INTERNAL_KEY` is missing on the backend |

## 5. Operations

- **Timezone.** All month boundaries are Asia/Hebron. The backend sets it per connection, so the database server's timezone doesn't matter.
- **Backups.** Turn on the provider's daily backups, and take a manual `pg_dump -Fc` before every migration.
- **Month close.** An Organizer closes a month from **الأرشيف الشهري**. Corrections to a closed month go through the corrections flow and are audited.
- **Logs.** The backend writes to stdout and to the in-app **سجل النظام**. The chatbot writes to stdout.
