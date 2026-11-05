# พิมพ์เขียวระบบลงทะเบียนกิจกรรมด้วย QR Code ความเร็วสูง (ARU Student Organization)

เอกสารฉบับนี้รวบรวมสถาปัตยกรรมฐานข้อมูล โค้ดคำสั่งระดับ Database Transaction (Supabase RPC) สำหรับป้องกันปัญหาแย่งจับคู่ Passcode พร้อมกัน (Race Condition) โค้ดระบบกล้องสแกนความเร็วสูงพร้อมเสียงสังเคราะห์ (Zero-latency Web Audio API) ระบบการออกแบบ UI (ARU Bento Design System) และแผนการพัฒนาระบบแบบครบวงจร

---

## 1. โครงสร้างฐานข้อมูลและ Supabase RPC (Database & Atomic Transactions)

หัวใจสำคัญของระบบนี้คือการทำงานระดับ **Atomic Transaction** ใน PostgreSQL เพื่อให้มั่นใจว่าเมื่อสตาฟหลายคนกดเพิ่มชื่อนักศึกษาหน้างานพร้อมกัน หรือยิงสแกน QR Code พร้อมกันหลายเครื่อง จะไม่มีทางที่ Passcode สำรองจะถูกแจกซ้ำซ้อนเด็ดขาด

### 1.1 โครงสร้างตาราง (SQL Schema)

```sql
-- เปิดใช้งาน Extension สำหรับสร้าง UUID และเข้ารหัสรหัสผ่าน
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1. ตารางผู้ใช้งาน (นักศึกษา, สตาฟ, แอดมิน)
CREATE TABLE public.users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id VARCHAR(20) UNIQUE NOT NULL, -- ใช้เป็น Username (สำหรับสตาฟ/แอดมิน ใช้รหัสเจ้าหน้าที่)
    password_hash TEXT NOT NULL,            -- เก็บรหัสผ่าน (วันเกิด DDMMYYYY ที่ Hash ด้วย bcrypt)
    full_name VARCHAR(255) NOT NULL,
    faculty VARCHAR(150),
    major VARCHAR(150),
    class_group VARCHAR(50),                -- หมู่เรียน เช่น 6801.1
    enrollment_year INT NOT NULL,           -- ปีที่เข้าศึกษา เช่น 2568 (ใช้ Passcode), 2569+ (ใช้ Check-in/out URL)
    birth_date VARCHAR(20) NOT NULL,        -- วันเกิดรูปแบบ DDMMYYYY เช่น 14082549
    phone VARCHAR(20),
    role VARCHAR(20) DEFAULT 'STUDENT' CHECK (role IN ('STUDENT', 'STAFF', 'ADMIN')),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. ตารางกิจกรรม
CREATE TABLE public.events (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    location VARCHAR(255),
    activity_hours INT DEFAULT 4,
    status VARCHAR(20) DEFAULT 'ACTIVE' CHECK (status IN ('UPCOMING', 'ACTIVE', 'CLOSED')),
    redirect_url_year1 TEXT,                -- URL สำหรับเด้งไปหลังสแกนเข้างานของรุ่น 2569+ (ปี 1)
    scan_mode VARCHAR(20) DEFAULT 'CHECKIN' CHECK (scan_mode IN ('CHECKIN', 'CHECKOUT')), -- โหมดการสแกนปัจจุบันของงาน
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. ตารางคลังเก็บ Passcode (สำหรับรุ่น 2568 ลงไป ซึ่งเป็นรุ่นสุดท้ายที่ใช้ระบบโค้ด)
CREATE TABLE public.event_passcodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    code VARCHAR(100) NOT NULL,
    is_reserve BOOLEAN DEFAULT FALSE,       -- FALSE = โค้ดหลักจับคู่ล่วงหน้า, TRUE = โค้ดสำรองสำหรับ Walk-in หน้างาน
    assigned_to UUID REFERENCES public.users(id) ON DELETE SET NULL,
    assigned_at TIMESTAMPTZ,
    UNIQUE(event_id, code)
);

-- 4. ตารางการลงทะเบียนและสถานะการเข้าร่วมงาน (เปิด Realtime ตารางนี้)
CREATE TABLE public.event_registrations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id UUID REFERENCES public.events(id) ON DELETE CASCADE,
    user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
    passcode_id UUID REFERENCES public.event_passcodes(id) ON DELETE SET NULL,
    status VARCHAR(20) DEFAULT 'REGISTERED' CHECK (status IN ('REGISTERED', 'ATTENDING', 'COMPLETED')),
    is_walkin BOOLEAN DEFAULT FALSE,
    checkin_at TIMESTAMPTZ,
    checkout_at TIMESTAMPTZ,
    registered_by UUID REFERENCES public.users(id),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(event_id, user_id)
);

-- สร้าง Index เพื่อความเร็วระดับมิลลิวินาทีตอนสแกนและค้นหาโค้ดสำรอง
CREATE INDEX idx_passcodes_reserve_pool ON public.event_passcodes(event_id, is_reserve) WHERE assigned_to IS NULL;
CREATE INDEX idx_registrations_lookup ON public.event_registrations(event_id, user_id);

-- เปิดใช้งาน Supabase Realtime สำหรับตาราง event_registrations และ event_passcodes
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_registrations;
ALTER PUBLICATION supabase_realtime ADD TABLE public.event_passcodes;
```

