-- Central access control for BOY Operation and branch POS devices.
-- POS PINs are stored as bcrypt hashes and are never returned to a device.

create table boy_central.pos_roles (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id) on delete cascade,
  code text not null,
  name text not null,
  permissions jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(company_id,code)
);

create table boy_central.pos_users (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id) on delete cascade,
  display_name text not null,
  pin_hash text not null,
  role_id uuid not null references boy_central.pos_roles(id),
  active boolean not null default true,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table boy_central.pos_user_branches (
  company_id uuid not null references boy_central.companies(id) on delete cascade,
  pos_user_id uuid not null references boy_central.pos_users(id) on delete cascade,
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  primary key(pos_user_id,branch_id)
);

create table boy_central.pos_login_audit (
  id bigint generated always as identity primary key,
  company_id uuid references boy_central.companies(id) on delete cascade,
  branch_id uuid references boy_central.branches(id) on delete cascade,
  device_id uuid references boy_central.pos_devices(id) on delete set null,
  pos_user_id uuid references boy_central.pos_users(id) on delete set null,
  success boolean not null,
  occurred_at timestamptz not null default now()
);

create index pos_users_company_active_idx on boy_central.pos_users(company_id,active);
create index pos_user_branches_branch_active_idx on boy_central.pos_user_branches(branch_id,active);
create index pos_login_audit_device_time_idx on boy_central.pos_login_audit(device_id,occurred_at desc);

create or replace function boy_central_private.is_company_admin(target_company_id uuid)
returns boolean language sql stable security definer set search_path=''
as $$
  select exists(
    select 1 from boy_central.profiles p
    where p.user_id=(select auth.uid()) and p.company_id=target_company_id
      and p.active and p.company_role='admin'
  )
$$;

alter table boy_central.pos_roles enable row level security;
alter table boy_central.pos_users enable row level security;
alter table boy_central.pos_user_branches enable row level security;
alter table boy_central.pos_login_audit enable row level security;

create policy pos_roles_admin_select on boy_central.pos_roles for select to authenticated
using ((select boy_central_private.is_company_admin(company_id)));
create policy pos_users_admin_select on boy_central.pos_users for select to authenticated
using ((select boy_central_private.is_company_admin(company_id)));
create policy pos_user_branches_admin_select on boy_central.pos_user_branches for select to authenticated
using ((select boy_central_private.is_company_admin(company_id)));
create policy pos_login_audit_admin_select on boy_central.pos_login_audit for select to authenticated
using ((select boy_central_private.is_company_admin(company_id)));

revoke all on boy_central.pos_roles,boy_central.pos_users,boy_central.pos_user_branches,boy_central.pos_login_audit from public,anon,authenticated;

insert into boy_central.pos_roles(company_id,code,name,permissions,is_system)
select c.id,seed.code,seed.name,seed.permissions,true
from boy_central.companies c cross join (values
  ('owner','เจ้าของ', '{"sell":true,"view_orders":true,"void_orders":true,"refund":true,"view_summary":true,"manage_catalog":true,"manage_promotions":true,"view_stock":true,"adjust_stock":true,"manage_settings":true,"open_drawer":true,"cash_movements":true,"close_shift":true,"reprint":true}'::jsonb),
  ('manager','ผู้จัดการ', '{"sell":true,"view_orders":true,"void_orders":true,"refund":true,"view_summary":true,"manage_catalog":false,"manage_promotions":true,"view_stock":true,"adjust_stock":true,"manage_settings":false,"open_drawer":true,"cash_movements":true,"close_shift":true,"reprint":true}'::jsonb),
  ('cashier','พนักงานขาย', '{"sell":true,"view_orders":true,"void_orders":false,"refund":false,"view_summary":false,"manage_catalog":false,"manage_promotions":false,"view_stock":true,"adjust_stock":false,"manage_settings":false,"open_drawer":false,"cash_movements":false,"close_shift":true,"reprint":false}'::jsonb)
) as seed(code,name,permissions)
on conflict(company_id,code) do nothing;

