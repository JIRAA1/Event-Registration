-- Keep the previous 10-argument RPC callable while older browser deployments
-- are still in use. The current app sends p_study_year to the 11-argument RPC.
create or replace function public.register_walkin_student(
  p_event_id uuid,
  p_session_token text,
  p_student_id varchar,
  p_full_name varchar,
  p_faculty varchar,
  p_major varchar,
  p_class_group varchar,
  p_enrollment_year int,
  p_birth_date varchar,
  p_phone varchar
) returns jsonb
language plpgsql
security definer
set search_path = public, extensions, pg_temp
as $$
begin
  return public.register_walkin_student(
    p_event_id,
    p_session_token,
    p_student_id,
    p_full_name,
    p_faculty,
    p_major,
    p_class_group,
    p_enrollment_year,
    p_birth_date,
    p_phone,
    greatest(1, least(8, extract(year from now())::int + 544 - p_enrollment_year))
  );
end;
$$;

grant execute on function public.register_walkin_student(uuid,text,varchar,varchar,varchar,varchar,varchar,int,varchar,varchar)
  to anon, authenticated;

notify pgrst, 'reload schema';