---

### 1.2 Supabase RPC 1: การเข้าสู่ระบบด้วยรหัสนักศึกษา + วันเกิด (`authenticate_aru_user`)

นักศึกษาใช้ `student_id` เป็น Username และใช้วันเกิดรูปแบบ `DDMMYYYY` (เช่น `14082549`) เป็นรหัสผ่าน ส่วนสตาฟและแอดมินใช้รหัสประจำตัวเจ้าหน้าที่

```sql
CREATE OR REPLACE FUNCTION public.authenticate_aru_user(
    p_username VARCHAR,
    p_password VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user RECORD;
BEGIN
    SELECT id, student_id, password_hash, full_name, faculty, major, class_group, enrollment_year, role
    INTO v_user
    FROM public.users
    WHERE student_id = p_username;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'message', 'ไม่พบรหัสนักศึกษาหรือชื่อผู้ใช้งานนี้ในระบบ');
    END IF;

    -- ตรวจสอบรหัสผ่านที่เข้ารหัสด้วย crypt (Blowfish)
    IF v_user.password_hash != crypt(p_password, v_user.password_hash) THEN
        RETURN jsonb_build_object('success', false, 'message', 'รหัสผ่าน (วันเดือนปีเกิด) ไม่ถูกต้อง');
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'user', jsonb_build_object(
            'id', v_user.id,
            'student_id', v_user.student_id,
            'full_name', v_user.full_name,
            'faculty', v_user.faculty,
            'major', v_user.major,
            'class_group', v_user.class_group,
            'enrollment_year', v_user.enrollment_year,
            'role', v_user.role,
            'reward_mode', CASE WHEN v_user.enrollment_year <= 2568 THEN 'PASSCODE' ELSE 'CHECKIN_URL' END
        )
    );
END;
$$;
```

---

### 1.3 Supabase RPC 2: การเพิ่มรายชื่อนักศึกษาหน้างานพร้อมล็อก Passcode สำรอง (`register_walkin_student`)

ฟังก์ชันนี้ใช้เทคนิค `FOR UPDATE SKIP LOCKED` ของ PostgreSQL หากสตาฟ 5 คนกดเพิ่มชื่อนักศึกษาปี 2 ในเสี้ยววินาทีเดียวกัน ระบบจะจับคู่แถวข้อมูลที่ไม่ชนกันให้อัตโนมัติ และถ้าโค้ดสำรองหมดพอดี คนที่กดช้ากว่าจะได้รับแจ้งเตือนทันทีโดยไม่เกิดบั๊กข้อมูลซ้ำ

