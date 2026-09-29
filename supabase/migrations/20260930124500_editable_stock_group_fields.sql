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
  if nullif(trim(payload->>'name'),'') is null or base_unit is null or category is null then
    raise exception 'name, base unit and category are required';
  end if;
  if not exists(select 1 from boy_central.units u where u.id=base_unit and u.company_id=company and u.active)
    then raise exception 'active base unit not found'; end if;
  if not exists(select 1 from boy_central.categories c where c.id=category and c.company_id=company and c.active)
    then raise exception 'active category not found'; end if;

  if target_item is null then
    generated_code := 'STOCK-WEB-'||to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
    insert into boy_central.items
      (company_id,code,name,item_type,category_id,base_unit_id,track_stock,purchaseable,issueable,sellable,active)
    values
      (company,generated_code,trim(payload->>'name'),'STOCK_ITEM',category,base_unit,true,false,true,false,true)
    returning id into target_item;
    insert into boy_central.branch_items(company_id,branch_id,item_id,active)
    values(company,target_branch,target_item,true);
  else
    if not exists(
      select 1 from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id
      where i.id=target_item and i.company_id=company and bi.branch_id=target_branch and i.track_stock and i.active
    ) then raise exception 'shared stock item not found'; end if;
    update boy_central.items
    set name=trim(payload->>'name'),category_id=category,base_unit_id=base_unit,updated_at=now()
    where id=target_item and company_id=company;
    update boy_central.item_units set is_base_unit=false,updated_at=now()
    where item_id=target_item and is_base_unit and unit_id<>base_unit;
  end if;

  insert into boy_central.item_units
    (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
  values(company,target_item,base_unit,1,true,false,true,true)
  on conflict(item_id,unit_id) do update
    set conversion_to_base=1,is_base_unit=true,allow_issue=true,active=true,updated_at=now();

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

notify pgrst,'reload schema';