create or replace function boy_central.list_access_accounts()
returns jsonb language plpgsql security definer set search_path=''
as $$
declare company uuid;
begin
  select p.company_id into company from boy_central.profiles p
  where p.user_id=(select auth.uid()) and p.active and p.company_role='admin';
  if company is null then raise exception 'admin access required'; end if;
  return jsonb_build_object(
    'branches',coalesce((select jsonb_agg(jsonb_build_object('id',b.id,'code',b.code,'name',b.name) order by b.name) from boy_central.branches b where b.company_id=company and b.active),'[]'::jsonb),
    'roles',coalesce((select jsonb_agg(jsonb_build_object('id',r.id,'code',r.code,'name',r.name,'permissions',r.permissions,'is_system',r.is_system,'active',r.active) order by r.created_at) from boy_central.pos_roles r where r.company_id=company),'[]'::jsonb),
    'pos_users',coalesce((select jsonb_agg(jsonb_build_object(
      'id',u.id,'display_name',u.display_name,'role_id',u.role_id,'active',u.active,'last_login_at',u.last_login_at,
      'branch_ids',coalesce((select jsonb_agg(ub.branch_id) from boy_central.pos_user_branches ub where ub.pos_user_id=u.id and ub.active),'[]'::jsonb)
    ) order by u.display_name) from boy_central.pos_users u where u.company_id=company),'[]'::jsonb),
    'web_users',coalesce((select jsonb_agg(jsonb_build_object('user_id',p.user_id,'display_name',p.display_name,'company_role',p.company_role,'active',p.active) order by p.display_name) from boy_central.profiles p where p.company_id=company),'[]'::jsonb)
  );
end $$;

