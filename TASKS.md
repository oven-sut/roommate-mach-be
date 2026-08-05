# Roommate Match Backend — Audit & Task List

ตรวจสอบเมื่อ 2026-08-05 · branch `main` · commit `b3343be` · working tree สะอาด

---

## 1. สถานะปัจจุบัน (สิ่งที่ทำเสร็จแล้ว)

### Infrastructure
| ส่วน | สถานะ |
|---|---|
| NestJS 11 + TypeScript 5.7 | ✅ |
| Prisma 6 + PostgreSQL (16 ตาราง) | ✅ (ใช้ `db push` ไม่มี migrations) |
| MinIO object storage (`src/features/minio.service.ts`) | ✅ auto-create bucket + public read policy |
| JWT auth guard (`src/features/auth.guard.ts`) | ✅ verify token + เช็ค suspended |
| docker-compose (postgres + minio) | ✅ |
| Dockerfile | ✅ |
| Global ValidationPipe + CORS + body limit 12mb | ✅ (`src/main.ts`) |

### Endpoints ที่ implement แล้ว

**Auth** (`src/auth/auth.controller.ts`) — 11 routes
- `GET/POST /auth/check-email` — เช็คอีเมลซ้ำ
- `POST /auth/send-otp`, `/auth/resend-otp` — ส่ง OTP (Resend API หรือ mock log)
- `POST /auth/verify-otp`, `/auth/verify-email` — ยืนยัน OTP
- `POST /auth/register` — สมัคร + RegisterDto validation (displayName, email, sutId, password)
- `POST /auth/login` — login + auto-promote ADMIN_EMAIL
- `POST /auth/google` — verify Google ID token, บังคับโดเมน `@g.sut.ac.th`
- `POST /auth/forgot-password`, `/auth/reset-password` — reset ผ่าน token hash + expiry 15 นาที

**Users / Profile** (`src/features/features.controller.ts`) — prefix `/api`
- `GET /me`, `PATCH /me`
- `PUT /profile`, `GET/PUT /users/profile` (alias)
- `POST /users/avatar` — อัปโหลด base64 → MinIO, เก็บสูงสุด 6 รูป
- `GET /users/search?q=` — ค้นหาจาก displayName / email / major + flag `isBlocked`
- `PATCH /password` — เปลี่ยนรหัสผ่าน (bcrypt cost 12)

**Questionnaire**
- `GET /api/questionnaire` — 6 คำถาม hardcode ใน service
- `PUT /api/questionnaire` — ❌ **500 error** (ดู T-02)

**Matching**
- `GET /api/discover` — กรอง block/swiped/suspended/undiscoverable + คิด score + pagination 30/หน้า
- `POST /api/swipes/:userId` — LIKE/PASS, auto-create Match + Conversation + Notification 2 ฝั่ง
- `GET /api/matches`, `GET /api/likes`, `DELETE /api/matches/:id`, `DELETE /api/matches/user/:userId`

**Chat**
- `GET /api/conversations` (พร้อมข้อความล่าสุด), `GET/POST /api/conversations/:id/messages`
- ส่งข้อความแล้วสร้าง notification ให้ผู้รับอัตโนมัติ

**Notifications / Safety / Verification**
- `GET /api/notifications`, `PATCH /api/notifications/:id/read`
- `POST /api/reports/:userId`, `POST/DELETE /api/blocks/:userId`, `POST /api/users/block`, `/users/unblock`
- `POST /api/verification` — อัปโหลดเอกสารเข้า MinIO

**Admin** — 6 routes: `dashboard`, `users`, `users/:id/suspend`, `users/:id/verify`, `reports`, `config` (GET/PUT)

**Push** (`src/push/`) — `POST /push/register`, `/push/unregister` (+ alias `/api/push/*`)

### สถานะเทสต์ (รันจริงแล้ว)
- Unit: **15/15 ผ่าน** (5 suites)
- E2E: **21/22 ผ่าน** — ตกอยู่ 1 เทสต์คือ avatar upload (MinIO port ไม่ถูก publish ใน container ที่รันอยู่)
- E2E ครอบคลุม SCRUM-152…173 (ขาด 163, 164, 170, 171)

---

## 2. Task List

### 🔴 P0 — ต้องแก้ก่อนขึ้น production

