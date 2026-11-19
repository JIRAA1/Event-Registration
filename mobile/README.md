# ARU Event Pass mobile

ติดตั้ง dependencies ที่รากของโปรเจกต์ด้วย npm ci แล้วรัน npm ci --prefix mobile
ตัว build อ่าน NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY จาก environment หรือ .env.local ของเว็บ ใช้เฉพาะ publishable/anon key สำหรับ client
สำหรับทดสอบ ให้ตั้งสองค่านี้เป็นของโปรเจกต์ทดสอบ และตั้ง EVENT_PASS_PUBLIC_SITE ให้ตรงกับเว็บทดสอบสำหรับลิงก์ที่แชร์ให้นักศึกษา

รัน npm run sync --prefix mobile เพื่อ build หน้าจอและคัดลอกลงโปรเจกต์ Android และ iOS

## Android
เปิด mobile/android ใน Android Studio พร้อม SDK 36 และ JDK 21 เลือกเครื่องแล้วกด Run หรือรัน gradlew.bat assembleDebug ในโฟลเดอร์นั้น
ไฟล์ทดสอบอยู่ที่ app/build/outputs/apk/debug/app-debug.apk
อีกวิธี หลัง push workflow ให้ตั้ง repository variables NEXT_PUBLIC_SUPABASE_URL และ NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY แล้วสั่ง Build Android test APK ใน GitHub Actions ดาวน์โหลด artifact เมื่อ build ผ่าน
สำหรับเผยแพร่ต้องตั้ง release signing ขององค์กร

## iOS
บน Mac หลัง sync ให้เปิด mobile/ios/App/App.xcodeproj ใน Xcode เลือก Signing Team และ Bundle Identifier ขององค์กร แล้ว Run บน iPhone
สำหรับแจกหลายเครื่องใช้ Archive และ TestFlight ผ่านบัญชี Apple Developer ขององค์กร

## ก่อนแจก
ทดสอบการอนุญาตกล้อง สแกนเข้าและออก เปิดลิงก์หลังสแกน สลับแอปแล้วกลับมา และการล็อกอินอีกครั้งบนเครื่องจริงด้วยกิจกรรมและบัญชีทดสอบ
