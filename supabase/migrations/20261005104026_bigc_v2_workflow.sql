create table if not exists boy_central.bigc_workflows (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id),
  business_date date not null,
  workflow_type text not null check (workflow_type in ('close_order', 'receive', 'return')),
  status text not null default 'submitted' check (status in ('draft', 'submitted', 'voided')),
  source_workflow_id uuid references boy_central.bigc_workflows(id),
  cash_amount numeric not null default 0 check (cash_amount >= 0),
  transfer_amount numeric not null default 0 check (transfer_amount >= 0),
  thai_chuay_thai_amount numeric not null default 0 check (thai_chuay_thai_amount >= 0),
  sheet_sync_status text not null default 'pending' check (sheet_sync_status in ('pending', 'syncing', 'synced', 'error')),
  sheet_sync_error text,
  revision integer not null default 1 check (revision > 0),
  submitted_by uuid references auth.users(id),
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, business_date, workflow_type)
);

create table if not exists boy_central.bigc_workflow_lines (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  workflow_id uuid not null references boy_central.bigc_workflows(id) on delete cascade,
  line_key text not null,
  source_line_key text,
  item_id uuid references boy_central.items(id),
  item_name text not null,
  category_name text,
  unit_name text,
  input_mode text not null default 'quantity' check (input_mode in ('quantity', 'weight')),
  quantity numeric not null default 0 check (quantity >= 0),
  received boolean not null default true,
  sort_order integer not null default 0,
  estimated_unit_cost numeric,
  estimated_value numeric,
  note text,
  created_at timestamptz not null default now(),
  unique (workflow_id, line_key)
);

create table if not exists boy_central.bigc_workflow_settings (
  branch_id uuid primary key references boy_central.branches(id),
  company_id uuid not null references boy_central.companies(id),
  menu_config jsonb not null default '[]'::jsonb,
  default_return_keys jsonb not null default '[]'::jsonb,
  version integer not null default 1,
  updated_by uuid references auth.users(id),
  updated_at timestamptz not null default now()
);

create table if not exists boy_central.bigc_workflow_drafts (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id),
  business_date date not null,
  user_id uuid not null references auth.users(id),
  payload jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (branch_id, business_date, user_id)
);

create index if not exists bigc_workflows_date_idx
  on boy_central.bigc_workflows(branch_id, business_date desc);
create index if not exists bigc_workflows_sheet_pending_idx
  on boy_central.bigc_workflows(sheet_sync_status, updated_at)
  where sheet_sync_status <> 'synced';
create index if not exists bigc_workflow_lines_workflow_idx
  on boy_central.bigc_workflow_lines(workflow_id, sort_order);

alter table boy_central.bigc_workflows enable row level security;
alter table boy_central.bigc_workflow_lines enable row level security;
alter table boy_central.bigc_workflow_settings enable row level security;
alter table boy_central.bigc_workflow_drafts enable row level security;

drop policy if exists bigc_workflows_select on boy_central.bigc_workflows;
create policy bigc_workflows_select on boy_central.bigc_workflows
  for select to authenticated
  using ((select boy_central_private.has_branch_access(branch_id, null::text[])));

drop policy if exists bigc_workflow_lines_select on boy_central.bigc_workflow_lines;
create policy bigc_workflow_lines_select on boy_central.bigc_workflow_lines
  for select to authenticated
  using (exists (
    select 1 from boy_central.bigc_workflows w
    where w.id = workflow_id
      and (select boy_central_private.has_branch_access(w.branch_id, null::text[]))
  ));

drop policy if exists bigc_workflow_settings_select on boy_central.bigc_workflow_settings;
create policy bigc_workflow_settings_select on boy_central.bigc_workflow_settings
  for select to authenticated
  using ((select boy_central_private.has_branch_access(branch_id, null::text[])));

drop policy if exists bigc_workflow_drafts_select on boy_central.bigc_workflow_drafts;
create policy bigc_workflow_drafts_select on boy_central.bigc_workflow_drafts
  for select to authenticated
  using (user_id = (select auth.uid()) and (select boy_central_private.has_branch_access(branch_id, null::text[])));