create or replace function boy_central.save_pos_role(payload jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare company uuid; target_id uuid; target_code text;
begin
  select p.company_id into company from boy_central.profiles p where p.user_id=(select auth.uid()) and p.active and p.company_role='admin';
  if company is null then raise exception 'admin access required'; end if;
  target_id:=nullif(payload->>'id','')::uuid;
  target_code:=coalesce(nullif(payload->>'code',''),'role-'||substr(replace(gen_random_uuid()::text,'-',''),1,10));
  if trim(coalesce(payload->>'name',''))='' then raise exception 'role name is required'; end if;
  if target_id is null then
    insert into boy_central.pos_roles(company_id,code,name,permissions,active)
    values(company,target_code,trim(payload->>'name'),coalesce(payload->'permissions','{}'::jsonb),coalesce((payload->>'active')::boolean,true)) returning id into target_id;
  else
    update boy_central.pos_roles set name=trim(payload->>'name'),permissions=coalesce(payload->'permissions',permissions),active=coalesce((payload->>'active')::boolean,active),updated_at=now()
    where id=target_id and company_id=company;
    if not found then raise exception 'role not found'; end if;
  end if;
  return target_id;
end $$;

create or replace function boy_central.save_pos_user(payload jsonb)
returns uuid language plpgsql security definer set search_path=''
as $$
declare company uuid; target_id uuid; new_pin text; target_role uuid; branch_text text;
begin
  select p.company_id into company from boy_central.profiles p where p.user_id=(select auth.uid()) and p.active and p.company_role='admin';
  if company is null then raise exception 'admin access required'; end if;
  target_id:=nullif(payload->>'id','')::uuid; new_pin:=nullif(payload->>'pin',''); target_role:=(payload->>'role_id')::uuid;
  if trim(coalesce(payload->>'display_name',''))='' then raise exception 'display name is required'; end if;
  if not exists(select 1 from boy_central.pos_roles r where r.id=target_role and r.company_id=company and r.active) then raise exception 'invalid role'; end if;
  if target_id is null and (new_pin is null or new_pin !~ '^[0-9]{6}$') then raise exception 'PIN must contain 6 digits'; end if;
  if new_pin is not null and new_pin !~ '^[0-9]{6}$' then raise exception 'PIN must contain 6 digits'; end if;
  if new_pin is not null and exists(
    select 1 from boy_central.pos_users existing
    join boy_central.pos_user_branches existing_branch on existing_branch.pos_user_id=existing.id and existing_branch.active
    where existing.company_id=company and existing.active and existing.id<>coalesce(target_id,'00000000-0000-0000-0000-000000000000'::uuid)
      and existing.pin_hash=extensions.crypt(new_pin,existing.pin_hash)
      and existing_branch.branch_id::text in (select jsonb_array_elements_text(coalesce(payload->'branch_ids','[]'::jsonb)))
  ) then raise exception 'PIN already used in selected branch'; end if;
  if target_id is null then
    insert into boy_central.pos_users(company_id,display_name,pin_hash,role_id,active)
    values(company,trim(payload->>'display_name'),extensions.crypt(new_pin,extensions.gen_salt('bf',10)),target_role,coalesce((payload->>'active')::boolean,true)) returning id into target_id;
  else
    update boy_central.pos_users set display_name=trim(payload->>'display_name'),role_id=target_role,active=coalesce((payload->>'active')::boolean,active),
      pin_hash=case when new_pin is null then pin_hash else extensions.crypt(new_pin,extensions.gen_salt('bf',10)) end,updated_at=now()
    where id=target_id and company_id=company;
    if not found then raise exception 'POS user not found'; end if;
  end if;
  delete from boy_central.pos_user_branches where pos_user_id=target_id;
  for branch_text in select jsonb_array_elements_text(coalesce(payload->'branch_ids','[]'::jsonb)) loop
    insert into boy_central.pos_user_branches(company_id,pos_user_id,branch_id)
    select company,target_id,b.id from boy_central.branches b where b.id=branch_text::uuid and b.company_id=company and b.active;
  end loop;
  if not exists(select 1 from boy_central.pos_user_branches where pos_user_id=target_id) then raise exception 'select at least one branch'; end if;
  return target_id;
end $$;

create or replace function boy_central.authenticate_pos_user(device_token text,pin text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; matched record; failures integer;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  if pin !~ '^[0-9]{6}$' then raise exception 'invalid PIN'; end if;
  select count(*) into failures from boy_central.pos_login_audit a where a.device_id=d.id and not a.success and a.occurred_at>now()-interval '10 minutes';
  if failures>=10 then raise exception 'login temporarily locked'; end if;
  select u.id,u.display_name,r.id role_id,r.code role_code,r.name role_name,r.permissions
  into matched from boy_central.pos_users u
  join boy_central.pos_user_branches ub on ub.pos_user_id=u.id and ub.branch_id=d.branch_id and ub.active
  join boy_central.pos_roles r on r.id=u.role_id and r.active
  where u.company_id=d.company_id and u.active and u.pin_hash=extensions.crypt(pin,u.pin_hash)
  limit 1;
  insert into boy_central.pos_login_audit(company_id,branch_id,device_id,pos_user_id,success)
  values(d.company_id,d.branch_id,d.id,matched.id,matched.id is not null);
  if matched.id is null then raise exception 'PIN incorrect'; end if;
  update boy_central.pos_users set last_login_at=now() where id=matched.id;
  return jsonb_build_object('id',matched.id,'display_name',matched.display_name,'role_id',matched.role_id,'role_code',matched.role_code,'role_name',matched.role_name,'permissions',matched.permissions,'branch_id',d.branch_id);
end $$;

create or replace function boy_central.get_pos_access_status(device_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  return jsonb_build_object(
    'enabled',exists(select 1 from boy_central.pos_users u join boy_central.pos_user_branches ub on ub.pos_user_id=u.id and ub.branch_id=d.branch_id and ub.active where u.company_id=d.company_id and u.active),
    'branch_id',d.branch_id
  );
end $$;

revoke all on function boy_central.list_access_accounts() from public,anon;
revoke all on function boy_central.save_pos_role(jsonb) from public,anon;
revoke all on function boy_central.save_pos_user(jsonb) from public,anon;
revoke all on function boy_central.authenticate_pos_user(text,text) from public;
revoke all on function boy_central.get_pos_access_status(text) from public;
grant execute on function boy_central.list_access_accounts(),boy_central.save_pos_role(jsonb),boy_central.save_pos_user(jsonb) to authenticated;
grant execute on function boy_central.authenticate_pos_user(text,text) to anon,authenticated;
grant execute on function boy_central.get_pos_access_status(text) to anon,authenticated;

notify pgrst,'reload schema';
