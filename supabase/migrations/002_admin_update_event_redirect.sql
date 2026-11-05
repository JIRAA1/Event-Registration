create or replace function public.admin_update_event_redirect(
  p_admin_token text,
  p_event_id uuid,
  p_redirect_url_year1 text
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_url text := nullif(trim(coalesce(p_redirect_url_year1, '')), '');
begin
  if not exists (
    select 1
    from public.app_sessions s
    join public.users u on u.id = s.user_id
    where s.token_hash = encode(digest(p_admin_token, 'sha256'), 'hex')
      and s.expires_at > now()
      and u.role = 'ADMIN'
  ) then
    return jsonb_build_object('success', false, 'error_code', 'FORBIDDEN', 'message', 'สงวนสิทธิ์เฉพาะแอดมิน');
  end if;

  if v_url is not null and v_url !~ '^https?://' then
    return jsonb_build_object('success', false, 'error_code', 'INVALID_URL', 'message', 'URL ต้องขึ้นต้นด้วย https:// หรือ http://');
  end if;

  update public.events
  set redirect_url_year1 = v_url
  where id = p_event_id;

  if not found then
    return jsonb_build_object('success', false, 'error_code', 'NOT_FOUND', 'message', 'ไม่พบกิจกรรมนี้');
  end if;

  return jsonb_build_object('success', true);
end;
$$;

grant execute on function public.admin_update_event_redirect(text, uuid, text) to anon, authenticated;

notify pgrst, 'reload schema';
