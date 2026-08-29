create or replace function boy_central.bootstrap_first_admin(display_name text)
returns boy_central.profiles
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := (select auth.uid());
  current_email text := lower(coalesce((select auth.jwt() ->> 'email'), ''));
  target_company_id uuid;
  created_profile boy_central.profiles;
begin
  if current_user_id is null then
    raise exception 'authentication required';
  end if;

  if encode(extensions.digest(current_email, 'sha256'), 'hex')
    <> '24c8d97295f20d7b6ced66b2a8f0e5c2aa9e7caeed266e8ee563f51c9f529d37' then
    raise exception 'account is not authorized for initial admin bootstrap';
  end if;

  if nullif(trim(display_name), '') is null then
    raise exception 'display name is required';
  end if;

  perform pg_advisory_xact_lock(hashtext('boy-central-bootstrap-admin'));

  select id into target_company_id
  from boy_central.companies
  where code = 'BOY' and active
  limit 1;

  if target_company_id is null then
    raise exception 'BOY company not found';
  end if;

  if exists (select 1 from boy_central.profiles where company_id = target_company_id) then
    raise exception 'initial admin already exists';
  end if;

  insert into boy_central.profiles (user_id, company_id, display_name, company_role)
  values (current_user_id, target_company_id, trim(display_name), 'admin')
  returning * into created_profile;

  insert into boy_central.user_branch_roles (company_id, user_id, branch_id, role)
  select target_company_id, current_user_id, b.id, 'admin'
  from boy_central.branches b
  where b.company_id = target_company_id
  on conflict (user_id, branch_id) do update set role = excluded.role, active = true;

  insert into boy_central.audit_log (
    company_id, actor_user_id, action, entity_type, entity_id, source_system, after_data
  ) values (
    target_company_id, current_user_id, 'bootstrap_admin', 'profile', current_user_id::text,
    'boy_central', jsonb_build_object('company_role', 'admin')
  );

  return created_profile;
end;
$$;

revoke all on function boy_central.bootstrap_first_admin(text) from public, anon;
grant execute on function boy_central.bootstrap_first_admin(text) to authenticated;
