begin;

create table event_pass_private.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null,
  user_id uuid not null,
  admin_id uuid not null,
  reason text not null,
  before_state jsonb not null,
  after_state jsonb not null,
  created_at timestamptz not null default now()
);

create function public.admin_correct_attendance(p_token text,p_event uuid,p_user uuid,p_expected_status text,p_status text,p_reason text)
returns void language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor uuid:=event_pass_private.admin_id(p_token); r public.event_registrations%rowtype; changed public.event_registrations%rowtype;
begin
  if actor is null then raise exception 'สงวนสิทธิ์เฉพาะแอดมิน'; end if;
  if p_status is null or p_status not in ('REGISTERED','ATTENDING','COMPLETED') then raise exception 'สถานะไม่ถูกต้อง'; end if;
  if p_reason is null or length(trim(p_reason)) not between 1 and 500 then raise exception 'กรุณาระบุเหตุผลไม่เกิน 500 ตัวอักษร'; end if;
  -- Same lock order as issuing/redeeming QR tickets and station check-in.
  perform 1 from public.users where id=p_user for update;
  select * into r from public.event_registrations where event_id=p_event and user_id=p_user for update;
  if not found then raise exception 'ไม่พบการลงทะเบียนกิจกรรม'; end if;
  if r.status is distinct from p_expected_status then raise exception 'สถานะเปลี่ยนแล้ว กรุณาโหลดข้อมูลใหม่ก่อนแก้ไข'; end if;
  if r.status=p_status then return; end if;
  update public.event_registrations set status=p_status,
    checkin_at=case when p_status='REGISTERED' then null else coalesce(r.checkin_at,now()) end,
    checked_in_by=case when p_status='REGISTERED' then null when r.checkin_at is null then actor else r.checked_in_by end,
    checkin_station=case when p_status='REGISTERED' or r.checkin_at is null then false else r.checkin_station end,
    checkout_at=case when p_status='COMPLETED' then coalesce(r.checkout_at,now()) else null end,
    checked_out_by=case when p_status='COMPLETED' then coalesce(r.checked_out_by,actor) else null end,
    updated_at=now()
    where id=r.id returning * into changed;
  delete from event_pass_private.qr_tickets where registration_id=r.id;
  insert into event_pass_private.attendance_corrections(event_id,user_id,admin_id,reason,before_state,after_state)
    values(p_event,p_user,actor,trim(p_reason),to_jsonb(r),to_jsonb(changed));
end; $$;
revoke all on function public.admin_correct_attendance(text,uuid,uuid,text,text,text) from public;
grant execute on function public.admin_correct_attendance(text,uuid,uuid,text,text,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
