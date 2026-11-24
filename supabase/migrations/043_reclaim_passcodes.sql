begin;
-- Additive only: deployment itself never changes existing attendance/assignments.
alter table public.events add column if not exists checkout_closed_at timestamptz;
alter table public.event_registrations add column if not exists passcode_forfeited boolean not null default false;
alter table public.event_passcodes add column if not exists reclaimed_at timestamptz;
create table event_pass_private.passcode_recovery (
 id bigint generated always as identity primary key,
 event_id uuid not null references public.events,
 passcode_id uuid not null references public.event_passcodes,
 previous_user uuid not null references public.users,
 reclaimed_by uuid not null references public.users,
 reclaimed_at timestamptz not null default clock_timestamp(),
 recipient uuid references public.users,
 approved_by uuid references public.users,
 approved_at timestamptz,
 reason text,
 unique(passcode_id)
);

create function event_pass_private.guard_round_registration() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare closed timestamptz;
begin
 select checkout_closed_at into closed from events where id=new.event_id for share;
 if closed is not null and ((tg_op='INSERT' and new.status<>'REGISTERED') or
   (tg_op='UPDATE' and new.status is distinct from old.status)) and not exists(
   select 1 from event_pass_private.passcode_recovery where event_id=new.event_id and recipient=new.user_id
 ) then raise exception 'ปิดรอบสแกนแล้ว กรุณาให้แอดมินตรวจสอบรายการตกหล่น'; end if;
 if new.passcode_id is not null and new.passcode_forfeited then raise exception 'รายการนี้ถูกคืนสิทธิ์ Passcode แล้ว'; end if;
 return new;
end $$;
create trigger guard_closed_round before insert or update on public.event_registrations
 for each row execute function event_pass_private.guard_round_registration();

create function event_pass_private.guard_round_code() returns trigger
language plpgsql security definer set search_path=public,pg_temp as $$
declare closed timestamptz;
begin
 select checkout_closed_at into closed from events where id=new.event_id for share;
 if new.assigned_to is not null and (tg_op='INSERT' or new.assigned_to is distinct from old.assigned_to) then
  if exists(select 1 from event_registrations where event_id=new.event_id and user_id=new.assigned_to and passcode_forfeited) or exists(select 1 from event_pass_private.passcode_recovery where event_id=new.event_id and previous_user=new.assigned_to)
   then raise exception 'ไม่สามารถคืนรหัสให้ผู้ที่เสียสิทธิ์หลังปิดรอบ'; end if;
  if new.reclaimed_at is not null and not exists(select 1 from event_pass_private.passcode_recovery where passcode_id=new.id and recipient=new.assigned_to)
   then raise exception 'รหัสที่คืนมาต้องผ่านการยืนยันรายการตกหล่นโดยแอดมิน'; end if;
  if closed is not null and not exists(select 1 from event_registrations where event_id=new.event_id and user_id=new.assigned_to and status='COMPLETED')
   and not exists(select 1 from event_pass_private.passcode_recovery where passcode_id=new.id and recipient=new.assigned_to)
   then raise exception 'ปิดรอบแล้ว ไม่จับคู่รหัสให้ผู้ที่ยังไม่สแกนออก'; end if;
 end if;
 return new;
end $$;
create trigger guard_closed_round_code before insert or update on public.event_passcodes
 for each row execute function event_pass_private.guard_round_code();

create function public.admin_passcode_round(p_token text,p_event uuid,p_action text default 'PREVIEW') returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor uuid; closed timestamptz; r record; n int:=0; candidates jsonb;
begin
 actor:=event_pass_private.admin_id(p_token);
 if actor is null then raise exception 'สงวนสิทธิ์เฉพาะแอดมิน'; end if;
 select checkout_closed_at into closed from events where id=p_event for update;
 if not found then raise exception 'ไม่พบกิจกรรม'; end if;
 if p_action='CLOSE' then
  update events set checkout_closed_at=coalesce(checkout_closed_at,clock_timestamp()) where id=p_event returning checkout_closed_at into closed;
 elsif p_action='RECLAIM' then
  if closed is null then raise exception 'กรุณาปิดรอบสแกนก่อนคืนรหัส'; end if;
  for r in select reg.id,reg.user_id,reg.passcode_id from event_registrations reg
    join event_passcodes p on p.id=reg.passcode_id and p.event_id=reg.event_id and p.assigned_to=reg.user_id
    where reg.event_id=p_event and reg.status<>'COMPLETED' and not reg.passcode_forfeited
    order by reg.id for update of reg,p
  loop
   insert into event_pass_private.passcode_recovery(event_id,passcode_id,previous_user,reclaimed_by)
    values(p_event,r.passcode_id,r.user_id,actor);
   update event_registrations set passcode_id=null,passcode_forfeited=true,updated_at=now() where id=r.id;
   update event_passcodes set assigned_to=null,assigned_at=null,is_reserve=true,reclaimed_at=clock_timestamp() where id=r.passcode_id;
   n:=n+1;
  end loop;
 elsif p_action<>'PREVIEW' then raise exception 'คำสั่งไม่ถูกต้อง'; end if;
 if p_action<>'PREVIEW' then insert into event_pass_private.security_audit(actor,event_id,action,reason)
  values(actor,p_event,'PASSCODE_'||p_action,'จำนวนรหัสที่คืน: '||n); end if;
 select coalesce(jsonb_agg(jsonb_build_object('student_id',u.student_id,'full_name',u.full_name)),'[]') into candidates
 from event_registrations reg join users u on u.id=reg.user_id join event_passcodes p on p.id=reg.passcode_id and p.assigned_to=reg.user_id
 where reg.event_id=p_event and reg.status<>'COMPLETED' and not reg.passcode_forfeited;
 return jsonb_build_object('success',true,'closed_at',closed,'reclaimed_count',n,'candidates',candidates,
 'available_count',(select count(*) from event_passcodes where event_id=p_event and reclaimed_at is not null and assigned_to is null));
