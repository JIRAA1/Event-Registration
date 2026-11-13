begin;
-- Preserve rows and assignments; one INSERT statement per input batch.
create or replace function public.admin_add_reserve_passcodes(p_admin_token text,p_event_id uuid,p_codes text[])
returns jsonb language plpgsql security definer set search_path = public, extensions, pg_temp as $$
declare v_role text; v_code text; v_added int := 0;
begin
  select u.role into v_role from public.app_sessions s join public.users u on u.id=s.user_id
    where s.token_hash=encode(digest(p_admin_token,'sha256'),'hex') and s.expires_at>now();
  if coalesce(v_role,'') <> 'ADMIN' then return jsonb_build_object('success',false,'message','สงวนสิทธิ์เฉพาะแอดมิน'); end if;
  if cardinality(p_codes)>100 then raise exception 'กรุณาเพิ่มรหัสครั้งละไม่เกิน 100 รายการ'; end if;
  insert into public.event_passcodes(event_id,code,is_reserve)
  select p_event_id,trim(code),true from unnest(coalesce(p_codes,'{}'::text[])) as input(code)
  where length(trim(code))>0
  on conflict(event_id,code) do nothing;
  get diagnostics v_added = row_count;
  return jsonb_build_object('success',true,'added_count',v_added,'matched_count',0);
end; $$;


notify pgrst,'reload schema';
commit;
