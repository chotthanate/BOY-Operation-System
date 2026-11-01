-- Provision only the dedicated BigC staff identity; only the server admin API can call this.
create or replace function boy_central.configure_bigc_staff_account(actor_user_id uuid, target_user_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare branch boy_central.branches%rowtype;
begin
  select * into branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if branch.id is null or not exists(select 1 from boy_central.profiles p
    where p.user_id=actor_user_id and p.company_id=branch.company_id and p.active and p.company_role='admin') then
    raise exception 'company admin required';
  end if;
  if target_user_id=actor_user_id or exists(select 1 from boy_central.profiles p
    where p.user_id=target_user_id and (p.company_role<>'staff' or p.company_id<>branch.company_id)) then
    raise exception 'dedicated staff identity required';
  end if;
  insert into boy_central.profiles(user_id,company_id,display_name,employee_code,company_role,active)
  values(target_user_id,branch.company_id,'พนักงาน BigC','BIGC-SHARED-STAFF','staff',true)
  on conflict(user_id) do update set display_name=excluded.display_name,
    employee_code=excluded.employee_code,company_role='staff',active=true,updated_at=now();
  update boy_central.user_branch_roles set active=false where user_id=target_user_id and branch_id<>branch.id;
  insert into boy_central.user_branch_roles(company_id,user_id,branch_id,role,active)
  values(branch.company_id,target_user_id,branch.id,'staff',true)
  on conflict(user_id,branch_id) do update set role='staff',active=true;
  return jsonb_build_object('status','configured');
end;
$$;
revoke all on function boy_central.configure_bigc_staff_account(uuid,uuid) from public,anon,authenticated;
grant execute on function boy_central.configure_bigc_staff_account(uuid,uuid) to service_role;

-- Staff can change default returns, never menu names, units, costing, mappings or stock flags.
create or replace function boy_central.save_bigc_v2_default_returns(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_branch uuid;
  requested jsonb:=payload->'default_return_keys';
  settings boy_central.bigc_workflow_settings%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if payload - 'default_return_keys' <> '{}'::jsonb then raise exception 'only default return keys may be changed'; end if;
  if jsonb_typeof(requested) is distinct from 'array' then raise exception 'default return keys array required'; end if;
  select id into target_branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if target_branch is null or not boy_central_private.has_branch_access(target_branch,array['admin','manager','staff']) then
    raise exception 'BigC branch access required';
  end if;
  select * into settings from boy_central.bigc_workflow_settings where branch_id=target_branch for update;
  if not found then raise exception 'menu settings not initialized'; end if;
  if exists(select 1 from jsonb_array_elements(requested) key
    where jsonb_typeof(key)<>'string' or not exists(
      select 1 from jsonb_array_elements(settings.menu_config) item where item->>'key'=key#>>'{}')) then
    raise exception 'unknown return item';
  end if;
  update boy_central.bigc_workflow_settings s set
    menu_config=(select coalesce(jsonb_agg(item||jsonb_build_object('defaultReturn',
      requested @> jsonb_build_array(item->>'key')) order by ord),'[]'::jsonb)
      from jsonb_array_elements(s.menu_config) with ordinality as row(item,ord)),
    default_return_keys=(select coalesce(jsonb_agg(item->>'key' order by ord),'[]'::jsonb)
      from jsonb_array_elements(s.menu_config) with ordinality as row(item,ord)
      where requested @> jsonb_build_array(item->>'key')),
    version=s.version+1,updated_by=auth.uid(),updated_at=now()
    where s.branch_id=target_branch returning * into settings;
  return jsonb_build_object('menu_config',settings.menu_config,'default_return_keys',
    settings.default_return_keys,'version',settings.version);
end;
$$;
revoke all on function boy_central.save_bigc_v2_default_returns(jsonb) from public,anon;
grant execute on function boy_central.save_bigc_v2_default_returns(jsonb) to authenticated;
notify pgrst,'reload schema';