end $$;

create function public.admin_recover_attendance_qr(p_session_token text,p_event_id uuid,p_ticket uuid,
 p_location jsonb default null,p_confirm boolean default false,p_reason text default null) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare actor uuid; student uuid; t event_pass_private.qr_tickets%rowtype; r event_registrations%rowtype;
 u users%rowtype; code_id uuid; closed timestamptz; distance float8; a jsonb; b jsonb:=p_location;
begin
 actor:=event_pass_private.admin_id(p_session_token);
 if actor is null then raise exception 'สงวนสิทธิ์เฉพาะแอดมิน'; end if;
 select checkout_closed_at into closed from events where id=p_event_id for share;
 if closed is null then raise exception 'ต้องปิดรอบสแกนก่อนยืนยันรายการตกหล่น'; end if;
 select reg.user_id into student from event_pass_private.qr_tickets q join event_registrations reg on reg.id=q.registration_id where q.token=p_ticket;
 select * into u from users where id=student for update;
 select q.* into t from event_pass_private.qr_tickets q join event_registrations reg on reg.id=q.registration_id
 join app_sessions s on s.id=q.session_id and s.user_id=reg.user_id and s.expires_at>clock_timestamp()
 join event_pass_private.card_owners o on o.user_id=reg.user_id and o.session_id=q.session_id
 where q.token=p_ticket and reg.event_id=p_event_id and not q.used and q.expires_at>clock_timestamp() for update of q;
 if not found then return jsonb_build_object('success',false,'message','QR หมดอายุหรือใช้แล้ว กรุณาเปิด QR ใหม่'); end if;
 select * into r from event_registrations where id=t.registration_id for update;
 if r.status<>'REGISTERED' or r.passcode_forfeited or r.passcode_id is not null or u.study_year<=1 or exists(select 1 from event_pass_private.passcode_recovery where event_id=p_event_id and previous_user=student) then
  return jsonb_build_object('success',false,'message','รับเฉพาะปี 2 ขึ้นไปที่ตกหล่นการสแกนเข้าและยังไม่มีรหัส ไม่รวมผู้ที่ไม่มาสแกนออก'); end if;
 a:=t.location;
 if event_pass_private.valid_location(a) and event_pass_private.valid_location(b)
  and abs(extract(epoch from clock_timestamp())*1000-(a->>'timestamp')::float8)<=30000
  and abs(extract(epoch from clock_timestamp())*1000-(b->>'timestamp')::float8)<=30000 then
  distance:=6371000*2*asin(sqrt(least(1.0,power(sin(radians((b->>'lat')::float8-(a->>'lat')::float8)/2),2)+
   cos(radians((a->>'lat')::float8))*cos(radians((b->>'lat')::float8))*power(sin(radians((b->>'lon')::float8-(a->>'lon')::float8)/2),2))));
 end if;
 if p_confirm is not true or length(trim(coalesce(p_reason,''))) not between 5 and 500 then
  return jsonb_build_object('success',false,'code','RECOVERY_CONFIRM_REQUIRED','message','ตรวจบัตรตัวจริงและหลักฐานการเข้าร่วม ระบุเหตุผลที่รายการสแกนเข้าตกหล่นก่อนอนุมัติ',
   'student_id',u.student_id,'full_name',u.full_name,'distance_m',distance,'radius_m',coalesce((select radius_m from event_pass_private.scan_security where event_id=p_event_id),100),
   'student_accuracy',a->'accuracy','staff_accuracy',b->'accuracy');
 end if;
 select p.id into code_id from event_passcodes p join event_pass_private.passcode_recovery h on h.passcode_id=p.id
 where p.event_id=p_event_id and p.assigned_to is null and p.reclaimed_at is not null and h.recipient is null and h.previous_user<>student
 order by p.id limit 1 for update of p skip locked;
 if code_id is null then return jsonb_build_object('success',false,'message','ไม่มีรหัสที่คืนมาว่างอยู่ กรุณาตรวจรายการคืนรหัส'); end if;
 update event_pass_private.passcode_recovery set recipient=student,approved_by=actor,approved_at=clock_timestamp(),reason=trim(p_reason) where passcode_id=code_id;
 update event_passcodes set assigned_to=student,assigned_at=now() where id=code_id;
 update event_registrations set status='COMPLETED',checkout_at=now(),checked_out_by=actor,passcode_id=code_id,updated_at=now() where id=r.id;
 update event_pass_private.qr_tickets set used=true,location=null where token=p_ticket;
 insert into event_pass_private.security_audit(actor,student,event_id,action,reason,distance_m)
 values(actor,student,p_event_id,'ADMIN_RECOVER_ATTENDANCE',trim(p_reason),distance);
 return jsonb_build_object('success',true,'new_status','COMPLETED','full_name',u.full_name,'message','ยืนยันรายการตกหล่นและให้ Passcode แล้ว');