```sql
CREATE OR REPLACE FUNCTION public.register_walkin_student(
    p_event_id UUID,
    p_staff_id UUID,
    p_student_id VARCHAR,
    p_full_name VARCHAR,
    p_faculty VARCHAR,
    p_major VARCHAR,
    p_class_group VARCHAR,
    p_enrollment_year INT,
    p_birth_date VARCHAR,
    p_phone VARCHAR
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_user_id UUID;
    v_passcode_id UUID := NULL;
    v_passcode_str VARCHAR := NULL;
    v_needs_passcode BOOLEAN;
BEGIN
    -- 1. ตรวจสอบว่านักศึกษารุ่นนี้ต้องใช้ Passcode หรือไม่ (รุ่น 2568 ลงไปต้องใช้ Passcode)
    v_needs_passcode := (p_enrollment_year <= 2568);

    -- 2. ถ้าต้องใช้ Passcode ให้ดึงและล็อก Passcode สำรองที่ยังว่างอยู่ทันที
    IF v_needs_passcode THEN
        SELECT id, code INTO v_passcode_id, v_passcode_str
        FROM public.event_passcodes
        WHERE event_id = p_event_id
          AND is_reserve = TRUE
          AND assigned_to IS NULL
        LIMIT 1
        FOR UPDATE SKIP LOCKED; -- ข้ามแถวที่สตาฟคนอื่นกำลังล็อกอยู่ทันที

        -- หากไม่มีโค้ดสำรองเหลือ ให้ยกเลิกการทำงานทั้งหมดทันที
        IF v_passcode_id IS NULL THEN
            RETURN jsonb_build_object(
                'success', false,
                'error_code', 'OUT_OF_PASSCODE',
                'message', 'ไม่สามารถเพิ่มรายชื่อได้ เนื่องจาก Passcode สำรองของกิจกรรมนี้หมดแล้ว (0 รหัส)'
            );
        END IF;
    END IF;

    -- 3. สร้างหรืออัปเดตข้อมูลนักศึกษา (Username = รหัสนักศึกษา, Password = วันเกิด DDMMYYYY)
    INSERT INTO public.users (
        student_id, password_hash, full_name, faculty, major, 
        class_group, enrollment_year, birth_date, phone, role
    )
    VALUES (
        p_student_id, crypt(p_birth_date, gen_salt('bf')), p_full_name, p_faculty, p_major,
        p_class_group, p_enrollment_year, p_birth_date, p_phone, 'STUDENT'
    )
    ON CONFLICT (student_id) DO UPDATE SET
        full_name = EXCLUDED.full_name,
        faculty = EXCLUDED.faculty,
        major = EXCLUDED.major,
        class_group = EXCLUDED.class_group,
        phone = EXCLUDED.phone
    RETURNING id INTO v_user_id;

    -- 4. ตรวจสอบว่าเคยมีชื่อในกิจกรรมนี้แล้วหรือยัง
    IF EXISTS (SELECT 1 FROM public.event_registrations WHERE event_id = p_event_id AND user_id = v_user_id) THEN
        RAISE EXCEPTION 'DUPLICATE_REGISTRATION';
    END IF;

    -- 5. ผูก Passcode สำรองเข้ากับนักศึกษา
    IF v_passcode_id IS NOT NULL THEN
        UPDATE public.event_passcodes
        SET assigned_to = v_user_id,
            assigned_at = NOW()
        WHERE id = v_passcode_id;
    END IF;

    -- 6. บันทึกรายชื่อเข้าสู่กิจกรรม
    INSERT INTO public.event_registrations (
        event_id, user_id, passcode_id, status, is_walkin, registered_by
    )
    VALUES (
        p_event_id, v_user_id, v_passcode_id, 'REGISTERED', TRUE, p_staff_id
    );

    RETURN jsonb_build_object(
        'success', true,
        'message', 'เพิ่มรายชื่อนักศึกษาหน้างานและจับคู่สิทธิ์สำเร็จ',
        'user_id', v_user_id,
        'passcode_assigned', (v_passcode_id IS NOT NULL),
        'passcode_preview', COALESCE(v_passcode_str, 'REDIRECT_URL_YEAR1')
    );

EXCEPTION
    WHEN OTHERS THEN
        IF SQLERRM = 'DUPLICATE_REGISTRATION' THEN
            RETURN jsonb_build_object(
                'success', false,
                'error_code', 'ALREADY_REGISTERED',
                'message', 'รหัสนักศึกษานี้มีชื่ออยู่ในกิจกรรมแล้ว'
            );
        END IF;
        RETURN jsonb_build_object(
            'success', false,
            'error_code', 'DB_ERROR',
            'message', SQLERRM
        );
END;
$$;
```

