-- Order by yogurt type and size; record the actual brand only when BigC receives it.
-- A 5 kg gallon is one stock unit.  A future 1 kg product must use a different pool.
alter table boy_central.bigc_workflow_lines
  add column if not exists brand_allocations jsonb not null default '[]'::jsonb;

alter table boy_central.bigc_workflow_lines
  drop constraint if exists bigc_workflow_lines_brand_allocations_array,
  add constraint bigc_workflow_lines_brand_allocations_array
    check (jsonb_typeof(brand_allocations)='array');

comment on column boy_central.bigc_workflow_lines.brand_allocations is
  'Actual brand UUID and number of containers received against a shared-stock item.';

do $migration$
declare
  company uuid;
  sheet uuid;
  gallon_unit_id uuid;
  ingredient_category_id uuid;
  bigc_branch uuid;
  tawana_branch uuid;
  base_row integer;
  row_data jsonb;
  before_data jsonb;
  catalog_row_id uuid;
  stock_code text;
  stock_name text;
  variant record;
begin
  select b.company_id,b.id into company,bigc_branch
  from boy_central.branches b where b.code='BIGC-CENTRAL-PATTAYA' and b.active limit 1;
  if company is null then raise exception 'BigC branch not found'; end if;
  select b.id into tawana_branch from boy_central.branches b
    where b.company_id=company and b.code='TAWANA' and b.active limit 1;
  select s.id into sheet from boy_central.master_catalog_sheets s
    where s.company_id=company and s.sheet_name='M_สินค้า' for update;
  select u.id into gallon_unit_id from boy_central.units u
    where u.company_id=company and u.code='UNIT-010' and u.active;
  select c.id into ingredient_category_id from boy_central.categories c
    where c.company_id=company and c.code='CAT-001' and c.active;
  if tawana_branch is null or sheet is null or gallon_unit_id is null or ingredient_category_id is null then
    raise exception 'missing Tawana, catalog, gallon unit, or ingredient category';
  end if;

  select coalesce(max(r.row_number),0) into base_row
  from boy_central.master_catalog_rows r where r.sheet_id=sheet;

  for stock_code,stock_name in
    select x.code,x.name from (values
      ('ITEM-YOG-PLAIN-5KG','โยเกิร์ตรสธรรมดา 5 กก.'),
      ('ITEM-YOG-STRAW-5KG','โยเกิร์ตรสสตรอว์เบอร์รี 5 กก.')
    ) x(code,name)
  loop
    row_data:=jsonb_build_object(
      'item_id',stock_code,'ชื่อสินค้า',stock_name,'ประเภทข้อมูล','STOCK_ITEM',
      'category_id','CAT-001','subcategory_id','SUB-0004','base_unit_id','UNIT-010',
      'ซื้อได้',false,'เบิกได้',true,'ขายได้',false,'เปิดใช้งาน',true,
      'ติดตามสต็อก',true,'รูปแบบสต็อก','นับเป็นรายการนี้',
      'stock_target_item_id','','หมายเหตุ','สต็อกรวมเฉพาะรสและขนาด 5 กก.; 1 แกลลอน = 1 หน่วย');
    if not exists(select 1 from boy_central.master_catalog_rows r
      where r.sheet_id=sheet and r.record_key=stock_code) then
      base_row:=base_row+1;
      insert into boy_central.master_catalog_rows
        (company_id,sheet_id,row_number,record_key,row_data,source_version)
      values(company,sheet,base_row,stock_code,row_data,'20261026-yogurt-pool')
      returning id into catalog_row_id;
      insert into boy_central.master_catalog_changes
        (company_id,sheet_id,row_id,action,after_data,actor_label)
      values(company,sheet,catalog_row_id,'insert',row_data,'BigC yogurt shared-stock migration');
    end if;
    insert into boy_central.items
      (company_id,code,name,category_id,base_unit_id,track_stock,purchaseable,issueable,sellable,active,item_type,notes)
    values(company,stock_code,stock_name,ingredient_category_id,gallon_unit_id,true,false,true,false,true,
      'STOCK_ITEM','สต็อกรวมโยเกิร์ตขนาด 5 กก. หน่วยแกลลอน')
    on conflict(company_id,code) do update set
      name=excluded.name,base_unit_id=excluded.base_unit_id,track_stock=true,
      purchaseable=false,issueable=true,active=true,stock_target_item_id=null,updated_at=now();
  end loop;

  for variant in
    select * from (values
      ('ITEM-179258432360852','ITEM-YOG-PLAIN-5KG'),
      ('ITEM-179258435647380','ITEM-YOG-PLAIN-5KG'),
      ('ITEM-179258438336138','ITEM-YOG-PLAIN-5KG'),
      ('ITEM-0046','ITEM-YOG-STRAW-5KG'),
      ('ITEM-0047','ITEM-YOG-STRAW-5KG')
    ) x(variant_code,pool_code)
  loop
    select r.row_data into before_data from boy_central.master_catalog_rows r
    where r.sheet_id=sheet and r.record_key=variant.variant_code for update;
    update boy_central.master_catalog_rows r
    set row_data=r.row_data || jsonb_build_object(
        'ติดตามสต็อก',false,'รูปแบบสต็อก','รวมเข้ารายการอื่น',
        'stock_target_item_id',variant.pool_code,'เบิกได้',false),
      source_version='20261026-yogurt-pool',updated_at=now()
    where r.sheet_id=sheet and r.record_key=variant.variant_code
    returning r.id,r.row_data into catalog_row_id,row_data;
    if not found then raise exception 'missing yogurt catalog variant %',variant.variant_code; end if;
    insert into boy_central.master_catalog_changes
      (company_id,sheet_id,row_id,action,before_data,after_data,actor_label)
    values(company,sheet,catalog_row_id,'update',before_data,row_data,'BigC yogurt shared-stock migration');

    insert into boy_central.items
      (company_id,code,name,category_id,base_unit_id,track_stock,purchaseable,issueable,sellable,active,
       stock_target_item_id,item_type,notes)
    select company,variant.variant_code,r.row_data->>'ชื่อสินค้า',ingredient_category_id,gallon_unit_id,
      false,true,false,false,true,pool.id,'STOCK_ITEM','ยี่ห้อที่ซื้อจริง; เข้าสต็อกรวมตามรสและขนาด'
    from boy_central.master_catalog_rows r
    join boy_central.items pool on pool.company_id=company and pool.code=variant.pool_code
    where r.sheet_id=sheet and r.record_key=variant.variant_code
    on conflict(company_id,code) do update set
      name=excluded.name,track_stock=false,purchaseable=true,issueable=false,
      stock_target_item_id=excluded.stock_target_item_id,active=true,updated_at=now();
  end loop;

  insert into boy_central.item_units
    (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
  select company,i.id,gallon_unit_id,1,true,i.purchaseable,i.issueable,true
  from boy_central.items i
  where i.company_id=company and (i.code like 'ITEM-YOG-%-5KG' or i.code in
    ('ITEM-179258432360852','ITEM-179258435647380','ITEM-179258438336138','ITEM-0046','ITEM-0047'))
  on conflict(item_id,unit_id) do update set
    conversion_to_base=1,is_base_unit=true,allow_purchase=excluded.allow_purchase,
    allow_issue=excluded.allow_issue,active=true,updated_at=now();

  insert into boy_central.branch_items(company_id,branch_id,item_id,active)
  select company,b.id,i.id,true
  from (values(bigc_branch),(tawana_branch)) b(id)
  cross join boy_central.items i
  where i.company_id=company and (i.code like 'ITEM-YOG-%-5KG' or i.code in
    ('ITEM-179258432360852','ITEM-179258435647380','ITEM-179258438336138','ITEM-0046','ITEM-0047'))
  on conflict(branch_id,item_id) do update set active=true,updated_at=now();

  insert into boy_central.expense_items
    (company_id,code,name,category_id,item_id,affects_stock,active,requires_quantity,
     requires_unit,requires_supplier,requires_receipt,purchase_unit_id,stock_conversion_to_base,notes)
  select company,'EXP-YOG-'||i.code,i.name,ingredient_category_id,i.id,true,true,true,
    true,false,false,gallon_unit_id,1,'ซื้อยี่ห้อนี้; เพิ่มสต็อกรวมตามรสและขนาด 5 กก.'
  from boy_central.items i
  where i.company_id=company and i.code in
    ('ITEM-179258432360852','ITEM-179258435647380','ITEM-179258438336138','ITEM-0046','ITEM-0047')
  on conflict(company_id,code) do update set
    item_id=excluded.item_id,affects_stock=true,active=true,
    purchase_unit_id=excluded.purchase_unit_id,stock_conversion_to_base=1,updated_at=now();

  insert into boy_central.branch_expense_items(branch_id,expense_item_id,active)
  select tawana_branch,e.id,true from boy_central.expense_items e
  where e.company_id=company and e.code like 'EXP-YOG-%'
  on conflict(branch_id,expense_item_id) do update set active=true,updated_at=now();

  update boy_central.bigc_workflow_settings settings
  set menu_config=(
    select jsonb_agg(
      case when entry->>'key'='item-d80332e5' then
        entry || jsonb_build_object('masterItemId','ITEM-YOG-PLAIN-5KG',
          'itemId',(select id from boy_central.items where company_id=company and code='ITEM-YOG-PLAIN-5KG'),
          'displayName','โยเกิร์ตธรรมดา 5 กก. (แกลลอน)','name','โยเกิร์ตธรรมดา 5 กก.',
          'unit','แกลลอน','inputMode','quantity')
      when entry->>'key'='item-86ca839d' then
        entry || jsonb_build_object('masterItemId','ITEM-YOG-STRAW-5KG',
          'itemId',(select id from boy_central.items where company_id=company and code='ITEM-YOG-STRAW-5KG'),
          'displayName','โยเกิร์ตสตรอว์เบอร์รี 5 กก. (แกลลอน)',
          'name','โยเกิร์ตสตรอว์เบอร์รี 5 กก.','unit','แกลลอน','inputMode','quantity')
      else entry end order by ordinality)
    from jsonb_array_elements(settings.menu_config) with ordinality as menu(entry,ordinality)
  ),version=settings.version+1,updated_at=now()
  where settings.branch_id=bigc_branch;
  update boy_central.master_catalog_sheets
  set source_revision=extract(epoch from clock_timestamp())::text,updated_at=now()
  where id=sheet;
end
$migration$;

-- Keep the transfer posting outside workflow_lines: the existing save RPC replaces
-- those lines on a correction.  Reconciliation posts only the difference.
create table if not exists boy_central.bigc_shared_stock_postings (
  workflow_id uuid not null references boy_central.bigc_workflows(id) on delete cascade,
  line_key text not null,
  item_id uuid not null references boy_central.items(id),
  quantity numeric(18,6) not null check (quantity > 0),
  unit_cost numeric(18,6) not null default 0,
  updated_at timestamptz not null default now(),
  primary key(workflow_id,line_key,item_id)
);
create index if not exists bigc_shared_stock_postings_item_idx
  on boy_central.bigc_shared_stock_postings(item_id);
alter table boy_central.bigc_shared_stock_postings enable row level security;

create or replace function boy_central_private.reconcile_bigc_shared_stock(target_workflow_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  workflow_row boy_central.bigc_workflows%rowtype;
  source_branch uuid;
  source_location uuid;
  target_location uuid;
  posting record;
  balance_row boy_central.inventory_balances%rowtype;
  delta numeric(18,6);
  movement_delta numeric(18,6);
  cost numeric(18,6);
  next_quantity numeric(18,6);
  next_value numeric(18,2);
  loop_location uuid;
  loop_branch uuid;
  direction text;
begin
  select * into workflow_row from boy_central.bigc_workflows
    where id=target_workflow_id for update;
  if workflow_row.id is null or workflow_row.workflow_type<>'receive' then return; end if;
  select id into source_branch from boy_central.branches
    where company_id=workflow_row.company_id and code='TAWANA' and active;
  select id into source_location from boy_central.inventory_locations
    where branch_id=source_branch and active order by (location_type='main') desc,created_at limit 1;
  select id into target_location from boy_central.inventory_locations
    where branch_id=workflow_row.branch_id and active order by (location_type='main') desc,created_at limit 1;
  if source_location is null or target_location is null then
    raise exception 'stock location missing for BigC transfer';
  end if;

  for posting in
    with wanted as (
      select l.line_key,l.item_id,l.quantity
      from boy_central.bigc_workflow_lines l
      join boy_central.items i on i.id=l.item_id
      where l.workflow_id=target_workflow_id and l.received and l.quantity>0
        and i.track_stock and i.stock_target_item_id is null
        and exists(select 1 from boy_central.items child
          where child.stock_target_item_id=i.id and child.active)
    )
    select coalesce(w.line_key,p.line_key) line_key,
      coalesce(w.item_id,p.item_id) item_id,
      coalesce(w.quantity,0) wanted_quantity,
      coalesce(p.quantity,0) posted_quantity,
      coalesce(p.unit_cost,0) posted_cost
    from wanted w full join boy_central.bigc_shared_stock_postings p
      on p.workflow_id=target_workflow_id and p.line_key=w.line_key and p.item_id=w.item_id
    where p.workflow_id=target_workflow_id or w.line_key is not null
  loop
    delta:=posting.wanted_quantity-posting.posted_quantity;
    if delta=0 then continue; end if;
    insert into boy_central.inventory_balances
      (company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
    values(workflow_row.company_id,source_branch,source_location,posting.item_id,0,0,0)
    on conflict(location_id,item_id) do nothing;
    select * into balance_row from boy_central.inventory_balances
      where location_id=source_location and item_id=posting.item_id for update;
    if delta>0 and balance_row.quantity_on_hand<delta then
      raise exception 'สต็อกรวมที่ทาวน่าไม่พอ กรุณานับสต็อกหรือบันทึกของที่ซื้อก่อนรับเข้าบิ๊กซี';
    end if;
    cost:=coalesce(balance_row.average_unit_cost,0);
    if delta<0 then cost:=posting.posted_cost; end if;
    cost:=coalesce(cost,0);

    for direction,loop_branch,loop_location,movement_delta in
      select 'source'::text,source_branch,source_location,-delta
      union all select 'target',workflow_row.branch_id,target_location,delta
    loop
      insert into boy_central.inventory_balances
        (company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
      values(workflow_row.company_id,loop_branch,loop_location,posting.item_id,0,0,0)
      on conflict(location_id,item_id) do nothing;
      select * into balance_row from boy_central.inventory_balances
      where location_id=loop_location and item_id=posting.item_id for update;
      next_quantity:=balance_row.quantity_on_hand+movement_delta;
      if next_quantity<0 then
        raise exception 'ยอดสต็อกไม่พอสำหรับแก้ไขรายการรับ BigC';
      end if;
      next_value:=round(balance_row.inventory_value+movement_delta*cost,2);
      insert into boy_central.stock_movements
        (company_id,branch_id,location_id,item_id,movement_type,quantity_before,
         quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,
         external_id,occurred_at,created_by,reason)
      values(workflow_row.company_id,loop_branch,loop_location,posting.item_id,
        case when movement_delta>0 then 'transfer_in' else 'transfer_out' end,
        balance_row.quantity_on_hand,movement_delta,next_quantity,cost,
        round(movement_delta*cost,2),'bigc_shared_stock',
        target_workflow_id::text||':'||posting.line_key||':'||posting.item_id::text||':'||workflow_row.revision||':'||direction,
        now(),workflow_row.submitted_by,'BigC รับโยเกิร์ตตามยี่ห้อที่บันทึก');
      update boy_central.inventory_balances b set
        quantity_on_hand=next_quantity,inventory_value=next_value,
        average_unit_cost=case when next_quantity>0 then greatest(next_value/next_quantity,0)
          else b.average_unit_cost end,
        updated_at=now()
      where b.id=balance_row.id;
    end loop;

    if posting.wanted_quantity>0 then
      insert into boy_central.bigc_shared_stock_postings
        (workflow_id,line_key,item_id,quantity,unit_cost)
      values(target_workflow_id,posting.line_key,posting.item_id,posting.wanted_quantity,cost)
      on conflict(workflow_id,line_key,item_id) do update set
        quantity=excluded.quantity,unit_cost=excluded.unit_cost,updated_at=now();
    else
      delete from boy_central.bigc_shared_stock_postings p
      where p.workflow_id=target_workflow_id and p.line_key=posting.line_key and p.item_id=posting.item_id;
    end if;
  end loop;
end
$function$;

revoke all on function boy_central_private.reconcile_bigc_shared_stock(uuid)
  from public,anon,authenticated;

-- A BigC item may be linked for costing even when the central item does not
-- count stock.  Materialize its UUID only when a manager selects that code.
create or replace function boy_central.ensure_bigc_catalog_items(target_codes text[])
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  actor uuid:=auth.uid();
  target_branch boy_central.branches%rowtype;
  catalog record;
  item_uuid uuid;
  unit_uuid uuid;
  category_uuid uuid;
  output jsonb:='{}'::jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into target_branch from boy_central.branches
    where code='BIGC-CENTRAL-PATTAYA' and active limit 1;
  if not boy_central_private.has_branch_access(target_branch.id,array['admin','manager']) then
    raise exception 'manager access required';
  end if;
  if coalesce(array_length(target_codes,1),0)>100 then raise exception 'too many items'; end if;

  for catalog in
    select r.record_key,r.row_data
    from boy_central.master_catalog_rows r
    join boy_central.master_catalog_sheets s on s.id=r.sheet_id
    where s.company_id=target_branch.company_id and s.sheet_name='M_สินค้า'
      and r.record_key=any(target_codes)
      and r.active and coalesce((r.row_data->>'เปิดใช้งาน')::boolean,true)
  loop
    select id into item_uuid from boy_central.items
      where company_id=target_branch.company_id and code=catalog.record_key;
    if item_uuid is null then
      select id into unit_uuid from boy_central.units
        where company_id=target_branch.company_id
          and code=catalog.row_data->>'base_unit_id' and active;
      select id into category_uuid from boy_central.categories
        where company_id=target_branch.company_id
          and code=catalog.row_data->>'category_id' and active;
      if unit_uuid is null then
        output:=output||jsonb_build_object(catalog.record_key,null);
        continue;
      end if;
      insert into boy_central.items
        (company_id,code,name,category_id,base_unit_id,track_stock,
         purchaseable,issueable,sellable,active,item_type,notes)
      values(target_branch.company_id,catalog.record_key,
        trim(catalog.row_data->>'ชื่อสินค้า'),category_uuid,unit_uuid,
        coalesce((catalog.row_data->>'ติดตามสต็อก')::boolean,false),
        coalesce((catalog.row_data->>'ซื้อได้')::boolean,true),
        coalesce((catalog.row_data->>'เบิกได้')::boolean,true),
        coalesce((catalog.row_data->>'ขายได้')::boolean,false),true,
        case when catalog.row_data->>'ประเภทข้อมูล'='NON_STOCK_ITEM'
          then 'NON_STOCK_ITEM' else 'STOCK_ITEM' end,
        'เชื่อมรายการ BigC กับข้อมูลกลาง; การผูกไม่เปลี่ยนการติดตามสต็อก')
      on conflict(company_id,code) do nothing
      returning id into item_uuid;
      if item_uuid is null then
        select id into item_uuid from boy_central.items
          where company_id=target_branch.company_id and code=catalog.record_key;
      end if;
      if item_uuid is null then raise exception 'cannot create item %',catalog.record_key; end if;
    end if;
    select base_unit_id into unit_uuid from boy_central.items where id=item_uuid;
    insert into boy_central.item_units
      (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
    values(target_branch.company_id,item_uuid,unit_uuid,1,true,true,true,true)
    on conflict(item_id,unit_id) do nothing;
    insert into boy_central.branch_items(company_id,branch_id,item_id,active)
    values(target_branch.company_id,target_branch.id,item_uuid,true)
    on conflict(branch_id,item_id) do update set active=true,updated_at=now();
    output:=output||jsonb_build_object(catalog.record_key,item_uuid);
  end loop;
  if (select count(distinct code) from unnest(target_codes) code)
    <> (select count(*) from jsonb_object_keys(output)) then
    raise exception 'one or more catalog items are inactive or missing';
  end if;
  return output;
end
$function$;

revoke all on function boy_central.ensure_bigc_catalog_items(text[]) from public,anon;
grant execute on function boy_central.ensure_bigc_catalog_items(text[]) to authenticated;

-- Standard purchased goods use a weighted monthly price in their own base unit.
-- This path is independent of track_stock and also covers pooled brands.
create or replace function boy_central_private.refresh_bigc_standard_costs(target_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  workflow_row boy_central.bigc_workflows%rowtype;
  source_branch uuid;
  line_row boy_central.bigc_workflow_lines%rowtype;
  price record;
  target_month date;
  receipt_conversion numeric(18,6);
  posted integer:=0;
begin
  select * into workflow_row from boy_central.bigc_workflows where id=target_workflow_id;
  if workflow_row.id is null or workflow_row.workflow_type<>'receive' then
    return jsonb_build_object('posted',0);
  end if;
  select id into source_branch from boy_central.branches
    where company_id=workflow_row.company_id and code='TAWANA' and active;
  target_month:=date_trunc('month',workflow_row.business_date)::date;
  for line_row in select * from boy_central.bigc_workflow_lines
    where workflow_id=target_workflow_id and received and quantity>0
      and handling_type='standard' and item_id is not null
  loop
    select iu.conversion_to_base into receipt_conversion
    from boy_central.item_units iu
    join boy_central.units u on u.id=iu.unit_id
    where iu.item_id=line_row.item_id and iu.active
      and lower(trim(u.name))=lower(trim(coalesce(line_row.unit_name,'')))
    limit 1;
    if receipt_conversion is null then continue; end if;
    select month_start,total_quantity,total_value,line_count,line_ids
    into price
    from (
      select date_trunc('month',t.transaction_date)::date month_start,
        sum(coalesce(nullif(tl.base_quantity,0),tl.quantity*tl.conversion_to_base)) total_quantity,
        sum(tl.line_total) total_value,count(*)::integer line_count,
        array_agg(tl.id order by tl.id) line_ids
      from boy_central.transactions t
      join boy_central.transaction_lines tl on tl.transaction_id=t.id
      left join boy_central.expense_items e on e.id=tl.expense_item_id
      join boy_central.items purchased on purchased.id=coalesce(tl.item_id,e.item_id)
      where t.company_id=workflow_row.company_id and t.branch_id=source_branch
        and t.status='confirmed' and t.transaction_type in ('expense','purchase')
        and t.transaction_date>=target_month-interval '12 months'
        and t.transaction_date<target_month+interval '1 month'
        and coalesce(purchased.stock_target_item_id,purchased.id)=line_row.item_id
        and tl.line_total>0
        and coalesce(nullif(tl.base_quantity,0),tl.quantity*tl.conversion_to_base)>0
      group by 1
    ) monthly where total_quantity>0
    order by month_start desc limit 1;
    if price.total_quantity is null then continue; end if;
    update boy_central.branch_cost_allocations a set
      cost_status='provisional',pending_reason=null,
      raw_item_id=line_row.item_id,price_source_month=price.month_start,
      price_fallback_months=((extract(year from age(target_month,price.month_start))*12)
        +extract(month from age(target_month,price.month_start)))::integer,
      price_source_quantity=price.total_quantity,price_source_value=price.total_value,
      price_source_line_count=price.line_count,price_source_line_ids=price.line_ids,
      source_branch_cost_delta=-round(line_row.quantity*receipt_conversion*price.total_value/price.total_quantity,4),
      target_branch_cost_delta=round(line_row.quantity*receipt_conversion*price.total_value/price.total_quantity,4),
      provenance=a.provenance||jsonb_build_object(
        'price_method','tawana_weighted_monthly_purchase_base_unit',
        'price_is_provisional',true,'receipt_conversion_to_base',receipt_conversion,
        'unit_cost_per_base_unit',price.total_value/price.total_quantity,
        'price_source_line_ids',to_jsonb(price.line_ids)),
      updated_at=now()
    where a.workflow_id=target_workflow_id and a.line_key=line_row.line_key
      and a.cost_status='pending';
    if found then posted:=posted+1; end if;
  end loop;
  return jsonb_build_object('posted',posted);
end
$function$;

revoke all on function boy_central_private.refresh_bigc_standard_costs(uuid)
  from public,anon,authenticated;

alter function boy_central_private.refresh_bigc_interbranch_costs(uuid)
  rename to refresh_bigc_interbranch_costs_fruit;

create function boy_central_private.refresh_bigc_interbranch_costs(target_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  fruit_result jsonb;
  standard_result jsonb;
begin
  fruit_result:=boy_central_private.refresh_bigc_interbranch_costs_fruit(target_workflow_id);
  standard_result:=boy_central_private.refresh_bigc_standard_costs(target_workflow_id);
  return fruit_result||jsonb_build_object('standard',standard_result);
end
$function$;

revoke all on function boy_central_private.refresh_bigc_interbranch_costs(uuid)
  from public,anon,authenticated;

create or replace function boy_central.save_bigc_v2_workflow(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  actor uuid:=auth.uid();
  target_branch boy_central.branches%rowtype;
  target_id uuid;
  target_type text:=payload->>'workflow_type';
  target_date date;
  line jsonb;
  line_no integer:=0;
  line_item_id uuid;
  line_quantity numeric;
  allocation jsonb;
  allocation_item_id uuid;
  allocation_quantity numeric;
  allocation_total numeric;
  allocation_count integer;
  allocation_codes uuid[];
  weight_value numeric(18,6);
  handling_value text;
  basis_value text;
  costing_result jsonb:=jsonb_build_object('status','not_applicable');
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_type not in ('close_order','receive','return') then raise exception 'invalid workflow_type'; end if;
  select * into target_branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if target_branch.id is null then raise exception 'BigC branch not found'; end if;
  if not boy_central_private.has_branch_access(target_branch.id,array['admin','manager','staff']) then
    raise exception 'branch access denied';
  end if;
  target_date:=coalesce(nullif(payload->>'business_date','')::date,current_date);

  insert into boy_central.bigc_workflows(
    company_id,branch_id,business_date,workflow_type,status,source_workflow_id,
    cash_amount,transfer_amount,thai_chuay_thai_amount,sheet_sync_status,sheet_sync_error,
    submitted_by,submitted_at,updated_at
  ) values(
    target_branch.company_id,target_branch.id,target_date,target_type,'submitted',
    nullif(payload->>'source_workflow_id','')::uuid,
    greatest(coalesce(nullif(payload->>'cash_amount','')::numeric,0),0),
    greatest(coalesce(nullif(payload->>'transfer_amount','')::numeric,0),0),
    greatest(coalesce(nullif(payload->>'thai_chuay_thai_amount','')::numeric,0),0),
    'pending',null,actor,now(),now()
  ) on conflict(branch_id,business_date,workflow_type) do update set
    status='submitted',source_workflow_id=excluded.source_workflow_id,
    cash_amount=excluded.cash_amount,transfer_amount=excluded.transfer_amount,
    thai_chuay_thai_amount=excluded.thai_chuay_thai_amount,
    sheet_sync_status='pending',sheet_sync_error=null,
    revision=boy_central.bigc_workflows.revision+1,
    submitted_by=actor,submitted_at=now(),updated_at=now()
  returning id into target_id;

  delete from boy_central.bigc_workflow_lines where workflow_id=target_id;
  for line in select value from jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)) loop
    line_no:=line_no+1;
    if trim(coalesce(line->>'item_name',''))='' then continue; end if;
    line_item_id:=nullif(line->>'item_id','')::uuid;
    line_quantity:=greatest(coalesce(nullif(line->>'quantity','')::numeric,0),0);
    if line_item_id is not null and not exists(select 1 from boy_central.items i
      where i.id=line_item_id and i.company_id=target_branch.company_id and i.active) then
      raise exception 'item not active in central catalog: %',line_item_id;
    end if;

    if target_type='receive' and line_item_id is not null and exists(
      select 1 from boy_central.items child
      where child.stock_target_item_id=line_item_id and child.active
    ) then
      if jsonb_typeof(coalesce(line->'brand_allocations','[]'::jsonb))<>'array'
        or jsonb_array_length(coalesce(line->'brand_allocations','[]'::jsonb))=0 then
        raise exception 'กรุณาเลือกยี่ห้อที่รับจริงสำหรับ %',line->>'item_name';
      end if;
      allocation_total:=0; allocation_count:=0; allocation_codes:=array[]::uuid[];
      for allocation in select value from jsonb_array_elements(line->'brand_allocations') loop
        allocation_item_id:=nullif(allocation->>'item_id','')::uuid;
        allocation_quantity:=nullif(allocation->>'quantity','')::numeric;
        if allocation_quantity is null or allocation_quantity<=0
          or allocation_quantity<>trunc(allocation_quantity) then
          raise exception 'จำนวนโยเกิร์ตแต่ละยี่ห้อต้องเป็นจำนวนเต็มแกลลอน';
        end if;
        if allocation_item_id=any(allocation_codes) or not exists(
          select 1 from boy_central.items child
          where child.id=allocation_item_id and child.company_id=target_branch.company_id
            and child.active and child.stock_target_item_id=line_item_id
        ) then raise exception 'ยี่ห้อไม่ถูกต้องหรือซ้ำสำหรับ %',line->>'item_name'; end if;
        allocation_codes:=array_append(allocation_codes,allocation_item_id);
        allocation_total:=allocation_total+allocation_quantity;
        allocation_count:=allocation_count+1;
      end loop;
      if allocation_total<>line_quantity then
        raise exception 'จำนวนแต่ละยี่ห้อรวมกันไม่ตรงกับที่รับสำหรับ %',line->>'item_name';
      end if;
    elsif jsonb_array_length(coalesce(line->'brand_allocations','[]'::jsonb))>0 then
      raise exception 'brand allocation requires a shared-stock item';
    end if;

    weight_value:=coalesce(nullif(line->>'actual_weight_kg','')::numeric,
      nullif(line->>'observed_weight_kg','')::numeric);
    if weight_value is not null and weight_value<=0 then weight_value:=null; end if;
    handling_value:=case when line->>'handling_type' in
      ('standard','whole_fruit','prepared','juiced','consignment')
      then line->>'handling_type' else 'standard' end;
    basis_value:=case
      when line->>'measurement_basis' in ('raw','estimated_raw','finished','unknown')
        then line->>'measurement_basis'
      when line->>'costing_basis'='estimated_raw_piece' then 'estimated_raw'
      when line->>'costing_basis'='actual_raw_weight_kg' then 'raw'
      when line->>'costing_basis'='backend_yield_from_actual_weight' then 'finished'
      when handling_value='whole_fruit' then 'raw'
      when handling_value in ('prepared','juiced') then 'finished'
      else 'unknown' end;

    insert into boy_central.bigc_workflow_lines(
      company_id,workflow_id,line_key,source_line_key,item_id,master_item_id,item_name,
      category_name,unit_name,input_mode,quantity,received,sort_order,estimated_unit_cost,
      estimated_value,note,actual_weight_kg,handling_type,costing_basis,
      measurement_basis,brand_allocations
    ) values(
      target_branch.company_id,target_id,coalesce(nullif(line->>'line_key',''),'line-'||line_no),
      nullif(line->>'source_line_key',''),line_item_id,nullif(trim(line->>'master_item_id'),''),
      trim(line->>'item_name'),nullif(trim(line->>'category_name'),''),
      nullif(trim(line->>'unit_name'),''),case when line->>'input_mode'='weight' then 'weight' else 'quantity' end,
      line_quantity,coalesce((line->>'received')::boolean,true),
      coalesce(nullif(line->>'sort_order','')::integer,line_no),
      nullif(line->>'estimated_unit_cost','')::numeric,nullif(line->>'estimated_value','')::numeric,
      nullif(trim(line->>'note'),''),weight_value,handling_value,
      nullif(line->>'costing_basis',''),basis_value,
      case when target_type='receive' then coalesce(line->'brand_allocations','[]'::jsonb)
        else '[]'::jsonb end
    );
  end loop;

  if target_type in ('receive','return') then
    costing_result:=boy_central_private.refresh_bigc_interbranch_costs(target_id);
  end if;
  if target_type='receive' then
    perform boy_central_private.reconcile_bigc_shared_stock(target_id);
  end if;
  delete from boy_central.bigc_workflow_drafts
    where branch_id=target_branch.id and business_date=target_date and user_id=actor;
  return jsonb_build_object('status','saved','workflow_id',target_id,
    'sheet_sync_status','pending','costing',costing_result);
end
$function$;

revoke all on function boy_central.save_bigc_v2_workflow(jsonb) from public,anon;
grant execute on function boy_central.save_bigc_v2_workflow(jsonb) to authenticated;
notify pgrst,'reload schema';