#### T-01 · ปิดช่อง Privilege Escalation ที่ `PATCH /api/me`
**ยืนยันด้วยการยิง request จริงแล้ว** — user ธรรมดาส่ง `{"role":"ADMIN"}` แล้วกลายเป็น admin และเข้า `/api/admin/dashboard` ได้ทันที (200 OK)

สาเหตุ: `features.controller.ts:27` รับ body เป็น `Record<string, unknown>` แล้ว `features.service.ts:230-234` spread `...data` ลง `prisma.user.update` ตรง ๆ → เขียนได้ทุก field รวม `role`, `suspended`, `passwordHash`, `email`

- [ ] สร้าง `UpdateMeDto` (whitelist เฉพาะ `displayName`, `discoverable`, `notificationPrefs`)
- [ ] ใน service เลือก field แบบ explicit ห้าม spread
- [ ] เพิ่ม regression test: ส่ง `role: 'ADMIN'` ต้องได้ 400 และ role ไม่เปลี่ยน

#### T-02 · `PUT /api/questionnaire` พัง (500)
`features.service.ts:287-301` ยิง raw SQL `INSERT INTO "Questionnaire"` แต่ **ตาราง `Questionnaire` ไม่มีใน `schema.prisma` และไม่มีใน DB** (ตรวจ `\dt` แล้ว 16 ตาราง ไม่มีตัวนี้)

ผลกระทบต่อเนื่อง: `GET /api/me` คืน answers ว่างตลอด (ถูก `catch` กลืน) และ `discover()` ให้ score = 70 กับทุกคน → ระบบ matching ไม่ทำงานจริง

- [ ] เลือกทาง: (ก) ใช้ตาราง `Answer` + `Question` ที่มีใน schema อยู่แล้ว หรือ (ข) เพิ่ม model `Questionnaire` ลง schema
- [ ] แนะนำทาง (ก) — เลิกใช้ raw SQL ทั้งหมด แล้วใช้ `prisma.answer.upsert`
- [ ] seed `Question` + `QuestionGroup` จาก `QUESTION_DEFINITIONS`
- [ ] เพิ่ม e2e: PUT → GET /api/me เห็น answers → discover score เปลี่ยน

#### T-03 · Register ไม่บังคับ OTP + OTP เก็บใน memory
`auth.service.ts:67` เก็บ OTP ใน `Map` ใน process → หายเมื่อ restart, ใช้กับหลาย instance ไม่ได้ และ `register()` ไม่เช็คว่าอีเมลผ่าน OTP มาแล้วหรือยัง → สมัครข้ามขั้น OTP ได้

- [ ] ย้าย OTP ไป DB (model ใหม่ `EmailOtp`: email, codeHash, expiresAt, attempts, consumedAt) หรือ Redis
- [ ] hash code ก่อนเก็บ + จำกัดจำนวนครั้งที่กรอกผิด
- [ ] `register()` ต้องเช็คว่า email ผ่านการ verify แล้ว

#### T-04 · Dev backdoor เปิดอยู่เพราะไม่ได้ตั้ง `NODE_ENV`
`.env` ไม่มี `NODE_ENV` → เงื่อนไข `NODE_ENV !== 'production'` เป็นจริงทั้งหมด:
- `auth.service.ts:118` — ยอมรับ OTP `123456` ตลอด
- `auth.service.ts:110` — response ส่ง `otp` กลับมาให้ client
- `auth.service.ts:171-173` — `forgot-password` ส่ง `resetToken` กลับมาตรง ๆ

- [ ] เพิ่ม `NODE_ENV` ใน `.env` / `.env.example` / Dockerfile
- [ ] เปลี่ยน guard เป็น flag ชัดเจน เช่น `ALLOW_DEV_OTP=true` แทนการอ้าง NODE_ENV
- [ ] ตรวจ config ตอน bootstrap: ถ้าเป็น production แล้ว flag เปิด → ให้ throw

---

### 🟠 P1 — bug/ช่องว่างสำคัญ

#### T-05 · `GET /api/likes` คืน array ว่างเสมอ
`features.service.ts:468-480` — filter `from: { sentSwipes: { none: { toId: userId } } }` ขัดแย้งกับตัวมันเอง เพราะ swipe แถวที่กำลังหานั้นเองก็คือ sentSwipes ของ `from` ที่ `toId = userId` → เงื่อนไข `none` เป็นเท็จตลอด

