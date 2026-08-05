# Setup Guide (SCRUM-171)

Getting a new team member from clone to running tests locally. This reflects the actual code in
`src/` today — `README.md` describes a larger planned architecture (Socket.IO, Firebase push,
separate `users/`/`matching/`/`chat/` modules, `/health`, `db:seed`) that hasn't been built yet;
see `TASKS.md` for the full gap list.

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
| `JWT_SECRET` | Long random secret for signing auth tokens |
| `ADMIN_EMAIL` | Email that gets auto-promoted to `ADMIN` role on login |
| `GOOGLE_CLIENT_IDS` | OAuth client IDs for `/auth/google` (comma-separated) |
| `NODE_ENV` | `development` locally; must be `production` in prod |
| `ALLOW_DEV_OTP` | `true` locally — accepts OTP `123456` and echoes otp/resetToken in responses so you can test without a real mailbox. **Must be unset/`false` in production** — the app refuses to boot if `NODE_ENV=production` and this is `true` |
| `RESEND_API_KEY` / `RESEND_FROM` | Optional. Without it, OTPs are just logged to the console instead of emailed |
| `MINIO_ENDPOINT` / `MINIO_PORT` / `MINIO_*_KEY` / `MINIO_BUCKET_NAME` | MinIO object storage for avatars/photos/verification docs |

### Windows gotcha: MinIO port 9000

Windows/Hyper-V periodically reserves TCP port ranges for itself (check with
`netsh interface ipv4 show excludedportrange protocol=tcp`). Port 9000 commonly falls inside one
of these ranges, which makes `docker compose up` fail (or silently not publish the port) for
MinIO. This repo's `docker-compose.yml` and `.env(.example)` already map MinIO to host port
**19000** instead of 9000 to avoid this. If you hit a "port is not available" error from Docker on
`up`, run the `netsh` command above, pick a host port outside every excluded range, and update
both `docker-compose.yml`'s `ports:` for the `minio` service and `MINIO_PORT` in `.env` to match.

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

There are no Prisma migrations yet (see `TASKS.md` T-17) — schema is applied directly:

```bash
npx prisma generate
npx prisma db push
```

There is no seed script yet either (T-06/T-18) — the questionnaire's `Question`/`QuestionGroup`
rows are seeded lazily the first time anyone calls `PUT /api/questionnaire`.

## 5. Run the API

```bash
npm run start:dev
```

Default port is `8888` (`PORT` in `.env`). There's no `/health` endpoint yet — hit any real route,
e.g. `GET /auth/check-email?email=test@g.sut.ac.th`, to confirm it's up.

## 6. Run tests

```bash
npm test            # unit tests
npm run test:e2e    # e2e tests — needs the docker services from step 3 running
```

The e2e suite in `test/all-scrum.e2e-spec.ts` covers the auth, profile, avatar, search/block, and
account-deletion flows end to end against a real (local) database — it creates and deletes real
rows, so don't point it at a shared/staging database.

## Project structure (actual)

```
src/
  auth/           # register/login/OTP/Google login/password reset — src/auth/auth.service.ts
  features/       # everything behind AuthGuard: profile, questionnaire, matching, chat,
                   # notifications, block/report, admin — src/features/features.service.ts
  push/           # push token register/unregister
  prisma/         # PrismaService wrapper
prisma/schema.prisma
docker-compose.yml   # dev stack: postgres + minio
```

## Known gaps

See `TASKS.md` for the full audit. In short: no Prisma migrations, no seed script, no Swagger
docs, no `/health` endpoint, and several P1 items around chat pagination/read receipts and push
notification delivery are still open.
