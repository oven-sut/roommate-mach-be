# Roommate Match — Backend ⚙️

[![CI](https://github.com/oven-sut/roommate-mach-be/actions/workflows/ci.yml/badge.svg)](https://github.com/oven-sut/roommate-mach-be/actions/workflows/ci.yml)

REST API สำหรับแอปหาเพื่อนร่วมห้องของนักศึกษา มทส. — **NestJS 11 + PostgreSQL 16 + Prisma 6**
ยืนยันตัวตนด้วย **JWT + bcrypt** · OTP ทางอีเมลผ่าน **Resend** · push ผ่าน **Expo** · เก็บรูปใน **MinIO**

ใช้คู่กับแอปใน [`../roommate-mach`](../roommate-mach) (Expo SDK 54)

---

## เทคโนโลยีที่ใช้จริง

| ส่วน | เทคโนโลยี |
|---|---|
| Framework | NestJS 11 (TypeScript 5.7) |
| ฐานข้อมูล | PostgreSQL 16 + Prisma 6 (มี migrations) |
| Auth | JWT (`@nestjs/jwt`) + bcryptjs (cost 12) |
| OTP | เก็บ hash ลง DB (ตาราง `email_otps`) ส่งผ่าน Resend |
| Push | Expo Push API (`exp.host`) |
| เก็บไฟล์รูป | MinIO (S3-compatible) |
| Rate limiting | `@nestjs/throttler` (ต่อ IP) + ลิมิตต่ออีเมลใน `OtpService` |
| Security headers | helmet |
| API docs | Swagger ที่ `/api/docs` |
| Deploy | Docker / docker-compose |

> **แชทยังเป็น polling** ฝั่งแอปดึงข้อความทุก 4 วินาที ยังไม่มี WebSocket gateway

---

## เริ่มต้นใช้งาน

ดูขั้นตอนละเอียด (รวมปัญหาเรื่องพอร์ตบน Windows) ที่ [`SETUP.md`](./SETUP.md)

```bash
npm install
cp .env.example .env        # แก้ JWT_SECRET, ADMIN_EMAIL ให้เรียบร้อย
docker compose up -d        # PostgreSQL + MinIO
npx prisma generate
npm run db:deploy           # รัน migrations
npm run db:seed             # คำถาม 4 หมวด + ค่า config เริ่มต้น
npm run start:dev
```

- API: `http://localhost:18888` (พอร์ตตั้งใน `.env`)
- Health: `GET /health` · Readiness: `GET /health/ready`
- Swagger: `http://localhost:18888/api/docs` (เปิดเฉพาะตอน dev)

สร้างบัญชีตัวอย่าง 3 คนสำหรับลองเล่นได้ด้วย `SEED_DEMO_USERS=true npm run db:seed`

---

## Environment (`.env`)

| ตัวแปร | คำอธิบาย |
|---|---|
| `NODE_ENV` | `development` ตอน dev · **ต้องเป็น `production` ตอน deploy จริง** |
| `PORT` | พอร์ตของ API (ค่าเริ่มต้นในไฟล์ตัวอย่างคือ 18888) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` | คีย์ลับสำหรับเซ็น token — ตอน production ต้องยาว ≥ 32 ตัวอักษร ไม่งั้นแอปไม่ยอมบูต |
| `ADMIN_EMAIL` | อีเมลที่จะถูกเลื่อนเป็น `ADMIN` อัตโนมัติตอน login |
| `ALLOWED_EMAIL_DOMAINS` | โดเมนที่สมัครได้ (แอดมินแก้ทีหลังได้จากในแอป) |
| `ALLOW_DEV_OTP` | `true` ตอน dev — รับ OTP `123456` และส่ง otp/resetToken กลับใน response · **ห้ามเป็น true ตอน production** (แอปจะ throw ตอนบูต) |
| `RESEND_API_KEY` / `RESEND_FROM` | ถ้าไม่ตั้ง ระบบจะ log OTP ลง console แทนการส่งอีเมลจริง |
| `CORS_ORIGINS` | origin ที่เรียก API ได้ตอน production (แอป native ไม่ส่ง Origin จึงไม่ต้องใส่) |
| `ENABLE_SWAGGER` | ตั้ง `true` ถ้าต้องการเปิด `/api/docs` ตอน production |
| `MINIO_*` | ที่อยู่ + คีย์ + ชื่อ bucket ของ MinIO |

> 🔒 อย่า commit `.env` — gitignore ไว้แล้ว
> ถ้าไม่ตั้ง Resend หรือ MinIO ระบบยังรันได้ (ฟีเจอร์นั้นจะข้ามหรือคืน 503 พร้อมข้อความ)

---

## โครงสร้างโปรเจกต์

```
src/
  auth/            สมัคร/login/Google/OTP/reset password (+ otp.service.ts เก็บ OTP ลง DB)
  features/        ทุกอย่างหลัง AuthGuard: profile, questionnaire, discover, swipe,
                   match, chat, notifications, block/report, admin
    scoring.ts     คิดคะแนนความเข้ากันได้จากคำตอบจริง + breakdown รายหมวด
    dto/           DTO + class-validator ของทุก endpoint ที่รับ body หรือ query
  config/          AppSettingsService — โดเมนอีเมล + น้ำหนักการจับคู่ (แอดมินแก้ได้)
  notifications/   สร้าง notification ใน DB + ส่ง push ผ่าน Expo (เคารพ notificationPrefs)
  push/            ลงทะเบียน/ยกเลิก Expo push token
  health/          liveness + readiness (DB และ MinIO)
  common/filters/  แปลง error ของ Prisma เป็น HTTP status ที่ถูกต้อง
prisma/
  schema.prisma    17 models
  migrations/      มี migration history จริง (ใช้ `prisma migrate deploy` ตอน deploy)
  seed.ts          คำถาม + config + (ถ้าสั่ง) บัญชีตัวอย่าง
```

---

## การจับคู่ทำงานอย่างไร

แบบสอบถามมี 4 หมวด (`q1`–`q4`) แอปส่งคำตอบมาเป็น array ของกลุ่มตัวเลือก
**ลำดับของกลุ่มคือสัญญาระหว่างแอปกับ API** — ดู `toApiAnswers` ในแอป และ `scoring.ts` ที่นี่

```jsonc
{
  "q1": [["23:00–00:00"], ["07:00–08:00"]],          // เวลานอน / เวลาตื่น
  "q2": [["Spotless", "Dishes same day"], ["4/5"]],  // นิสัยความสะอาด / ให้ความสำคัญกี่คะแนน
  "q3": [["sometime"], ["Weekly"], ["6/month"], ["Close friends"]],
  "q4": [["Anytime"], ["24°"], ["5/8"], ["Library"]]
}
```

`scoring.ts` แปลงกลับเป็นค่าที่มีความหมาย แล้วเทียบแบบ "ใกล้เคียงแค่ไหน" ไม่ใช่ "ตรงกันเป๊ะไหม":
ช่วงเวลานอนใช้ overlap + ระยะห่างของจุดกึ่งกลาง · ชุดตัวเลือกใช้ Jaccard · ตัวเลขใช้ระยะห่างที่ normalize แล้ว
จากนั้นถ่วงน้ำหนักตาม `weights` ที่แอดมินตั้งไว้ แล้วคืนทั้งคะแนนรวมและ `breakdown` รายหมวด

ถ้าฝ่ายใดยังไม่ได้ทำแบบสอบถาม จะคืน `score: null` (ไม่แต่งตัวเลขปลอม) และเรียงไว้ท้ายสุด

---

## REST API

Swagger ที่ `/api/docs` เป็นเอกสารฉบับเต็ม สรุปคร่าว ๆ:

**Auth** (`/auth`) — `check-email` (GET/POST), `send-otp`, `resend-otp`, `verify-otp`,
`verify-email`, `register`, `login`, `google`, `forgot-password`, `reset-password`,
`reset-password-otp`

**Account** (`/api`) — `GET/PATCH/DELETE me`, `PATCH password`

**Profile** — `PUT profile`, `GET/PUT users/profile`, `POST users/avatar`,
`GET users/search`, `GET users/:id`

**Questionnaire** — `GET questionnaire` (คำถาม + คำตอบเดิม), `PUT questionnaire`

**Matching** — `GET discover` (กรอง `page`, `yearBand`, `major`, `budgetMin/Max`,
`minScore`, `mustMatch`), `POST swipes/:userId`, `GET matches`, `GET likes`,
`DELETE matches/:id`, `DELETE matches/user/:userId`

**Chat** — `GET/POST conversations`, `GET/POST conversations/:id/messages`
(รองรับ `limit` + `before`), `PATCH conversations/:id/read`

**Notifications & safety** — `GET notifications`, `PATCH notifications/read-all`,
`PATCH notifications/:id/read`, `POST reports/:userId`, `GET/POST/DELETE blocks`

**Admin** — `dashboard`, `users`, `users/:id/suspend`, `users/:id/verify`,
`reports`, `reports/:id`, `config` (GET/PUT)

**Push** — `POST push/register`, `POST push/unregister`

---

## ความปลอดภัย

- `PATCH /api/me` รับเฉพาะ field ที่ whitelist ไว้ — ยกระดับสิทธิ์ตัวเองไม่ได้
- สมัครสมาชิกต้องผ่าน OTP ก่อนเสมอ · OTP เก็บเป็น hash ใน DB · จำกัดจำนวนครั้งที่กรอกผิด
- จำกัดจำนวนการส่ง OTP ต่ออีเมล (ที่ `OtpService`) และต่อ IP (throttler) — แยกกันเพราะทั้งมหาวิทยาลัยออกเน็ตผ่าน IP ไม่กี่ตัว
- บังคับโดเมนอีเมล SUT ทั้งตอนสมัครและตอน Google Sign-In
- เปลี่ยนรหัสผ่านต้องกรอกรหัสเดิม (ยกเว้นบัญชีที่ล็อกอินด้วย Google และยังไม่เคยตั้งรหัส)
- บล็อกคนใดคนหนึ่ง = ยกเลิก match + ซ่อนห้องแชท + หายจาก discover ทั้งสองทาง
- ตอน `NODE_ENV=production` แอปจะไม่ยอมบูตถ้า `ALLOW_DEV_OTP=true` หรือ `JWT_SECRET` อ่อนเกินไป

---

## เทสต์

```bash
npm test         # unit — 127 เทสต์
npm run test:e2e # e2e — 77 เทสต์ (ต้องมี docker compose รันอยู่)
```

e2e ยิงกับฐานข้อมูลจริงและลบข้อมูลที่สร้างทิ้งเมื่อจบ **อย่าชี้ไปที่ฐานข้อมูลที่ใช้ร่วมกับคนอื่น**

---

## CI

ทุก push และทุก PR ผ่าน GitHub Actions: lint → unit tests → build → e2e (Postgres + MinIO จริง) → docker build
รายละเอียดทั้งหมดอยู่ใน [`docs/ci-pipeline.md`](./docs/ci-pipeline.md)

```bash
npm run lint:ci   # แบบเดียวกับที่ CI รัน (warning = พัง)
```

---

## สิ่งที่ยังไม่ได้ทำ

- แชทยังเป็น polling ยังไม่มี WebSocket/SSE
- ยังไม่มี refresh token (JWT อายุ 7 วัน) และยังเพิกถอน token กลางคันไม่ได้
- `discover()` คิดคะแนนในหน่วยความจำโดยจำกัดผู้สมัครไว้ที่ 500 คนต่อคำขอ — ถ้าผู้ใช้โตกว่านี้มากต้องย้ายไปคิดล่วงหน้าหรือเก็บคะแนนลง DB
