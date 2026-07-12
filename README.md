# Roommate Match — Backend ⚙️

REST API + realtime ของแอปหาเพื่อนร่วมห้อง พัฒนาด้วย **NestJS 10 + PostgreSQL + Prisma**
ยืนยันตัวตน **JWT + bcrypt** · แชทเรียลไทม์ **Socket.IO** · อีเมล **Resend** · push **Firebase FCM** · เก็บรูป **MinIO**

> เป็นส่วน server ของโปรเจกต์ — ใช้คู่กับแอปใน [`../sut-roommate-matcher`](../sut-roommate-matcher)

## เทคโนโลยี

| ส่วน | เทคโนโลยี |
|---|---|
| Framework | NestJS 10 (TypeScript) |
| ฐานข้อมูล | PostgreSQL 16 + Prisma ORM |
| Auth | JWT (passport-jwt) + bcryptjs |
| Realtime | Socket.IO gateway |
| อีเมล (OTP) | Resend |
| Push | firebase-admin (FCM) |
| เก็บไฟล์รูป | MinIO (S3-compatible) |
| Deploy | Docker / docker-compose + Nginx |

## เริ่มต้นใช้งาน

### Docker (แนะนำ) — API + PostgreSQL + MinIO

```bash
cp .env.example .env      # เติมค่าตามต้องการ
docker-compose up -d --build
```

- API `http://localhost:3000` (health: `GET /health`)
- PostgreSQL `localhost:5432` · MinIO API `:9000` / Console `:9001`
- คอนเทนเนอร์รัน `prisma db push` อัตโนมัติตอนสตาร์ท
- seed ข้อมูลเริ่มต้น (มหาวิทยาลัย/คำถาม/แอดมิน): `npm run db:seed`

### รันเอง

```bash
npm install
# ตั้ง .env ให้ DATABASE_URL ชี้ PostgreSQL ของคุณ
npx prisma generate && npx prisma db push
npm run start:dev
```

## Environment (`.env`)

| ตัวแปร | คำอธิบาย |
|---|---|
| `PORT` | พอร์ต (ค่าเริ่มต้น 3000) |
| `DATABASE_URL` | PostgreSQL connection string |
| `JWT_SECRET` / `JWT_EXPIRATION` | คีย์ลับ + อายุ token |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | บัญชีแอดมินตอน seed |
| `RESEND_API_KEY` / `MAIL_FROM` | ส่งอีเมล OTP (เว้น `RESEND_API_KEY` = โหมด dev: log รหัสแทนส่งจริง) |
| `GOOGLE_APPLICATION_CREDENTIALS` *หรือ* `FIREBASE_SERVICE_ACCOUNT` | คีย์ Firebase สำหรับ push (path ไฟล์ หรือ JSON string) |
| `MINIO_ENDPOINT` `MINIO_PORT` `MINIO_USE_SSL` | ที่อยู่ MinIO |
| `MINIO_ACCESS_KEY` `MINIO_SECRET_KEY` `MINIO_BUCKET` | คีย์ + bucket เก็บรูป |

> 🔒 อย่า commit `.env`, `firebase-service-account.json`, service account keys — gitignore ไว้แล้ว
> ถ้าไม่ตั้งค่า Resend/Firebase/MinIO ระบบยังรันได้ (ฟีเจอร์นั้นจะข้าม/log เตือน)

## REST API (โดยย่อ)

| Method | Path | สิทธิ์ | หน้าที่ |
|---|---|---|---|
| POST | `/auth/register` · `/auth/login` | - | สมัคร / เข้าสู่ระบบ → `access_token` |
| POST | `/auth/verify-email` · `/auth/resend-otp` | - | ยืนยันอีเมลด้วย OTP (ส่งจริงผ่าน Resend) |
| POST | `/auth/forgot-password` · `/auth/reset-password` | - | รีเซ็ตรหัสผ่านด้วย OTP |
| GET | `/auth/check-email` | - | เช็กว่าอีเมลถูกใช้แล้วหรือยัง |
| POST | `/auth/change-password` | user | เปลี่ยนรหัสผ่าน |
| GET/PUT | `/users/profile` | user | ดู/แก้โปรไฟล์ (รวมการตั้งค่าแจ้งเตือน/ความเป็นส่วนตัว) |
| POST | `/users/avatar` | user | อัปโหลดรูปโปรไฟล์ (multipart → MinIO) |
| DELETE | `/users/me` | user | ลบบัญชีถาวร (cascade + ลบรูป) |
| GET | `/uploads/avatars/:userId/:file` | - | เสิร์ฟรูป (public, proxy จาก MinIO) |
| GET | `/users/search` · POST `/users/block`,`/unblock` | user | ค้นหา / บล็อก |
| POST | `/push/register` · `/push/unregister` | user | ลงทะเบียน FCM device token |
| GET/POST | `/matching/recommendations` · `/matching/like` · `/unmatch` | user | จับคู่ |
| GET/PUT | `/questionnaire/...` | user | คำถาม/คำตอบ/คะแนนความเข้ากันได้ |
| GET/POST | `/chat/...` · `/notifications` · `/reports` | user | แชท / แจ้งเตือน / รายงาน |
| GET | `/universities` | - | รายชื่อมหาวิทยาลัย |
| * | `/admin/...` | admin | สถิติ, จัดการสมาชิก/คำถาม/รายงาน |

## WebSocket (Socket.IO)

เชื่อมต่อพร้อม JWT: `io(API_URL, { auth: { token } })` (token ผิด/หมดอายุถูกปฏิเสธ)

- client → server: `sendMessage { text, recipientId, kind }`
- server → client: `newMessage`, `newMatch`, `notification`
- ตั้งสถานะออนไลน์/ออฟไลน์อัตโนมัติเมื่อ connect/disconnect

## Deploy (Production)

- `docker-compose.prod.yml` — API (bind `127.0.0.1:3001`) + PostgreSQL + MinIO (ภายใน)
- Nginx reverse-proxy โดเมน → `127.0.0.1:3001` + WebSocket upgrade + TLS (Let's Encrypt)
- อัปเดต: อัปโหลดซอร์ส → `docker-compose -f docker-compose.prod.yml build api` → `up -d`

## โครงสร้าง

```
src/
  auth/           # สมัคร/ล็อกอิน/OTP/JWT
  users/          # โปรไฟล์ + อัปโหลด avatar + ลบบัญชี
  matching/       # แนะนำ/กดสนใจ/จับคู่ + สูตร compatibility
  chat/           # ประวัติแชท (ข้อความจริงจาก DB)
  realtime/       # Socket.IO gateway
  questionnaire/  # คำถามไลฟ์สไตล์ + คะแนน
  notifications/  # แจ้งเตือน (+ ยิง push ผ่าน push/)
  push/           # FCM (firebase-admin)
  mail/           # อีเมล OTP (Resend)
  storage/        # MinIO + เสิร์ฟรูป (/uploads)
  admin/          # แดชบอร์ด + จัดการ
prisma/schema.prisma
docker-compose.yml   # dev stack (api + db + minio)
Dockerfile
```

## คำสั่งที่ใช้บ่อย

```bash
npm run start:dev     # dev (watch)
npm run build         # compile
npm run db:push       # sync schema → DB
npm run db:seed       # seed ข้อมูลเริ่มต้น
docker-compose logs -f api
```
