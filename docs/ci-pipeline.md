# CI Pipeline — Backend (roommate-mach-be)

ไฟล์เดียวที่คุมทุกอย่างคือ [`.github/workflows/ci.yml`](../.github/workflows/ci.yml)
รันบน **GitHub Actions** (`ubuntu-latest`, Node 22)

## รันเมื่อไหร่

| เหตุการณ์ | รัน |
|---|---|
| `push` ขึ้น `main` | ✅ ทุก job |
| เปิด/อัปเดต pull request | ✅ ทุก job |
| กดเอง (`workflow_dispatch`) | ✅ ทุก job |

ถ้า push ซ้ำบน branch เดิม รันเก่าที่ยังค้างจะถูกยกเลิก (`concurrency` + `cancel-in-progress`)
เพราะไม่มีประโยชน์ที่จะรอผลของ commit ที่ถูกแทนไปแล้ว

## Stage ทั้ง 5

```
                   ┌── Lint ────────────┐
                   ├── Unit tests ──────┤
push / PR ─────────┼── Build ───────────┼──► CI passed
                   ├── E2E tests ───────┤
                   └── Docker image ────┘
```

ทั้ง 5 job รัน **ขนานกัน** (ไม่มี `needs` ระหว่างกัน) เวลารวมจึงเท่ากับ job ที่ช้าที่สุด
ไม่ใช่ผลบวกของทุก job

| # | Job | ทำอะไร | พังแปลว่า |
|---|---|---|---|
| 1 | **Lint** | `npm run lint:ci` — ESLint + Prettier แบบ `--max-warnings=0` | โค้ดผิดสไตล์ หรือมี type ที่ไม่ปลอดภัย |
| 2 | **Unit tests** | `npm run test:cov` — Jest 12 suites / 171 tests + coverage | ตรรกะภายใน service พัง |
| 3 | **Build** | `npm run build` (nest build) | TypeScript คอมไพล์ไม่ผ่าน / deploy ไป Vercel ไม่ได้ |
| 4 | **E2E tests** | ยก Postgres + MinIO จริงขึ้นมา แล้วยิง HTTP 77 เคส | API สัญญาเปลี่ยนไปจากที่ client คาดไว้ |
| 5 | **Docker image** | `docker build` ตาม `Dockerfile` (ไม่ push) | Dockerfile เน่าโดยไม่มีใครรู้ |

ปิดท้ายด้วย job **`CI passed`** ที่รวมผลของทั้ง 5 job เป็นเช็คเดียว —
ตั้ง branch protection ให้บังคับแค่อันนี้อันเดียว เพิ่ม stage ทีหลังก็ไม่ต้องกลับไปแก้ setting อีก

## E2E ใช้ของจริง ไม่ mock

job นี้ต้องมีทั้งฐานข้อมูลและที่เก็บไฟล์ เพราะ suite ยิงผ่าน HTTP ตั้งแต่สมัครสมาชิก
ยัน อัปโหลดรูปโปรไฟล์

- **Postgres 16** — ประกาศเป็น `services:` ให้ GitHub ดูแล health check ให้
  จากนั้น `npx prisma migrate deploy` ลง schema จาก `prisma/migrations/`
- **MinIO** — สั่ง `docker run` เองในขั้นตอนหนึ่ง เพราะ image ต้องการ argument
  `server /data` ซึ่ง `services:` ส่งให้ไม่ได้ แล้ว poll `/minio/health/live` จนกว่าจะพร้อม
  (bucket ถูกสร้างอัตโนมัติโดย `MinioStorage.onModuleInit`)
- ค่า env ทั้งหมดเป็นค่า throwaway ของ CI (`JWT_SECRET`, `minioadmin`) — **ไม่มี secret จริง
  อยู่ในไฟล์ workflow** และ `ALLOW_DEV_OTP=true` ทำให้ล็อกอินด้วยรหัส `123456` ได้โดยไม่ต้องมีเมล

ถ้า job นี้พัง จะมีขั้นตอน `docker logs minio` ทำงานให้อัตโนมัติเพื่อดูสาเหตุ

## ของที่ได้กลับมา (Artifacts)

| ชื่อ | คือ | เก็บไว้ |
|---|---|---|
| `backend-coverage` | รายงาน coverage ของ Jest (เปิด `index.html` ดูได้) | 14 วัน |
| `backend-dist` | ผลลัพธ์ `nest build` | 7 วัน |

## รันแบบเดียวกันในเครื่อง

```bash
docker compose up -d          # Postgres + MinIO
npm ci
npx prisma generate
npm run lint:ci               # stage 1
npm run test:cov              # stage 2
npm run build                 # stage 3
npx prisma migrate deploy
npm run test:e2e              # stage 4
docker build -t roommate-match-api:ci .   # stage 5
```

## ต่อยอด

- **Branch protection**: Settings → Branches → กติกาสำหรับ `main` → require status check
  `CI passed` และ require PR ก่อน merge
- **CD**: ตอนนี้ Vercel deploy จาก `main` เองผ่าน `vercel-build` — เมื่อเปิด branch protection แล้ว
  จะกลายเป็น "merge ได้ก็ต่อเมื่อ CI เขียว" โดยอัตโนมัติ