- [ ] แก้เป็น `from: { receivedSwipes: { none: { fromId: userId } } }` (ยังไม่มีใครที่ *เรา* swipe กลับ)
- [ ] เพิ่ม unit/e2e test ที่มี like ค้างอยู่จริง

#### T-06 · Schema ตาย: `Question` / `QuestionGroup` / `Answer` ไม่ถูกใช้เลย
grep `prisma.answer` / `prisma.question` = 0 ผลลัพธ์ แต่คำถาม hardcode อยู่ใน `features.service.ts:31-168`
- [ ] รวมกับ T-02 — ให้ใช้ตารางจริง หรือถ้าจะ hardcode ต่อก็ลบ model ที่ไม่ใช้ออก
- [ ] ทำ seed script (`prisma/seed.ts`)

#### T-07 · `discover()` โหลด user ทั้งหมดเข้า memory
`features.service.ts:348-357` — `findMany` ไม่มี `take`/`skip`, sort แล้วค่อย `.slice()` → ยิ่ง user มาก ยิ่งพัง
- [ ] เก็บ score ลง DB หรือ pre-compute แล้ว query แบบ paginate
- [ ] อย่างน้อยใส่ hard cap (เช่น 500 candidates) ระหว่างรอ

#### T-08 · ไม่มี rate limiting เลย
`/auth/send-otp`, `/auth/login`, `/auth/forgot-password`, `/auth/check-email` ยิงได้ไม่จำกัด → brute force / email bombing / enumeration
- [ ] ติดตั้ง `@nestjs/throttler`
- [ ] ตั้ง limit ต่อ IP + ต่อ email สำหรับ OTP และ login

#### T-09 · Admin `verify()` ระเบิดถ้าไม่มี verification record
`features.service.ts:711-716` — `verification.update` โยน P2025 (500) เมื่อ user ยังไม่ส่งเอกสาร และ set `documentUrl: null` โดยไม่ลบไฟล์ใน MinIO
- [ ] เปลี่ยนเป็น `upsert` หรือเช็คก่อนแล้วโยน 404
- [ ] เพิ่ม `minioService.deleteFile()` แล้วเรียกตอน approve/reject
- [ ] แจ้ง notification ให้ user เมื่อผลออก

#### T-10 · Avatar upload ตอบ 500 เมื่อ MinIO ล่ม + container ไม่ publish port
`features.service.ts:579-601` ไม่ try/catch (ต่างจาก `processPhotos`/`verification` ที่ catch) และ container `roommate_minio` ที่รันอยู่ไม่ได้ map port 9000 ออกมา (`docker port` ว่าง) → e2e ตก 1 เทสต์
- [ ] `docker compose down && docker compose up -d` ให้ใช้ ports จาก compose file
- [ ] ห่อ error → 503 พร้อมข้อความอ่านรู้เรื่อง
- [ ] validate mime type + ขนาดไฟล์ก่อนอัปโหลด (ตอนนี้รับ base64 อะไรก็ได้ ≤12mb)

#### T-11 · Push token เก็บแล้วแต่ไม่มีการส่ง push จริง
`push.service.ts` ทำแค่ upsert/delete ส่วน `notificationPrefs` ใน User ไม่เคยถูกอ่านที่ไหน
- [ ] เขียน `NotificationService.dispatch()` ส่ง FCM/Expo ตอน match และตอนได้ข้อความ
- [ ] เคารพ `notificationPrefs` (matches/messages/likes)
- [ ] ลบ token ที่ invalid ออกจาก DB

#### T-12 · Block / Report ยังไม่ครบ flow
- [ ] block แล้วต้อง set match เป็น UNMATCHED + ซ่อน conversation (ตอนนี้ยัง chat กันได้)
- [ ] กัน block/report ตัวเอง (ตอนนี้ทำได้)
- [ ] `report` ไม่กันซ้ำ + ไม่เช็คว่า reportedId มีอยู่จริง
- [ ] `unmatch` ไม่ลบ/archive conversation

---

### 🟡 P2 — คุณภาพโค้ดและงานที่เหลือ

#### T-13 · ไม่มี DTO ที่ endpoint ส่วนใหญ่
`profile`, `updateMe`, `questionnaire`, `swipe`, `send message`, `report`, `verification` ใช้ `Record<string, unknown>` / inline type → `ValidationPipe` ข้ามการตรวจทั้งหมด
- [ ] สร้าง DTO + class-validator ให้ทุก endpoint ที่รับ body
- [ ] เช็ค range: `age`, `year`, `budgetMin <= budgetMax`, ความยาว `bio`, จำนวน photos

