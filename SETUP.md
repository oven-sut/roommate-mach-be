# Setup Guide (SCRUM-171)

Getting a new team member from clone to running tests locally.

## Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for PostgreSQL + MinIO)
- On **Windows**: Docker Desktop with the WSL2 backend

## 1. Install dependencies

```bash
npm install
```

## 2. Configure environment

```bash
cp .env.example .env
```

Fill in / check these values:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | PostgreSQL connection string, must match `docker-compose.yml` |
| `JWT_SECRET` | Long random secret for signing auth tokens. In production it must be 32+ characters and not the example value, or the app refuses to boot |
| `ADMIN_EMAIL` | Email that gets auto-promoted to `ADMIN` role on login |
| `ALLOWED_EMAIL_DOMAINS` | Domains accounts may register from. An admin can change this later from the app; this is only the seed value |
| `GOOGLE_CLIENT_IDS` | OAuth client IDs for `/auth/google` (comma-separated) |
| `NODE_ENV` | `development` locally; must be `production` in prod |
| `ALLOW_DEV_OTP` | `true` locally — accepts OTP `123456` and echoes otp/resetToken in responses so you can test without a real mailbox. **Must be unset/`false` in production** — the app refuses to boot if `NODE_ENV=production` and this is `true` |
| `RESEND_API_KEY` / `RESEND_FROM` | Optional. Without it, OTPs are just logged to the console instead of emailed |
| `CORS_ORIGINS` | Production only: browser origins allowed to call the API. Native builds send no `Origin`, so they work without it |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_*_KEY` / `MINIO_BUCKET_NAME` | MinIO object storage for avatars/photos/verification docs |

### Windows gotcha: excluded port ranges

Windows/Hyper-V periodically reserves TCP port ranges for itself (check with
`netsh interface ipv4 show excludedportrange protocol=tcp`). Common dev ports fall inside these
ranges more often than you'd expect — port 9000 (MinIO's default) and 8888 (this API's old
default) have both hit it here. Docker fails to publish the port (or silently doesn't) and NestJS
fails to bind with `EACCES: permission denied`. This repo's `.env(.example)` and
`docker-compose.yml` already dodge it — MinIO on host port **19000**, the API on **18888** — but
if you hit either error again: run the `netsh` command above, pick a port outside every excluded
range, and update `PORT` in `.env` (API) or `docker-compose.yml`'s `minio` service `ports:` +
`MINIO_PORT` in `.env` (MinIO) to match.

The app's `.env` must point at the same API port — see `../roommate-mach/.env`.

## 3. Start PostgreSQL + MinIO

```bash
docker compose up -d
docker ps   # confirm both containers show a host port mapping, e.g. 0.0.0.0:19000->9000/tcp
```

If a container shows no host-side port mapping, recreate it:

```bash
docker compose down && docker compose up -d
```

## 4. Set up the database

```bash
npx prisma generate
npm run db:deploy    # applies prisma/migrations
npm run db:seed      # questions + default app config
```

`db:deploy` runs `prisma migrate deploy`, which is also what the Docker image runs on start.
While changing the schema locally, use `npm run db:migrate` (`prisma migrate dev`) so a
migration file is created and committed alongside the change.

### Baselining a database that predates migrations

If you have an old dev database created with `prisma db push`, don't reset it — bring it in
line and mark the baseline as applied:

```bash
npx prisma db push          # brings the existing database up to the current schema
npx prisma migrate resolve --applied 0_init
npx prisma migrate status   # should say the schema is up to date
```

### Demo data

`npm run db:seed` only creates the questions and default configuration. To also create three
sample students (useful for seeing real match scores in the deck):

```bash
SEED_DEMO_USERS=true npm run db:seed
```

They log in with `demo-password-123` (override with `SEED_DEMO_PASSWORD`). These are real,
log-in-able accounts — never seed them into a production database.

## 5. Run the API

```bash
npm run start:dev
```

Default port is `18888` (`PORT` in `.env`). Check it came up with:

```bash
curl http://localhost:18888/health         # process is alive
curl http://localhost:18888/health/ready   # database + object storage reachable
```

API documentation is served at `http://localhost:18888/api/docs` in development.

## 6. Run tests

```bash
npm test            # unit tests (127)
npm run test:e2e    # e2e tests (77) — needs the docker services from step 3 running
```

The e2e suites run against a real (local) database. They create and delete real rows and clean
up after themselves, but **don't point them at a shared/staging database**.

- `test/all-scrum.e2e-spec.ts` — auth, profile, avatar, search/block, account deletion
- `test/matching-chat.e2e-spec.ts` — discover/filters/scoring, swipe and match, chat with read
  receipts and unread counts, blocking, notifications, admin console
- `test/app.e2e-spec.ts` — root and health endpoints

## Project structure

```text
src/
  auth/            register/login/OTP/Google login/password reset
    otp.service.ts   one-time codes, hashed and stored in the database
  features/        everything behind AuthGuard: profile, questionnaire, matching, chat,
                   notifications, block/report, admin
    scoring.ts       compatibility scoring and the per-category breakdown
    dto/             validation for every endpoint that takes a body or query
  config/          admin-editable settings (allowed email domains, match weights)
  notifications/   notification rows + Expo push delivery
  push/            push token register/unregister
  health/          liveness and readiness probes
  common/filters/  Prisma errors to correct HTTP statuses
  prisma/          PrismaService wrapper
prisma/schema.prisma, prisma/migrations/, prisma/seed.ts
docker-compose.yml   dev stack: postgres + minio
```

## Known gaps

See `TASKS.md`. In short: chat is still polling rather than WebSocket, there is no refresh
token, and `discover()` scores candidates in memory with a 500-candidate cap per request.
