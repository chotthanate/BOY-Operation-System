create or replace function boy_central.admin_update_burger_master(payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare
  actor uuid := (select auth.uid()); company uuid; burger uuid; target uuid; kind text;
  category uuid; base_unit uuid; generated_code text; expense_id uuid;
begin
  select p.company_id into company from boy_central.profiles p
  where p.user_id=actor and p.active and p.company_role='admin';
  if company is null then raise exception 'admin access required'; end if;
  select id into burger from boy_central.branches where company_id=company and code='BURGER';
  kind := payload->>'kind'; target := nullif(payload->>'id','')::uuid;

  if kind='item' then
    category := nullif(payload->>'category_id','')::uuid;
    base_unit := nullif(payload->>'base_unit_id','')::uuid;
    if target is null then
      if nullif(trim(payload->>'name'),'') is null or category is null or base_unit is null then
        raise exception 'name, category and base unit are required';
      end if;
      generated_code := 'ITEM-WEB-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
      insert into boy_central.items (company_id,code,name,category_id,base_unit_id,track_stock,purchaseable,issueable,active)
      values (company,generated_code,trim(payload->>'name'),category,base_unit,coalesce((payload->>'track_stock')::boolean,false),true,true,true)
      returning id into target;
      insert into boy_central.branch_items (company_id,branch_id,item_id,active) values (company,burger,target,true);
      insert into boy_central.item_units (company_id,item_id,unit_id,conversion_to_base,is_base_unit,active)
      values (company,target,base_unit,1,true,true);
      insert into boy_central.expense_items (company_id,code,name,category_id,item_id,affects_stock,active)
      values (company,'EXP-'||generated_code,trim(payload->>'name'),category,target,coalesce((payload->>'track_stock')::boolean,false),true)
      returning id into expense_id;
      insert into boy_central.branch_expense_items (branch_id,expense_item_id,active) values (burger,expense_id,true);
    else
      if not exists (select 1 from boy_central.branch_items where branch_id=burger and item_id=target) then raise exception 'burger item not found'; end if;
      update boy_central.items set name=coalesce(nullif(trim(payload->>'name'),''),name),category_id=coalesce(category,category_id),
        base_unit_id=coalesce(base_unit,base_unit_id),track_stock=coalesce((payload->>'track_stock')::boolean,track_stock),
        active=coalesce((payload->>'active')::boolean,active) where id=target and company_id=company;
      update boy_central.expense_items set name=(select name from boy_central.items where id=target),
        category_id=(select category_id from boy_central.items where id=target),
        affects_stock=(select track_stock from boy_central.items where id=target) where item_id=target and company_id=company;
    end if;
  elsif kind='expense_item' then
    category := nullif(payload->>'category_id','')::uuid;
    if target is null then
      generated_code := 'EXP-WEB-' || to_char(clock_timestamp(),'YYYYMMDDHH24MISSMS');
      insert into boy_central.expense_items (company_id,code,name,category_id,affects_stock,active)
      values (company,generated_code,trim(payload->>'name'),category,coalesce((payload->>'affects_stock')::boolean,false),true)
      returning id into target;
      insert into boy_central.branch_expense_items (branch_id,expense_item_id,active) values (burger,target,true);
    else
      if not exists (select 1 from boy_central.branch_expense_items where branch_id=burger and expense_item_id=target) then raise exception 'burger expense item not found'; end if;
      update boy_central.expense_items set name=coalesce(nullif(trim(payload->>'name'),''),name),category_id=coalesce(category,category_id),
        affects_stock=coalesce((payload->>'affects_stock')::boolean,affects_stock),active=coalesce((payload->>'active')::boolean,active)
      where id=target and company_id=company;
    end if;
  else raise exception 'unsupported master kind';
  end if;
  return jsonb_build_object('status','saved','id',target);
end $$;

revoke all on function boy_central.admin_update_burger_master(jsonb) from public, anon;
grant execute on function boy_central.admin_update_burger_master(jsonb) to authenticated;
