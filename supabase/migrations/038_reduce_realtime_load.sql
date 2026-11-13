-- 038_reduce_realtime_load.sql
-- ลดภาระ Realtime และ Memory Commitment โดยไม่กระทบข้อมูลหรือการสแกน
--
-- 1. ปลด Trigger sessions_broadcast_admin_dashboard ออกจาก app_sessions
--    ทุก heartbeat (ทุก 15-60 วินาทีต่อผู้ใช้) จะไม่ยิง realtime.send() อีกต่อไป
--    แอดมินจะได้ตัวเลขออนไลน์จาก polling เบาๆ ที่ฝั่งเว็บแทน
--
-- 2. ปรับ Trigger registrations_broadcast_admin_dashboard เป็น FOR EACH STATEMENT
--    เมื่อผูกรายชื่อเข้ากิจกรรมเป็นชุด จะแจ้งแอดมินแค่ 1 ครั้งต่อชุด
--    การสแกนนักศึกษาทีละคน ยังคงกระตุ้น statement trigger ได้ปกติ
--
-- 3. ปรับ Trigger passcodes_broadcast_admin_dashboard เป็น FOR EACH STATEMENT
--    เมื่อนำเข้า Passcode ทีละ 50 รหัส จะแจ้งแอดมินแค่ 1 ครั้ง
--
-- 4. คง events_broadcast_admin_dashboard แบบ FOR EACH ROW ไว้
--    เปลี่ยนค่ากิจกรรมนานๆ ที เปลี่ยนที่ละแถว ไม่เป็นภาระ
--
-- 5. คง event_registrations_broadcast_student_status ไว้ 100%
--    นักศึกษายังคงได้รับสถานะสแกนแบบ Realtime ทันทีเหมือนเดิม
--
-- ไม่มี ALTER TABLE, ไม่ลบข้อมูล, ไม่ปรับ RPC สแกน

begin;

-- Statement-level broadcast function for bulk changes
create or replace function public.broadcast_admin_event_dashboard_change_stmt()
returns trigger
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_session record;
begin
  for v_session in
    select s.token_hash
    from public.app_sessions s
    join public.users u on u.id = s.user_id
    where u.role = 'ADMIN' and s.expires_at > now()
  loop
    perform realtime.send(
      jsonb_build_object(
        'changed_at', clock_timestamp(),
        'source_table', tg_table_name,
        'operation', tg_op
      ),
      'dashboard_changed',
      'aru-admin-dashboard:' || v_session.token_hash,
      true
    );
  end loop;
  return null;
end;
$$;

-- ===== 1. ปลด trigger จาก app_sessions =====
-- Heartbeat จะไม่ส่ง Realtime broadcast ให้แอดมินอีกต่อไป
drop trigger if exists sessions_broadcast_admin_dashboard on public.app_sessions;

-- ===== 2. ปรับ registrations trigger เป็น statement-level =====
drop trigger if exists registrations_broadcast_admin_dashboard on public.event_registrations;
create trigger registrations_broadcast_admin_dashboard
  after insert or update or delete on public.event_registrations
  for each statement execute function public.broadcast_admin_event_dashboard_change_stmt();

-- ===== 3. ปรับ passcodes trigger เป็น statement-level =====
drop trigger if exists passcodes_broadcast_admin_dashboard on public.event_passcodes;
create trigger passcodes_broadcast_admin_dashboard
  after insert or update or delete on public.event_passcodes
  for each statement execute function public.broadcast_admin_event_dashboard_change_stmt();

notify pgrst, 'reload schema';
commit;