create or replace function boy_central.get_bigc_v2_context(target_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  target_branch boy_central.branches%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into target_branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if target_branch.id is null then raise exception 'BigC branch not found'; end if;
  if not boy_central_private.has_branch_access(target_branch.id,array['admin','manager','staff']) then raise exception 'branch access denied'; end if;

  select jsonb_build_object(
    'branch',jsonb_build_object('id',target_branch.id,'code',target_branch.code,'name',target_branch.name),
    'business_date',target_date,
    'settings',coalesce((select jsonb_build_object('menu_config',s.menu_config,'default_return_keys',s.default_return_keys,'version',s.version)
      from boy_central.bigc_workflow_settings s where s.branch_id=target_branch.id),
      jsonb_build_object('menu_config','[]'::jsonb,'default_return_keys','[]'::jsonb,'version',0)),
    'draft',coalesce((select d.payload from boy_central.bigc_workflow_drafts d
      where d.branch_id=target_branch.id and d.business_date=target_date and d.user_id=actor),'{}'::jsonb),
    'workflows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'workflow_type',w.workflow_type,'status',w.status,'business_date',w.business_date,
      'cash_amount',w.cash_amount,'transfer_amount',w.transfer_amount,'thai_chuay_thai_amount',w.thai_chuay_thai_amount,
      'sheet_sync_status',w.sheet_sync_status,'sheet_sync_error',w.sheet_sync_error,'revision',w.revision,
      'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'line_key',l.line_key,'source_line_key',l.source_line_key,'item_id',l.item_id,'item_name',l.item_name,
        'category_name',l.category_name,'unit_name',l.unit_name,'input_mode',l.input_mode,
        'quantity',l.quantity,'received',l.received,'sort_order',l.sort_order,'note',l.note
      ) order by l.sort_order,l.item_name) from boy_central.bigc_workflow_lines l where l.workflow_id=w.id),'[]'::jsonb)
    ) order by w.workflow_type) from boy_central.bigc_workflows w
      where w.branch_id=target_branch.id and w.business_date=target_date and w.status<>'voided'),'[]'::jsonb),
    'previous_order',coalesce((select jsonb_build_object(
      'id',w.id,'business_date',w.business_date,
      'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'line_key',l.line_key,'item_id',l.item_id,'item_name',l.item_name,'category_name',l.category_name,
        'unit_name',l.unit_name,'input_mode',l.input_mode,'quantity',l.quantity,'sort_order',l.sort_order
      ) order by l.sort_order,l.item_name) from boy_central.bigc_workflow_lines l where l.workflow_id=w.id and l.quantity>0),'[]'::jsonb)
    ) from boy_central.bigc_workflows w where w.branch_id=target_branch.id
      and w.business_date=target_date-1 and w.workflow_type='close_order' and w.status='submitted'),'null'::jsonb),
    'pending_sheet_sync',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'workflow_type',w.workflow_type,'business_date',w.business_date))
      from boy_central.bigc_workflows w where w.branch_id=target_branch.id and w.sheet_sync_status in ('pending','error')),'[]'::jsonb)
  ) into result;
  return result;
end
$$;

create or replace function boy_central.save_bigc_v2_draft(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); target_branch boy_central.branches%rowtype; target_date date;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into target_branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if not boy_central_private.has_branch_access(target_branch.id,array['admin','manager','staff']) then raise exception 'branch access denied'; end if;
  target_date:=coalesce(nullif(payload->>'business_date','')::date,current_date);
  insert into boy_central.bigc_workflow_drafts(company_id,branch_id,business_date,user_id,payload)
  values(target_branch.company_id,target_branch.id,target_date,actor,payload)
  on conflict(branch_id,business_date,user_id) do update set payload=excluded.payload,updated_at=now();
  return jsonb_build_object('status','saved','business_date',target_date);
end
$$;

create or replace function boy_central.save_bigc_v2_settings(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); target_branch boy_central.branches%rowtype;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into target_branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if not boy_central_private.has_branch_access(target_branch.id,array['admin','manager']) then raise exception 'manager access required'; end if;
  insert into boy_central.bigc_workflow_settings(branch_id,company_id,menu_config,default_return_keys,updated_by)
  values(target_branch.id,target_branch.company_id,coalesce(payload->'menu_config','[]'::jsonb),coalesce(payload->'default_return_keys','[]'::jsonb),actor)
  on conflict(branch_id) do update set menu_config=excluded.menu_config,default_return_keys=excluded.default_return_keys,
    version=boy_central.bigc_workflow_settings.version+1,updated_by=actor,updated_at=now();
  return jsonb_build_object('status','saved');
end
$$;