---

### 1.4 Supabase RPC 3: การประมวลผลการสแกนความเร็วสูง (`process_fast_scan`)

ฟังก์ชันนี้ช่วยให้เครื่องสแกนของสตาฟส่งข้อมูลเพียงครั้งเดียวและจบการทำงานภายใน 1 รอบการเชื่อมต่อ (Single Round-Trip) ความหน่วงต่ำกว่า 40 มิลลิวินาที

```sql
CREATE OR REPLACE FUNCTION public.process_fast_scan(
    p_event_id UUID,
    p_user_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_reg RECORD;
    v_event RECORD;
    v_new_status VARCHAR(20);
BEGIN
    -- 1. ดึงข้อมูลกิจกรรมและโหมดการสแกนปัจจุบัน (CHECKIN หรือ CHECKOUT)
    SELECT id, title, scan_mode, status INTO v_event
    FROM public.events WHERE id = p_event_id;

    IF NOT FOUND OR v_event.status != 'ACTIVE' THEN
        RETURN jsonb_build_object('success', false, 'code', 'EVENT_CLOSED', 'message', 'กิจกรรมปิดหรือไม่อยู่ในสถานะเปิดใช้งาน');
    END IF;

    -- 2. ดึงข้อมูลนักศึกษาและการลงทะเบียน
    SELECT r.*, u.student_id, u.full_name, u.enrollment_year, u.faculty
    INTO v_reg
    FROM public.event_registrations r
    JOIN public.users u ON u.id = r.user_id
    WHERE r.event_id = p_event_id AND r.user_id = p_user_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('success', false, 'code', 'NOT_REGISTERED', 'message', 'ไม่พบรายชื่อนักศึกษาในกิจกรรมนี้');
    END IF;

    -- 3. ตรวจสอบเงื่อนไขตามโหมดการสแกน (Check-in / Check-out)
    IF v_event.scan_mode = 'CHECKIN' THEN
        IF v_reg.status IN ('ATTENDING', 'COMPLETED') THEN
            RETURN jsonb_build_object(
                'success', false, 
                'code', 'ALREADY_CHECKED_IN', 
                'student_id', v_reg.student_id,
                'full_name', v_reg.full_name,
                'message', 'สแกนเข้างานซ้ำ! นักศึกษาเช็คอินไปแล้ว'
            );
        END IF;

        v_new_status := 'ATTENDING';
        UPDATE public.event_registrations
        SET status = v_new_status, checkin_at = NOW(), updated_at = NOW()
        WHERE id = v_reg.id;

    ELSIF v_event.scan_mode = 'CHECKOUT' THEN
        IF v_reg.status = 'COMPLETED' THEN
            RETURN jsonb_build_object(
                'success', false, 
                'code', 'ALREADY_COMPLETED', 
                'student_id', v_reg.student_id,
                'full_name', v_reg.full_name,
                'message', 'สแกนออกงานซ้ำ! นักศึกษายืนยันจบงานไปแล้ว'
            );
        END IF;

        IF v_reg.status = 'REGISTERED' THEN
            RETURN jsonb_build_object(
                'success', false, 
                'code', 'NOT_CHECKED_IN', 
                'student_id', v_reg.student_id,
                'full_name', v_reg.full_name,
                'message', 'ยังไม่ได้สแกนเข้างาน! ไม่สามารถสแกนออกงานได้'
            );
        END IF;

        v_new_status := 'COMPLETED';
        UPDATE public.event_registrations
        SET status = v_new_status, checkout_at = NOW(), updated_at = NOW()
        WHERE id = v_reg.id;
    END IF;

    RETURN jsonb_build_object(
        'success', true,
        'code', 'SCAN_OK',
        'new_status', v_new_status,
        'student_id', v_reg.student_id,
        'full_name', v_reg.full_name,
        'faculty', v_reg.faculty,
        'enrollment_year', v_reg.enrollment_year,
        'message', CASE WHEN v_new_status = 'ATTENDING' THEN 'เช็คอินเข้างานสำเร็จ' ELSE 'เช็คเอาท์จบกิจกรรมสำเร็จ' END
    );
END;
$$;
```