end $$;

create or replace function public.assign_registration_passcode_for_study_year()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_study_year int;
  v_passcode_id uuid;
begin
  if new.passcode_forfeited or new.passcode_id is not null or new.status not in ('ATTENDING','COMPLETED') or (new.status<>'COMPLETED' and exists(select 1 from events where id=new.event_id and checkout_closed_at is not null)) then return new; end if;

  select study_year into v_study_year
  from public.users
  where id = new.user_id and role = 'STUDENT';

  if coalesce(v_study_year, 0) <= 1 then return new; end if;

  select id into v_passcode_id
  from public.event_passcodes
  where event_id = new.event_id and is_reserve = true and assigned_to is null and reclaimed_at is null
  order by id
  limit 1
  for update skip locked;

  if v_passcode_id is not null then
    update public.event_passcodes
    set assigned_to = new.user_id, assigned_at = now()
    where id = v_passcode_id and assigned_to is null;
    if found then
      update public.event_registrations
      set passcode_id = v_passcode_id, updated_at = now()
      where id = new.id and passcode_id is null;
    end if;
  end if;
  return new;
end;
$$;

create or replace function event_pass_private.match_waiting_passcodes_batch(p_event uuid,p_limit int) returns int
language plpgsql set search_path=public,pg_temp as $$
declare r record; code_id uuid; matched int:=0;
begin
  perform 1 from events where id=p_event for share;
  for r in select reg.id,reg.user_id from public.event_registrations reg join public.users u on u.id=reg.user_id
    where reg.event_id=p_event and reg.passcode_id is null and u.role='STUDENT' and u.study_year>1
      and not reg.passcode_forfeited and reg.status in ('ATTENDING','COMPLETED') and (reg.status='COMPLETED' or not exists(select 1 from events where id=p_event and checkout_closed_at is not null))
    order by case when reg.status='COMPLETED' then 1 else 2 end, reg.checkin_at asc, reg.id
    limit greatest(1,least(coalesce(p_limit,25),100)) for update of reg skip locked
  loop
    select p.id into code_id from public.event_passcodes p
      where p.event_id=p_event and p.is_reserve and p.assigned_to is null and p.reclaimed_at is null
      order by p.id limit 1 for update skip locked;
    if not found then exit; end if;
    update public.event_passcodes set assigned_to=r.user_id,assigned_at=now() where id=code_id;
    update public.event_registrations set passcode_id=code_id,updated_at=now() where id=r.id;
    matched:=matched+1;
  end loop;
  return matched;
end; $$;


create or replace function public.admin_match_passcodes_batch(p_token text,p_event uuid,p_limit int default 25) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare matched int; waiting int; available int;
begin
 if event_pass_private.admin_id(p_token) is null then raise exception 'กรุณาเข้าสู่ระบบแอดมิน'; end if;
 matched:=event_pass_private.match_waiting_passcodes_batch(p_event,p_limit);
 select count(*) into waiting from event_registrations r join users u on u.id=r.user_id
 where r.event_id=p_event and r.passcode_id is null and not r.passcode_forfeited and r.status in ('ATTENDING','COMPLETED') and (r.status='COMPLETED' or not exists(select 1 from events where id=p_event and checkout_closed_at is not null)) and u.role='STUDENT' and u.study_year>1;
 select count(*) into available from event_passcodes where event_id=p_event and is_reserve and assigned_to is null and reclaimed_at is null;
 return jsonb_build_object('matched_count',matched,'waiting_count',waiting,'available_count',available);
end; $$;

revoke all on table event_pass_private.passcode_recovery from public,anon,authenticated;
revoke all on function event_pass_private.guard_round_registration(),event_pass_private.guard_round_code() from public,anon,authenticated;
revoke all on function public.admin_passcode_round(text,uuid,text),public.admin_recover_attendance_qr(text,uuid,uuid,jsonb,boolean,text) from public;
grant execute on function public.admin_passcode_round(text,uuid,text),public.admin_recover_attendance_qr(text,uuid,uuid,jsonb,boolean,text) to anon,authenticated;
notify pgrst,'reload schema';
commit;
