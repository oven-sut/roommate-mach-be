# Roommate Match Backend — Audit & Task List

ตรวจครั้งแรก 2026-08-05 · **ปรับปรุงล่าสุด 2026-08-18** — งาน P0/P1 ทั้งหมดปิดแล้ว

สถานะเทสต์: unit **127/127 ผ่าน** · e2e **77/77 ผ่าน**

---

## 1. งานที่ปิดแล้ว

### 🔴 P0

| # | เรื่อง | สิ่งที่ทำ |
|---|---|---|
| T-01 | Privilege escalation ที่ `PATCH /api/me` | `UpdateMeDto` whitelist เฉพาะ `displayName` / `discoverable` / `notificationPrefs` · service เลือก field แบบ explicit · มี regression test ทั้ง unit และ e2e |
| T-02 | `PUT /api/questionnaire` พัง (500) | เลิกใช้ raw SQL ทั้งหมด ใช้ `prisma.answer.upsert` กับตาราง `Answer` ที่มีอยู่ · seed `Question`/`QuestionGroup` อัตโนมัติ |
| T-03 | Register ไม่บังคับ OTP + OTP อยู่ใน memory | เพิ่ม model `EmailOtp` เก็บ **hash** ของโค้ด + วันหมดอายุ + นับครั้งที่กรอกผิด (สูงสุด 5) · `register()` ต้องผ่าน OTP ก่อนเสมอ · โค้ดใช้ได้ครั้งเดียว |
| T-04 | Dev backdoor เปิดอยู่ | ใช้ flag `ALLOW_DEV_OTP` แยกจาก `NODE_ENV` · ตอนบูตถ้า `NODE_ENV=production` แล้ว flag เปิด หรือ `JWT_SECRET` อ่อน จะ throw ทันที |

### 🟠 P1

| # | เรื่อง | สิ่งที่ทำ |
|---|---|---|
| T-05 | `GET /api/likes` คืน array ว่างเสมอ | แก้เงื่อนไขเป็น `from: { receivedSwipes: { none: { fromId: userId } } }` · มี unit test ที่ล็อกเงื่อนไขนี้ไว้ และ e2e ที่มี like ค้างจริง |
| T-06 | Schema ตาย: `Question`/`QuestionGroup`/`Answer` ไม่ถูกใช้ | ใช้จริงแล้วทั้งสามตาราง · มี `prisma/seed.ts` |
| T-07 | `discover()` โหลด user ทั้งหมดเข้า memory | กรองที่ระดับ query (block/swipe/major/budget/year) + จำกัด 500 candidates ต่อคำขอ + เลิกดึง `Answer` ทั้งตาราง |
| T-08 | ไม่มี rate limiting | `@nestjs/throttler` ต่อ IP (หลวม เพราะทั้งมหาวิทยาลัยออกเน็ตผ่าน IP ไม่กี่ตัว) + ลิมิตจริงต่ออีเมลใน `OtpService` (ส่งได้ 5 ครั้ง/ชม. เว้น 30 วิ/ครั้ง) |
| T-09 | Admin `verify()` ระเบิดถ้าไม่มี verification record | เปลี่ยนเป็น `upsert` · เพิ่ม `minioService.deleteFile()` แล้วลบเอกสารทิ้งเมื่อตัดสินแล้ว · แจ้ง notification ให้ผู้ใช้ |
| T-10 | Avatar upload ตอบ 500 เมื่อ MinIO ล่ม | validate mime type ก่อนอัปโหลด · ห่อ error เป็น 503 พร้อมข้อความอ่านรู้เรื่อง · compose map พอร์ตถูกแล้ว |
| T-11 | Push token เก็บแล้วแต่ไม่เคยส่ง | `NotificationsService` ส่ง Expo push ตอน match / ข้อความใหม่ / ถูกไลก์ · เคารพ `notificationPrefs` · ลบ token ที่ `DeviceNotRegistered` ออกจาก DB |
| T-12 | Block / Report ยังไม่ครบ flow | block = unmatch + ซ่อนห้องแชท + หายจาก discover ทั้งสองทาง · กัน block/report ตัวเอง · report เช็คว่ามีผู้ใช้จริงและไม่ซ้ำระหว่างที่ยัง PENDING |

### 🟡 P2

| # | เรื่อง | สิ่งที่ทำ |
|---|---|---|
| T-13 | ไม่มี DTO ที่ endpoint ส่วนใหญ่ | ทุก endpoint ที่รับ body หรือ query มี DTO + class-validator แล้ว (รวม range ของ `age`, `year`, `budgetMin <= budgetMax`, ความยาว `bio`, จำนวนรูป) |
| T-14 | Chat ยังขาดของสำคัญ | `PATCH /api/conversations/:id/read` · unread count ใน `GET /api/conversations` · pagination ที่ `messages` (`limit` + `before`) · **ยังเป็น polling** ดูข้อ 2 |
| T-15 | ไม่มี endpoint ดูโปรไฟล์คนอื่น | `GET /api/users/:id` — คืนคะแนน, breakdown, tags, matchId, conversationId · เช็ค block และซ่อน email |
| T-16 | Push controller โยน `Error` ดิบ | ใช้ `PushTokenDto` — ตอนนี้เป็น 400 จาก ValidationPipe |
| T-17 | ไม่มี Prisma migrations | มี `prisma/migrations/` แล้ว (baseline `0_init` + migration ถัดมา) · deploy ใช้ `prisma migrate deploy` |
| T-18 | ไม่มี API docs | `@nestjs/swagger` ที่ `/api/docs` — ปิดอัตโนมัติตอน production เว้นตั้ง `ENABLE_SWAGGER=true` |
| T-19 | ไม่มี health check | `GET /health` (liveness) และ `GET /health/ready` (เช็ค DB + MinIO, คืน 503 ถ้าพัง) |
| T-20 | Hardening / cleanup | CORS whitelist ตอน production · helmet · `sutId` ถูกบันทึกแล้ว (unique) · บังคับโดเมนอีเมล SUT · เปลี่ยนรหัสผ่านต้องกรอกรหัสเดิม · `package.json` ชื่อ `roommate-match-api` · ลบ script ขยะที่ root · ใช้ Nest `Logger` แทน `console.*` ทั้งหมด · มี global exception filter แปลง error ของ Prisma |
| T-21 | เติมช่องว่างของเทสต์ | unit 15 → **127** (มี spec ให้ `scoring`, `features.service`, `auth.service`, `otp.service`, `app-settings.service`) · e2e 22 → **77** ครอบคลุม discover/swipe/match/chat/notification/admin · e2e ลบข้อมูลที่สร้างทิ้งเองแล้ว |