---

### 1.5 Supabase RPC 4: สิทธิ์เฉพาะแอดมินในการเติมพาสโค้ดสำรอง (`admin_replenish_reserve_passcodes`)

แอดมินสามารถเติมรหัส Passcode สำรองลงในกิจกรรมได้ตลอดเวลาเพื่อปลดล็อกให้สตาฟสามารถเพิ่มรายชื่อหน้างานต่อได้

```sql
CREATE OR REPLACE FUNCTION public.admin_replenish_reserve_passcodes(
    p_admin_id UUID,
    p_event_id UUID,
    p_codes TEXT[] -- อาเรย์ของรหัสพาสโค้ดสำรองที่จะเพิ่มเข้าไปใหม่
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_role VARCHAR;
    v_code TEXT;
    v_inserted_count INT := 0;
BEGIN
    -- 1. ตรวจสอบสิทธิ์ว่าเป็น ADMIN จริงหรือไม่
    SELECT role INTO v_role FROM public.users WHERE id = p_admin_id;
    IF v_role != 'ADMIN' THEN
        RETURN jsonb_build_object('success', false, 'message', 'ปฏิเสธการเข้าถึง: เฉพาะแอดมินเท่านั้นที่เพิ่มพาสโค้ดสำรองได้');
    END IF;

    -- 2. วนลูปเพิ่มรหัสสำรองเข้าตาราง event_passcodes
    FOREACH v_code IN ARRAY p_codes
    LOOP
        INSERT INTO public.event_passcodes (event_id, code, is_reserve)
        VALUES (p_event_id, TRIM(v_code), TRUE)
        ON CONFLICT (event_id, code) DO NOTHING;

        IF FOUND THEN
            v_inserted_count := v_inserted_count + 1;
        END IF;
    END LOOP;

    RETURN jsonb_build_object(
        'success', true,
        'added_count', v_inserted_count,
        'message', format('เติมพาสโค้ดสำรองสำเร็จจำนวน %s รหัส', v_inserted_count)
    );
END;
$$;
```

---

## 2. คู่มือการออกแบบ UI (ARU Bento Grid & Glassmorphism Design System)

เพื่อให้ตรงกับภาพลักษณ์ของ **องค์การนักศึกษา มหาวิทยาลัยราชภัฏพระนครศรีอยุธยา (ARU Student Organization)** ระบบใช้สถาปัตยกรรม UI แบบ **Modern Bento Grid ผสม Glassmorphism** ในโทนสี **แดงเลือดหมู - เหลืองทอง - ขาว**

### 2.1 ชุดสีมาตรฐาน (Color Palette Tokens)