create or replace function boy_central.save_bigc_v2_workflow(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid()); target_branch boy_central.branches%rowtype;
  target_id uuid; target_type text:=payload->>'workflow_type'; target_date date;
  line jsonb; line_no integer:=0;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_type not in ('close_order','receive','return') then raise exception 'invalid workflow_type'; end if;
  select * into target_branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if not boy_central_private.has_branch_access(target_branch.id,array['admin','manager','staff']) then raise exception 'branch access denied'; end if;
  target_date:=coalesce(nullif(payload->>'business_date','')::date,current_date);

  insert into boy_central.bigc_workflows(
    company_id,branch_id,business_date,workflow_type,status,source_workflow_id,
    cash_amount,transfer_amount,thai_chuay_thai_amount,sheet_sync_status,sheet_sync_error,
    submitted_by,submitted_at,updated_at
  ) values (
    target_branch.company_id,target_branch.id,target_date,target_type,'submitted',
    nullif(payload->>'source_workflow_id','')::uuid,
    greatest(coalesce(nullif(payload->>'cash_amount','')::numeric,0),0),
    greatest(coalesce(nullif(payload->>'transfer_amount','')::numeric,0),0),
    greatest(coalesce(nullif(payload->>'thai_chuay_thai_amount','')::numeric,0),0),
    'pending',null,actor,now(),now()
  )
  on conflict(branch_id,business_date,workflow_type) do update set
    status='submitted',source_workflow_id=excluded.source_workflow_id,
    cash_amount=excluded.cash_amount,transfer_amount=excluded.transfer_amount,
    thai_chuay_thai_amount=excluded.thai_chuay_thai_amount,
    sheet_sync_status='pending',sheet_sync_error=null,revision=boy_central.bigc_workflows.revision+1,
    submitted_by=actor,submitted_at=now(),updated_at=now()
  returning id into target_id;

  delete from boy_central.bigc_workflow_lines where workflow_id=target_id;
  for line in select value from jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)) loop
    line_no:=line_no+1;
    if trim(coalesce(line->>'item_name',''))='' then continue; end if;
    insert into boy_central.bigc_workflow_lines(
      company_id,workflow_id,line_key,source_line_key,item_id,item_name,category_name,unit_name,input_mode,
      quantity,received,sort_order,estimated_unit_cost,estimated_value,note
    ) values (
      target_branch.company_id,target_id,
      coalesce(nullif(line->>'line_key',''),'line-'||line_no),nullif(line->>'source_line_key',''),
      nullif(line->>'item_id','')::uuid,trim(line->>'item_name'),nullif(trim(line->>'category_name'),''),
      nullif(trim(line->>'unit_name'),''),case when line->>'input_mode'='weight' then 'weight' else 'quantity' end,
      greatest(coalesce(nullif(line->>'quantity','')::numeric,0),0),coalesce((line->>'received')::boolean,true),
      coalesce(nullif(line->>'sort_order','')::integer,line_no),nullif(line->>'estimated_unit_cost','')::numeric,
      nullif(line->>'estimated_value','')::numeric,nullif(trim(line->>'note'),'')
    );
  end loop;
  delete from boy_central.bigc_workflow_drafts where branch_id=target_branch.id and business_date=target_date and user_id=actor;
  return jsonb_build_object('status','saved','workflow_id',target_id,'sheet_sync_status','pending');
end
$$;

create or replace function boy_central.mark_bigc_v2_sheet_sync(target_workflow_id uuid, sync_status text, sync_error text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor uuid := (select auth.uid()); target boy_central.bigc_workflows%rowtype;
begin
  if actor is null then raise exception 'authentication required'; end if;
  if sync_status not in ('pending','syncing','synced','error') then raise exception 'invalid sync status'; end if;
  select * into target from boy_central.bigc_workflows where id=target_workflow_id;
  if target.id is null or not boy_central_private.has_branch_access(target.branch_id,array['admin','manager','staff']) then raise exception 'workflow access denied'; end if;
  update boy_central.bigc_workflows set sheet_sync_status=sync_status,sheet_sync_error=nullif(sync_error,''),updated_at=now() where id=target_workflow_id;
  return jsonb_build_object('status',sync_status,'workflow_id',target_workflow_id);
end
$$;

revoke all on function boy_central.get_bigc_v2_context(date) from public, anon;
revoke all on function boy_central.save_bigc_v2_draft(jsonb) from public, anon;
revoke all on function boy_central.save_bigc_v2_settings(jsonb) from public, anon;
revoke all on function boy_central.save_bigc_v2_workflow(jsonb) from public, anon;
revoke all on function boy_central.mark_bigc_v2_sheet_sync(uuid,text,text) from public, anon;
grant execute on function boy_central.get_bigc_v2_context(date) to authenticated;
grant execute on function boy_central.save_bigc_v2_draft(jsonb) to authenticated;
grant execute on function boy_central.save_bigc_v2_settings(jsonb) to authenticated;
grant execute on function boy_central.save_bigc_v2_workflow(jsonb) to authenticated;
grant execute on function boy_central.mark_bigc_v2_sheet_sync(uuid,text,text) to authenticated;