### งานที่พบเพิ่มระหว่างแก้ (ไม่ได้อยู่ในรายการเดิม)

- **คะแนนจับคู่ไม่ทำงานจริง** — ของเดิมเทียบ `JSON.stringify` ว่าตรงกันเป๊ะไหม ทำให้ทุกคนได้ 70 หรือ 95
  เขียน `src/features/scoring.ts` ใหม่: แปลงคำตอบกลับเป็นค่าที่มีความหมาย แล้ววัดความใกล้เคียง
  (ช่วงเวลา = overlap + ระยะห่างจุดกึ่งกลาง · ชุดตัวเลือก = Jaccard · ตัวเลข = ระยะห่าง normalize)
  ถ่วงน้ำหนักตามที่แอดมินตั้ง แล้วคืน `breakdown` รายหมวดให้หน้าจอ "ทำไมถึง X%" ใช้
- **ฝ่ายที่ยังไม่ทำแบบสอบถามได้คะแนนมั่ว** — ตอนนี้คืน `score: null` และเรียงท้ายสุด แทนที่จะแต่งตัวเลข
- **จำนวนคำถามไม่ตรงกับแอป** — backend มี 6 ข้อ แอปส่งมา 4 หมวด ทำให้ q5/q6 ว่างและดันคะแนนขึ้นทุกคู่
  ปรับ `QUESTION_DEFINITIONS` ให้เหลือ q1–q4 ตรงกับแอป
- **`GET /api/questionnaire` คืนคนละรูปกับที่แอปอ่าน** — แอปอ่าน `{ answers, updatedAt }` แต่ backend คืน array
  ของนิยามคำถาม ทำให้ปุ่ม "ทำใหม่" เริ่มจากค่าว่างตลอด · ตอนนี้คืน `{ questions, answers, updatedAt }`
- **`POST /api/conversations` ไม่มีอยู่จริง** — แอปเรียกตอนกดปุ่มแชทจากหน้า match · เพิ่มแล้ว (ต้อง match กันก่อน)
- **`GET /api/matches` ไม่ส่ง `conversationId`** — แอปต้องใช้เพื่อเปิดห้องแชทให้ถูกห้อง · เพิ่มแล้ว
- **`PUT /api/admin/config` ไม่มี route** — หน้า Admin ยิงมาที่ path นี้แต่ backend มีแค่ `/:key` และ GET คืน array
  ไม่ใช่ object ที่หน้าจอต้องการ · ตอนนี้ GET/PUT รับส่งเป็น object ก้อนเดียว (ยังเก็บ route `/:key` ไว้)
- **`propertyType` หายทั้งเส้น** — แอปเก็บและแสดงผล (On-campus / Off-campus / House / Condo)
  แต่ไม่มี field ใน DB · เพิ่มลง `Profile` + migration แล้ว
- **ตัวกรอง `mustMatch` ค่าไม่ตรงกัน** — แอปส่ง `acTemp` แต่ backend รู้จักแค่ `temperature` → กดแล้วเงียบ
- **`nest build` พัง** หลังเพิ่ม `prisma/seed.ts` (rootDir ขยับ ทำให้ไม่มี `dist/main.js`) · exclude ไว้ใน `tsconfig.build.json`

---

## 2. สิ่งที่ยังเหลือ (จงใจไม่ทำในรอบนี้)

| เรื่อง | เหตุผล |
|---|---|
| แชทเป็น WebSocket/SSE แทน polling | เป็นงานเปลี่ยนสถาปัตยกรรม ไม่ใช่การปิดช่องโหว่ · ตอนนี้ลด cost แล้วด้วยการหยุด poll เมื่อแอปลงพื้นหลัง |
| Refresh token + เพิกถอน token | JWT อายุ 7 วัน ยังใช้ได้ แต่ถ้าจะขึ้น production จริงควรมี |
| คิดคะแนนล่วงหน้า / เก็บลง DB | ตอนนี้จำกัด 500 candidates ต่อคำขอ พอสำหรับขนาดผู้ใช้ปัจจุบัน · ถ้าโตกว่านี้มากต้องเปลี่ยนวิธี |
| ลบไฟล์เก่าใน MinIO ตอนเปลี่ยนรูปโปรไฟล์ | ตอน verify ลบแล้ว แต่รูปโปรไฟล์ที่ถูกแทนที่ยังค้างอยู่ |