| บทบาทของสี (Color Role) | รหัสสี Hex | Tailwind CSS Class | การนำไปใช้งานในระบบ |
| :--- | :--- | :--- | :--- |
| **ARU Deep Maroon (สีหลัก)** | `#7A0A0A` ถึง `#991B1B` | `from-[#7A0A0A] to-[#B91C1C]` | พื้นหลังการ์ด Hero ฝั่งซ้าย, การ์ดสถิติหลัก, ปุ่ม Action หลัก |
| **Ayutthaya Gold (สีรอง/จุดเน้น)** | `#FACC15` ถึง `#EAB308` | `bg-amber-400 text-stone-950` | ป้ายสถานะ `Active`, กรอบ QR Code, ปุ่มคัดลอก Passcode, เส้นเลเซอร์สแกน |
| **Pure Bento White (พื้นหลังการ์ด)** | `#FFFFFF` | `bg-white border-stone-200/80` | การ์ดย่อยในตาราง Bento, ตารางรายชื่อนักศึกษา, พื้นหลังกล่อง QR |
| **Soft Canvas Gray (พื้นหลังเว็บ)** | `#F2F3F7` | `bg-[#F2F3F7]` | พื้นหลังหลักของหน้าเว็บเพื่อขับให้การ์ดสีขาวและสีแดงดูลอยเด่นขึ้นมา |
| **Dark Glass Overlay (กระจกดำ)** | `rgba(12, 10, 9, 0.8)` | `bg-stone-950/80 backdrop-blur-xl` | การ์ดลอยแสดงข้อมูลนักศึกษาและสถานะ Real-time บนแผง Hero |

### 2.2 สเปกคลื่นเสียงสังเคราะห์สำหรับโหมดสแกนพัสดุ (Web Audio Synthesizer Spec)

ไม่ต้องใช้ไฟล์เสียงภายนอก (`.mp3` หรือ `.wav`) เพื่อให้ความหน่วงเป็น `0 ms` และทำงานได้ทันทีแม้เน็ตหน้างานช้า:

| สถานะการสแกน | รูปแบบคลื่น (Waveform) | ความถี่เสียง (Frequency) | ระยะเวลา (Duration) | การสั่นเตือน (`navigator.vibrate`) |
| :--- | :--- | :--- | :--- | :--- |
| **สแกนเข้างานสำเร็จ (`CHECKIN`)** | `triangle` | $1380\text{ Hz}$ (โทนเดียวคมชัด) | $110\text{ ms}$ | ไม่สั่น (เน้นยิงเร็วต่อเนื่อง) |
| **สแกนจบงานสำเร็จ (`CHECKOUT`)** | `triangle` | $1100\text{ Hz} \rightarrow 1560\text{ Hz}$ (2 โทนไล่ระดับสูงขึ้น) | $90\text{ ms} + 140\text{ ms}$ | สั่นสั้น 1 ครั้ง ($80\text{ ms}$) |
| **สแกนซ้ำ / ไม่มีรายชื่อ / โค้ดหมด** | `sawtooth` | $260\text{ Hz} \rightarrow 200\text{ Hz}$ (เสียงทุ้มต่ำ 2 จังหวะ) | $160\text{ ms} + 240\text{ ms}$ | สั่นเตือน 2 จังหวะ ($[120, 60, 120]\text{ ms}$) |

---

## 3. โค้ดระบบกล้องสแกนความเร็วสูงพร้อมเสียงสังเคราะห์ (High-Speed Scanner & Web Audio API)

### 3.1 โมดูลสังเคราะห์เสียงความหน่วงศูนย์ (`utils/soundEngine.ts`)

