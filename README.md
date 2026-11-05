# ARU Event Pass

เว็บแอประบบลงทะเบียนและเช็กอินกิจกรรมสำหรับองค์การนักศึกษา มหาวิทยาลัยราชภัฏพระนครศรีอยุธยา

## เริ่มใช้งาน

1. ติดตั้ง Node.js 20 ขึ้นไป แล้วรัน `npm install`
2. เริ่มเว็บด้วย `npm run dev` และเปิด `http://localhost:3000`
3. ถ้ายังไม่ใส่ Supabase credentials แอปจะเปิด **Demo Mode** และบันทึกข้อมูลตัวอย่างในเบราว์เซอร์
4. เลือกเข้าสู่ระบบนักศึกษา / โหมดสตาฟ / ผู้ดูแลระบบ เพื่อทดลองแต่ละหน้าจอ

## เชื่อมต่อ Supabase Cloud

1. สร้าง Supabase project แล้วรันไฟล์ใน `supabase/migrations/` ตามลำดับเลขใน SQL Editor หากใช้โปรเจกต์เดิม ให้รันเฉพาะ migration ที่ยังไม่เคยรัน โดยเรียงตามเลข (โปรเจกต์ที่ตั้งค่าถึง `002` แล้ว ต้องรัน `003` ถึง `006`)
2. คัดลอก `.env.example` เป็น `.env.local` แล้วกรอก Project URL กับ publishable key จาก Project Settings → API Keys
3. ปิดและเปิด dev server ใหม่
4. ตรวจว่า `event_registrations` และ `event_passcodes` อยู่ใน publication `supabase_realtime` (migration เพิ่มให้เมื่อ publication มีอยู่แล้ว)

สร้างบัญชี ADMIN คนแรกครั้งเดียวใน SQL Editor โดยเปลี่ยน username, password และชื่อเป็นค่าที่ต้องการก่อนรัน จากนั้นเพิ่ม STAFF/ADMIN คนอื่นผ่านหน้า Admin:

```sql
alter table public.users alter column birth_date drop not null;

insert into public.users (student_id, password_hash, full_name, enrollment_year, birth_date, role)
values ('admin001', crypt('CHANGE-THIS-TO-A-STRONG-PASSWORD', gen_salt('bf')), 'ARU System Admin', 0, null, 'ADMIN');
```

ไฟล์ [`lib/sound.ts`](lib/sound.ts) จัดการ Web Audio Synthesizer และ `lib/supabase.ts` สร้าง Supabase client เมื่อมีค่าตั้งต้น

## บัญชีตัวอย่างใน Demo Mode

- นักศึกษา: รหัส `6801234` · วันเกิด `22062549`
- สตาฟ: เลือก “เข้าสู่โหมดสตาฟ”
- แอดมิน: เลือก “ผู้ดูแลระบบ”

ในหน้า Admin สามารถสร้างบัญชี STAFF หรือ ADMIN ได้ โดยฐานข้อมูลจะเก็บรหัสผ่านเป็น bcrypt hash และ RPC จะตรวจ admin session token ก่อนเพิ่มบัญชี

ฟอร์มลงทะเบียนหน้างานเลือกคณะและสาขาจากรายการ ARU ที่กำหนดไว้ใน `lib/aru-catalog.ts` แทนการพิมพ์เอง โดยอ้างอิงรายการหลักสูตรจาก [กองบริการการศึกษา ARU](https://www.aru.ac.th/regis/index.php?page=fieldstd) หน้ารายงานผู้เข้าร่วมกรองตามคณะ/สาขาและส่งออก CSV ได้

กล้องต้องเปิดเว็บผ่าน HTTPS หรือ `http://localhost` และอนุญาตสิทธิ์ Camera ในเบราว์เซอร์ หากเปิดจาก IP บนเครือข่ายผ่าน HTTP เบราว์เซอร์จะปิดกั้นการเข้าถึงกล้อง

เครื่องสแกนมีช่องทดสอบ QR ที่รับ payload รูปแบบ `{"e":"evt-aru-01","u":"stu-aru-6801234"}` ได้โดยไม่ต้องเปิดกล้อง

## ฟอร์แมต CSV

ไฟล์ CSV ให้ใช้แถวแรกเป็นหัวตาราง รองรับทั้งชื่อคอลัมน์ภาษาอังกฤษและภาษาไทย โดยเรียงคอลัมน์ตามนี้:

```text
student_id,full_name,faculty,major,class_group,study_year,birth_date,phone
รหัสนักศึกษา,ชื่อ-นามสกุล,คณะ,สาขาวิชา,หมู่เรียน,ชั้นปี,วันเกิด,เบอร์โทรศัพท์
```

ระบุชั้นปีปัจจุบันเป็นเลข 1–8 (รับเลขไทยได้) และวันเกิดรูปแบบ `วว/ดด/ปปปป` หรือเลข 8 หลัก ระบบรองรับไฟล์ CSV แบบ UTF-8 ที่คั่นด้วย comma หรือ semicolon หัวตาราง `enrollment_year` แบบเดิมยังนำเข้าได้ แต่แนะนำให้ใช้ `study_year` แทน

แอดมินเติม Passcode สำรองไว้ในกิจกรรม แล้วระบบจับคู่ให้อัตโนมัติตามชั้นปีปัจจุบันและปีการศึกษาปัจจุบัน ส่วนรุ่นปี 1 ใช้ QR check-in/check-out

## ขอบเขตการเชื่อมต่อ

Demo Mode เก็บข้อมูลใน local storage และรองรับ flow สำหรับสาธิต Student, Staff, Walk-in และ Admin
การเชื่อมต่อ Supabase ในชุดเริ่มต้นเปิดใช้งาน login RPC, scan RPC และ Realtime subscription; ก่อนนำไปใช้จริงควรเพิ่ม RPC สำหรับโหลด/จัดการข้อมูลกิจกรรม และเปลี่ยน custom login ให้ผูกกับ Supabase Auth หรือ server session ที่ตรวจสอบได้ เนื่องจาก anon key เป็นข้อมูลสาธารณะและไม่ควรใช้ user ID จาก browser เป็นหลักฐานสิทธิ์
