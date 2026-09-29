alter table boy_central.items
  add column if not exists stock_target_item_id uuid references boy_central.items(id);

alter table boy_central.items
  drop constraint if exists items_stock_target_not_self,
  add constraint items_stock_target_not_self
    check (stock_target_item_id is null or stock_target_item_id <> id);

create index if not exists items_stock_target_item_id_idx
  on boy_central.items (stock_target_item_id)
  where stock_target_item_id is not null;

comment on column boy_central.items.stock_target_item_id is
  'Shared stock item increased when this purchasable item is recorded as an expense.';

create or replace function boy_central.admin_save_stock_mapping(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  company uuid;
  target_branch uuid;
  source_item uuid := nullif(payload->>'source_item_id','')::uuid;
  target_item uuid := nullif(payload->>'target_item_id','')::uuid;
  stock_mode text := coalesce(nullif(payload->>'mode',''),'none');
  conversion_value numeric(18,6) := coalesce(nullif(payload->>'conversion_to_target','')::numeric,1);
  purchase_unit uuid;
  source_base_unit uuid;
begin
  select p.company_id into company
  from boy_central.profiles p
  where p.user_id=actor_id and p.active and p.company_role='admin';
  if company is null then raise exception 'admin access required'; end if;

  select b.id into target_branch
  from boy_central.branches b
  where b.company_id=company and upper(b.code)=upper(payload->>'branch_code') and b.active;
  if target_branch is null then raise exception 'active branch not found'; end if;
  if stock_mode not in ('none','self','group') then raise exception 'invalid stock mode'; end if;
  if conversion_value <= 0 then raise exception 'conversion must be greater than zero'; end if;

  select i.base_unit_id into source_base_unit
  from boy_central.items i
  join boy_central.branch_items bi on bi.item_id=i.id and bi.branch_id=target_branch and bi.active
  where i.id=source_item and i.company_id=company and i.active;
  if source_base_unit is null then raise exception 'active source item not found for branch'; end if;

  if stock_mode='group' then
    if target_item is null or target_item=source_item then raise exception 'shared stock target is required'; end if;
    if not exists (
      select 1 from boy_central.items i
      where i.id=target_item and i.company_id=company and i.active and i.track_stock
        and i.stock_target_item_id is null
    ) then raise exception 'active shared stock target not found'; end if;
  else
    target_item := null;
  end if;

  update boy_central.items
  set stock_target_item_id=target_item,
      track_stock=(stock_mode='self'),
      updated_at=now()
  where id=source_item and company_id=company;

  select coalesce(ei.purchase_unit_id,bi.default_purchase_unit_id,source_base_unit)
    into purchase_unit
  from boy_central.branch_items bi
  left join boy_central.expense_items ei on ei.company_id=company and ei.item_id=source_item and ei.active
  where bi.branch_id=target_branch and bi.item_id=source_item
  order by ei.created_at nulls last limit 1;

  update boy_central.expense_items
  set affects_stock=(stock_mode<>'none'),
      requires_quantity=(stock_mode<>'none'),
      requires_unit=(stock_mode<>'none'),
      stock_conversion_to_base=case when stock_mode='none' then stock_conversion_to_base else conversion_value end,
      purchase_unit_id=case when stock_mode='none' then purchase_unit_id else coalesce(purchase_unit,source_base_unit) end,
      updated_at=now()
  where company_id=company and item_id=source_item;

  if stock_mode='group' then
    insert into boy_central.branch_items (company_id,branch_id,item_id,active)
    values (company,target_branch,target_item,true)
    on conflict(branch_id,item_id) do update set active=true,updated_at=now();

    insert into boy_central.item_units
      (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
    values (company,target_item,coalesce(purchase_unit,source_base_unit),1,false,true,false,true)
    on conflict(item_id,unit_id) do update
      set allow_purchase=true,active=true,updated_at=now();
  end if;

  return jsonb_build_object('status','saved','source_item_id',source_item,'target_item_id',target_item,'mode',stock_mode);
end;
$$;

revoke all on function boy_central.admin_save_stock_mapping(jsonb) from public,anon;
grant execute on function boy_central.admin_save_stock_mapping(jsonb) to authenticated;

create or replace function boy_central.admin_save_stock_group(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  company uuid;
  target_branch uuid;
  target_item uuid := nullif(payload->>'target_item_id','')::uuid;
  base_unit uuid := nullif(payload->>'base_unit_id','')::uuid;
  category uuid := nullif(payload->>'category_id','')::uuid;
  member jsonb;
  current_member record;
  selected_ids uuid[] := '{}';
  generated_code text;
begin
  select p.company_id into company
  from boy_central.profiles p
  where p.user_id=actor_id and p.active and p.company_role='admin';
  if company is null then raise exception 'admin access required'; end if;

  select b.id into target_branch
  from boy_central.branches b
  where b.company_id=company and upper(b.code)=upper(payload->>'branch_code') and b.active;
  if target_branch is null then raise exception 'active branch not found'; end if;
  if jsonb_typeof(coalesce(payload->'members','[]'::jsonb)) <> 'array' then raise exception 'members must be an array'; end if;

  if target_item is null then
    if nullif(trim(payload->>'name'),'') is null or base_unit is null or category is null then
      raise exception 'name, base unit and category are required';
    end if;
    if not exists(select 1 from boy_central.units u where u.id=base_unit and u.company_id=company and u.active)
      then raise exception 'active base unit not found'; end if;
    if not exists(select 1 from boy_central.categories c where c.id=category and c.company_id=company and c.active)
      then raise exception 'active category not found'; end if;
    generated_code := 'STOCK-WEB-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
    insert into boy_central.items
      (company_id,code,name,item_type,category_id,base_unit_id,track_stock,purchaseable,issueable,sellable,active)
    values
      (company,generated_code,trim(payload->>'name'),'STOCK_ITEM',category,base_unit,true,false,true,false,true)
    returning id into target_item;
    insert into boy_central.branch_items(company_id,branch_id,item_id,active)
    values(company,target_branch,target_item,true);
    insert into boy_central.item_units
      (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
    values(company,target_item,base_unit,1,true,false,true,true);
  else
    if not exists(
      select 1 from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id
      where i.id=target_item and i.company_id=company and bi.branch_id=target_branch and i.track_stock and i.active
    ) then raise exception 'shared stock item not found'; end if;
    update boy_central.items set name=coalesce(nullif(trim(payload->>'name'),''),name),updated_at=now()
    where id=target_item and company_id=company;
  end if;

  for member in select value from jsonb_array_elements(coalesce(payload->'members','[]'::jsonb)) loop
    selected_ids := array_append(selected_ids,(member->>'source_item_id')::uuid);
    perform boy_central.admin_save_stock_mapping(jsonb_build_object(
      'branch_code',payload->>'branch_code','source_item_id',member->>'source_item_id',
      'mode','group','target_item_id',target_item,
      'conversion_to_target',coalesce(member->>'conversion_to_target','1')
    ));
  end loop;

  for current_member in
    select i.id,coalesce(ei.stock_conversion_to_base,1) conversion_value
    from boy_central.items i
    join boy_central.branch_items bi on bi.item_id=i.id and bi.branch_id=target_branch
    left join boy_central.expense_items ei on ei.item_id=i.id and ei.active
    where i.company_id=company and i.stock_target_item_id=target_item
      and not(i.id=any(selected_ids))
  loop
    perform boy_central.admin_save_stock_mapping(jsonb_build_object(
      'branch_code',payload->>'branch_code','source_item_id',current_member.id,
      'mode','self','conversion_to_target',current_member.conversion_value
    ));
  end loop;

  return jsonb_build_object('status','saved','target_item_id',target_item,'member_count',cardinality(selected_ids));
end;
$$;

revoke all on function boy_central.admin_save_stock_group(jsonb) from public,anon;
grant execute on function boy_central.admin_save_stock_group(jsonb) to authenticated;

create or replace function boy_central.record_expense_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  actor_company uuid;
  line jsonb;
  resolved_line jsonb;
  resolved_lines jsonb := '[]'::jsonb;
  resolved_payload jsonb;
  expense_row boy_central.expense_items%rowtype;
  source_item boy_central.items%rowtype;
  stock_item boy_central.items%rowtype;
  resolved_unit_id uuid;
  resolved_conversion numeric(18,6);
  result jsonb;
  target_transaction_id uuid;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  select p.company_id into actor_company
  from boy_central.profiles p
  where p.user_id=actor_id and p.active;
  if actor_company is null then raise exception 'active profile required'; end if;

  for line in select value from jsonb_array_elements(payload->'lines') loop
    resolved_line := line;
    expense_row.id := null;
    if nullif(line->>'expense_item_id','') is not null then
      select * into expense_row from boy_central.expense_items ei
      where ei.id=(line->>'expense_item_id')::uuid and ei.company_id=actor_company and ei.active;
      if expense_row.id is null then raise exception 'active expense item not found'; end if;

      if expense_row.affects_stock then
        if expense_row.item_id is null then raise exception 'stock target is not configured for expense item %',expense_row.name; end if;
        select * into source_item from boy_central.items i where i.id=expense_row.item_id and i.company_id=actor_company and i.active;
        if source_item.id is null then raise exception 'active purchased item not found for %',expense_row.name; end if;
        select * into stock_item from boy_central.items i
        where i.id=coalesce(source_item.stock_target_item_id,source_item.id)
          and i.company_id=actor_company and i.active and i.track_stock;
        if stock_item.id is null then raise exception 'active stock target not found for %',expense_row.name; end if;

        resolved_unit_id := coalesce(expense_row.purchase_unit_id,source_item.base_unit_id);
        resolved_conversion := coalesce(expense_row.stock_conversion_to_base,1);
        if resolved_unit_id is null or resolved_conversion <= 0 then raise exception 'stock mapping is incomplete for %',expense_row.name; end if;
        if not exists(select 1 from boy_central.item_units iu where iu.item_id=stock_item.id and iu.unit_id=resolved_unit_id and iu.active)
          then raise exception 'purchase unit is not configured for stock target %',stock_item.name; end if;
        resolved_line := resolved_line || jsonb_build_object(
          'item_id',stock_item.id,'unit_id',resolved_unit_id,'conversion_to_base',resolved_conversion
        );
      else
        resolved_line := resolved_line-'item_id'-'unit_id'-'conversion_to_base';
      end if;
    end if;
    resolved_lines := resolved_lines||jsonb_build_array(resolved_line);
  end loop;

  resolved_payload := jsonb_set(payload,'{lines}',resolved_lines,true);
  result := boy_central.record_expense_v2(resolved_payload);
  if result->>'status'<>'duplicate' and coalesce(payload->'payment'->>'method','')='reimbursement_pending' then
    target_transaction_id := (result->>'transaction_id')::uuid;
    update boy_central.payments set status='pending',paid_at=null,
      note=coalesce(note||' · ','')||'รอเบิกค่าใช้จ่าย'
    where transaction_id=target_transaction_id and method='reimbursement_pending';
  end if;
  return result;
end;
$$;

revoke all on function boy_central.record_expense_v3(jsonb) from public,anon;
grant execute on function boy_central.record_expense_v3(jsonb) to authenticated;

notify pgrst,'reload schema';