#### T-14 · Chat ยังขาดของสำคัญ
- [ ] `Message.readAt` มีใน schema แต่ไม่มี endpoint mark-as-read
- [ ] ไม่มี unread count ใน `GET /api/conversations`
- [ ] ไม่มี pagination ที่ `messages`, `matches`, `conversations`
- [ ] ยังเป็น polling — พิจารณา WebSocket gateway

#### T-15 · ไม่มี endpoint ดูโปรไฟล์คนอื่น
มีแค่ `GET /api/me` — ไม่มี `GET /api/users/:id` สำหรับดูโปรไฟล์คู่ match/คนที่ค้นเจอ
- [ ] เพิ่ม endpoint พร้อมเช็ค block/discoverable และซ่อน email

#### T-16 · Push controller โยน `Error` ดิบ
`push.controller.ts:14,22` → กลายเป็น 500 ควรเป็น 400
- [ ] ใช้ `BadRequestException` + DTO

#### T-17 · ไม่มี Prisma migrations
ใช้ `db push` เท่านั้น ไม่มีโฟลเดอร์ `prisma/migrations` → deploy production แบบมี history ไม่ได้ และตาราง `Questionnaire` ที่โค้ดอ้างถึงก็หลุดไปเพราะเหตุนี้
- [ ] `prisma migrate dev --name init` แล้ว commit
- [ ] เปลี่ยน deploy เป็น `prisma migrate deploy`

#### T-18 · ไม่มี API docs
- [ ] ติดตั้ง `@nestjs/swagger` + decorate DTO/controller
- [ ] expose `/api/docs` (ปิดใน production หรือใส่ auth)

#### T-19 · ไม่มี health check
`GET /` คืน `"Hello World!"` — ยังใช้ `AppService` ตัว default จาก scaffold
- [ ] `GET /health` เช็ค DB + MinIO สำหรับ container orchestration

#### T-20 · Hardening / cleanup
- [ ] `main.ts:14` — `origin: true` สะท้อน origin ทุกอันคู่กับ `credentials: true` → ควร whitelist
- [ ] ไม่มี helmet / security headers
- [ ] JWT อายุ 7 วัน ไม่มี refresh token และไม่มี revoke
- [ ] `sutId` ใน `RegisterDto` validate แล้วแต่ **ไม่เคยถูกบันทึก** (ไม่มี field ใน User model)
- [ ] `package.json` ชื่อยังเป็น `"temp"`
- [ ] ย้าย/ลบ script ที่ root: `test-query.ts`, `test-service.ts`, `clear-swipes.ts`
- [ ] `console.log/error` กระจายอยู่ในหลายไฟล์ → ใช้ Nest `Logger`
- [ ] ยังไม่มี global exception filter → error ของ Prisma หลุดออกมาเป็น 500

#### T-21 · เติมช่องว่างของเทสต์
- [ ] ไม่มี test ให้ `features.service` เกือบทั้งหมด (767 บรรทัด มี spec แค่ 62 บรรทัด)
- [ ] ไม่มี test ให้ `auth.service` (login/google/otp/reset)
- [ ] ไม่มี test ให้ `auth.guard`, `minio.service`
- [ ] E2E ยังไม่ครอบคลุม: discover, swipe/match, chat, notifications, admin
- [ ] E2E ไม่มีการ cleanup ข้อมูล → สร้าง user ทิ้งไว้ใน DB ทุกครั้งที่รัน
- [ ] SCRUM ที่ยังไม่มี test: 163, 164, 170, 171

---

## 3. ลำดับที่แนะนำ

1. **T-01** (privilege escalation) — เร่งด่วนสุด
2. **T-04** (dev backdoor) + **T-08** (rate limit)
3. **T-02 + T-06 + T-17** (questionnaire + migrations) — ทำรวมกันทีเดียว
4. **T-05** (likes) + **T-10** (MinIO/avatar)
5. **T-03** (OTP ลง DB), **T-09**, **T-12**
6. **T-13** (DTO ทั้งระบบ) แล้วต่อด้วย **T-21** (เทสต์)
7. งาน feature: **T-11**, **T-14**, **T-15**
8. Polish: **T-16**, **T-18**, **T-19**, **T-20**