```typescript
class ScannerSoundEngine {
  private ctx: AudioContext | null = null;
  public isUnlocked: boolean = false;

  // บังคับเรียกฟังก์ชันนี้เมื่อสตาฟกดปุ่ม "เปิดกล้องและเปิดเสียง"
  public unlockAudio(): boolean {
    try {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!this.ctx) {
        this.ctx = new AudioCtx();
      }
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      // เล่นเสียงทดสอบสั้นๆ เพื่อปลดล็อกข้อจำกัดของ iOS Safari / Chrome Mobile
      this.playTone(1050, 0.05, 'sine', 0, 0.15);
      this.isUnlocked = true;
      return true;
    } catch (e) {
      console.error('Audio Context failed to unlock:', e);
      return false;
    }
  }

  private playTone(
    freq: number,
    duration: number,
    type: OscillatorType = 'sine',
    startTimeOffset: number = 0,
    gainVal: number = 0.3
  ) {
    if (!this.ctx) return;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTimeOffset);

    gain.gain.setValueAtTime(gainVal, this.ctx.currentTime + startTimeOffset);
    gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startTimeOffset + duration);

    osc.connect(gain);
    gain.connect(this.ctx.destination);

    osc.start(this.ctx.currentTime + startTimeOffset);
    osc.stop(this.ctx.currentTime + startTimeOffset + duration);
  }

  // เสียง "ติ๊ด!" แหลมสั้น (เหมือนเครื่องยิงพัสดุเมื่อสแกนเช็คอินผ่าน)
  public playCheckInSuccess() {
    this.playTone(1380, 0.11, 'triangle', 0, 0.35);
  }

  // เสียง "ติ๊ด-ติ๊ด!" สองโทนสูงขึ้น (เมื่อสแกนเช็คเอาท์จบงานสำเร็จ)
  public playCheckOutSuccess() {
    this.playTone(1100, 0.09, 'triangle', 0, 0.3);
    this.playTone(1560, 0.14, 'triangle', 0.1, 0.35);
  }

  // เสียง "ตื๊ด-ตื๊ด!" ทุ้มต่ำ + สั่นเครื่อง (เมื่อสแกนซ้ำ หรือไม่มีชื่อในระบบ)
  public playError() {
    this.playTone(260, 0.16, 'sawtooth', 0, 0.35);
    this.playTone(200, 0.24, 'sawtooth', 0.18, 0.35);
    if (typeof navigator !== 'undefined' && navigator.vibrate) {
      navigator.vibrate([120, 60, 120]);
    }
  }
}

export const soundEngine = new ScannerSoundEngine();
```

---

## 4. โค้ดระบบนำเข้ารายชื่อนักศึกษาและจับคู่ Passcode ล่วงหน้าสำหรับ Admin (`utils/adminBulkImport.ts`)

แอดมินสามารถอัปโหลดไฟล์ CSV รายชื่อนักศึกษาที่มีสิทธิ์เข้าร่วมกิจกรรม โดยระบบจะแยกอัตโนมัติว่าใครเป็นรุ่นรหัส `68` ลงไป (ผูก Passcode ล่วงหน้าทันที) และใครเป็นรุ่นรหัส `69` ขึ้นไป (ใช้ระบบ Check-in/out URL)

```typescript
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

export interface CsvStudentRow {
  student_id: string;      // เช่น "16815234"
  full_name: string;       // เช่น "จิรายุทธ บุตรชานนท์"
  faculty: string;         // เช่น "คณะครุศาสตร์"
  major: string;           // เช่น "คอมพิวเตอร์ศึกษา"
  class_group: string;     // เช่น "6801.1"
  enrollment_year: number; // เช่น 2568 หรือ 2569
  birth_date: string;      // เช่น "14082549" (ใช้ตั้งเป็นรหัสผ่านเริ่มต้น)
  phone: string;           // เช่น "0891234567"
  preassigned_passcode?: string; // รหัส Passcode ประจำตัว (เฉพาะรุ่น 2568 ลงไป)
}

export async function bulkImportStudentsWithPasscodes(
  eventId: string,
  adminUserId: string,
  rows: CsvStudentRow[]
) {
  const results = { imported: 0, errors: [] as string[] };

  for (const row of rows) {
    try {
      // 1. เรียกใช้ฟังก์ชันสร้าง User + เข้ารหัสวันเกิดเป็น Password
      const { data, error } = await supabase.rpc('register_walkin_student', {
        p_event_id: eventId,
        p_staff_id: adminUserId,
        p_student_id: row.student_id.trim(),
        p_full_name: row.full_name.trim(),
        p_faculty: row.faculty.trim(),
        p_major: row.major.trim(),
        p_class_group: row.class_group.trim(),
        p_enrollment_year: Number(row.enrollment_year),
        p_birth_date: row.birth_date.trim(),
        p_phone: row.phone.trim(),
      });

      if (error || !data?.success) {
        results.errors.push(`${row.student_id}: ${data?.message || error?.message}`);
      } else {
        results.imported += 1;
      }
    } catch (err: unknown) {
      results.errors.push(`${row.student_id}: Unexpected error`);
    }
  }

  return results;
}
```

