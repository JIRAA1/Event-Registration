begin;
-- Preserve existing codes and assignments; change functions only.
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
  if new.passcode_id is not null or new.status not in ('ATTENDING','COMPLETED') then return new; end if;

  select study_year into v_study_year
  from public.users
  where id = new.user_id and role = 'STUDENT';

  if coalesce(v_study_year, 0) <= 1 then return new; end if;

  select id into v_passcode_id
  from public.event_passcodes
  where event_id = new.event_id and is_reserve = true and assigned_to is null
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
  for r in select reg.id,reg.user_id from public.event_registrations reg join public.users u on u.id=reg.user_id
    where reg.event_id=p_event and reg.passcode_id is null and u.role='STUDENT' and u.study_year>1
      and reg.status in ('ATTENDING','COMPLETED')
    order by case when reg.status='COMPLETED' then 1 else 2 end, reg.checkin_at asc, reg.id
    limit greatest(1,least(coalesce(p_limit,25),100)) for update of reg skip locked
  loop
    select p.id into code_id from public.event_passcodes p
      where p.event_id=p_event and p.is_reserve and p.assigned_to is null
      order by p.id limit 1 for update skip locked;
    if not found then exit; end if;
    update public.event_passcodes set assigned_to=r.user_id,assigned_at=now() where id=code_id;
    update public.event_registrations set passcode_id=code_id,updated_at=now() where id=r.id;
    matched:=matched+1;
  end loop;
  return matched;
end; $$;

create or replace function public.admin_add_reserve_passcodes(p_admin_token text,p_event_id uuid,p_codes text[])
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_role text; v_code text; v_added int := 0;
begin
  select u.role into v_role from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now();
  if coalesce(v_role,'') <> 'ADMIN' then return jsonb_build_object('success',false,'message','สงวนสิทธิ์เฉพาะแอดมิน'); end if;
  if cardinality(p_codes)>100 then raise exception 'กรุณาเพิ่มรหัสครั้งละไม่เกิน 100 รายการ'; end if;
  foreach v_code in array coalesce(p_codes,'{}'::text[]) loop
    if length(trim(v_code)) > 0 then
      insert into public.event_passcodes(event_id,code,is_reserve) values(p_event_id,trim(v_code),true)
      on conflict(event_id,code) do nothing;
      if found then v_added := v_added + 1; end if;
    end if;
  end loop;
  return jsonb_build_object('success',true,'added_count',v_added,'matched_count',0);
end; $$;


create or replace function event_pass_private.match_waiting_passcodes(p_event uuid) returns int
language sql set search_path=public,pg_temp as $$ select event_pass_private.match_waiting_passcodes_batch(p_event,25); $$;
create function public.admin_match_passcodes_batch(p_token text,p_event uuid,p_limit int default 25) returns jsonb
language plpgsql security definer set search_path=public,extensions,pg_temp as $$
declare matched int; waiting int; available int;
begin
 if event_pass_private.admin_id(p_token) is null then raise exception 'กรุณาเข้าสู่ระบบแอดมิน'; end if;
 matched:=event_pass_private.match_waiting_passcodes_batch(p_event,p_limit);
 select count(*) into waiting from event_registrations r join users u on u.id=r.user_id
 where r.event_id=p_event and r.passcode_id is null and r.status in ('ATTENDING','COMPLETED') and u.role='STUDENT' and u.study_year>1;
 select count(*) into available from event_passcodes where event_id=p_event and is_reserve and assigned_to is null;
 return jsonb_build_object('matched_count',matched,'waiting_count',waiting,'available_count',available);
end; $$;
revoke all on function public.admin_match_passcodes_batch(text,uuid,int) from public;
grant execute on function public.admin_match_passcodes_batch(text,uuid,int) to anon,authenticated;
revoke all on function public.process_qr_scan(text,uuid,uuid) from public,anon,authenticated;
notify pgrst,'reload schema';
commit;