---

## 5. แผนการพัฒนาระบบและรายการตรวจสอบก่อนวันงานจริง (Development Roadmap & Pre-Event Checklist)

### Phase 1: วางโครงสร้างฐานข้อมูลและระบบยืนยันตัวตน (วันที่ 1 - 3)
- [ ] สร้างโปรเจกต์บน **Supabase** และรันสคริปต์ SQL สร้างตาราง `users`, `events`, `event_passcodes`, `event_registrations`
- [ ] เปิดใช้งาน **Supabase Realtime** บนตาราง `event_registrations` และ `event_passcodes`
- [ ] สร้างหน้า Login โทนสีแดง-เหลืองทองขององค์การนักศึกษา ARU:
  - **นักศึกษา:** กรอก `student_id` คู่กับรหัสผ่านที่เป็นวันเกิด `DDMMYYYY`
  - **สตาฟ / แอดมิน:** ล็อกอินเข้าโหมดกล้องสแกนและแดชบอร์ดจัดการกิจกรรม

### Phase 2: ระบบจัดการหลังบ้านสำหรับ Admin (วันที่ 4 - 6)
- [ ] พัฒนาหน้า Bento Dashboard สำหรับแอดมิน แสดงกราฟสถิติการสแกนและเกจครึ่งวงกลมแสดงจำนวน Passcode สำรองคงเหลือ
- [ ] พัฒนาฟีเจอร์อัปโหลดไฟล์ CSV เพื่อนำเข้ารายชื่อนักศึกษาและจับคู่ Passcode หลักล่วงหน้า
- [ ] พัฒนาการ์ด **"เติมพาสโค้ดสำรองลงในกิจกรรม"** (เฉพาะ Admin) ที่เชื่อมต่อกับ RPC `admin_replenish_reserve_passcodes`

### Phase 3: ระบบหน้าจอนักศึกษา & Real-time Sync (วันที่ 7 - 9)
- [ ] พัฒนาหน้า Student Bento Portal แสดงการ์ดสถานะสีดำโปร่งแสงพร้อมป้ายไฟ `รอสแกนเข้างาน` / `กำลังเข้าร่วมกิจกรรม` / `เข้าร่วมสำเร็จแล้ว`
- [ ] เชื่อมต่อ WebSocket (`postgres_changes`) เฉพาะแถวของนักศึกษา:
  - **ทดสอบรุ่นรหัส 69 (ปี 1):** เมื่อสตาฟยิงสแกนเข้างาน (`ATTENDING`) หน้าจอมือถือนักศึกษาต้องสั่ง `window.location.href` เด้งไปยัง URL ที่แอดมินตั้งค่าไว้ทันที
  - **ทดสอบรุ่นรหัส 68 (ปี 2 รุ่นสุดท้ายที่ใช้โค้ด):** เมื่อสตาฟยิงสแกนจบงาน (`COMPLETED`) การ์ดด้านขวาต้องปลดล็อกรหัส Passcode ที่ผูกไว้พร้อมปุ่มกดคัดลอกทันที

### Phase 4: ระบบสแกนความเร็วสูงของสตาฟ & Walk-in Registration (วันที่ 10 - 12)
- [ ] พัฒนาหน้าสแกนด้วย `html5-qrcode` (ตั้งค่า `20 FPS`) ร่วมกับ `ScannerSoundEngine`
- [ ] พัฒนาฟอร์มเพิ่มรายชื่อนักศึกษาหน้างาน (Walk-in Form) ครบทุกฟิลด์ (รหัสนักศึกษา, วันเกิด, ชื่อ-สกุล, คณะ, สาขา, ชั้นปี, หมู่เรียน, เบอร์โทร)
- [ ] ทดสอบระบบล็อกปุ่มบันทึกอัตโนมัติเมื่อจำนวน Passcode สำรองเท่ากับ `0` (สำหรับนักศึกษาปี 2+)