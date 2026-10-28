-- Three interchangeable 1 kg mulberry bags share one inventory balance.
-- The purchase record keeps its actual brand; BigC orders the pooled item
-- and records the delivered brand allocation on receipt.
do $migration$
declare
  company uuid;
  sheet uuid;
  bigc_branch uuid;
  tawana_branch uuid;
  bag_unit uuid;
  ingredient_category uuid;
  pool_id uuid;
  pool_row uuid;
  next_row integer;
  pool_data jsonb;
  variant record;
  before_data jsonb;
  after_data jsonb;
  variant_row uuid;
  variant_id uuid;
  target_branch_id uuid;
begin
  select b.company_id,b.id into company,bigc_branch
  from boy_central.branches b where b.code='BIGC-CENTRAL-PATTAYA' and b.active limit 1;
  select b.id into tawana_branch from boy_central.branches b
  where b.company_id=company and b.code='TAWANA' and b.active limit 1;
  select s.id into sheet from boy_central.master_catalog_sheets s
  where s.company_id=company and s.sheet_name='M_สินค้า' for update;
  select u.id into bag_unit from boy_central.units u
  where u.company_id=company and u.code='UNIT-001' and u.active;
  select c.id into ingredient_category from boy_central.categories c
  where c.company_id=company and c.code='CAT-001' and c.active;
  if company is null or bigc_branch is null or tawana_branch is null
    or sheet is null or bag_unit is null or ingredient_category is null then
    raise exception 'BigC mulberry migration: missing branch, catalog, bag unit, or category';
  end if;
  if (select count(*) from boy_central.master_catalog_rows r
      where r.sheet_id=sheet and r.record_key in ('ITEM-0039','ITEM-0350','ITEM-0351'))<>3 then
    raise exception 'BigC mulberry migration: expected all three brand catalog rows';
  end if;
  if exists(select 1 from boy_central.items i
    where i.company_id=company and i.code in ('ITEM-0039','ITEM-0350','ITEM-0351')) then
    raise exception 'BigC mulberry migration: brand inventory exists; reconcile balances before grouping';
  end if;
  if exists(select 1 from boy_central.master_catalog_rows r
    where r.sheet_id=sheet and r.record_key='ITEM-MULBERRY-FROZEN-1KG') then
    raise exception 'BigC mulberry migration: pooled catalog item already exists';
  end if;

  select coalesce(max(r.row_number),0)+1 into next_row
  from boy_central.master_catalog_rows r where r.sheet_id=sheet;
  pool_data:=jsonb_build_object(
    'item_id','ITEM-MULBERRY-FROZEN-1KG',
    'ชื่อสินค้า','มัลเบอร์รีแช่แข็ง 1 กก.',
    'ประเภทข้อมูล','STOCK_ITEM',
    'category_id','CAT-001','subcategory_id','SUB-0003','base_unit_id','UNIT-001',
    'ซื้อได้',false,'เบิกได้',true,'ขายได้',false,'เปิดใช้งาน',true,
    'ติดตามสต็อก',true,'รูปแบบสต็อก','นับเป็นรายการนี้','stock_target_item_id','',
    'หมายเหตุ','สต็อกรวม 3 ยี่ห้อ ขนาด 1 กก. เท่านั้น; 1 ถุง = 1 หน่วย');
  insert into boy_central.master_catalog_rows
    (company_id,sheet_id,row_number,record_key,row_data,source_version)
  values(company,sheet,next_row,'ITEM-MULBERRY-FROZEN-1KG',pool_data,'20261028-mulberry-pool')
  returning id into pool_row;
  insert into boy_central.master_catalog_changes
    (company_id,sheet_id,row_id,action,after_data,actor_label)
  values(company,sheet,pool_row,'insert',pool_data,'BigC mulberry shared-stock migration');

  insert into boy_central.items
    (company_id,code,name,category_id,base_unit_id,track_stock,purchaseable,issueable,sellable,active,item_type,notes)
  values(company,'ITEM-MULBERRY-FROZEN-1KG','มัลเบอร์รีแช่แข็ง 1 กก.',
    ingredient_category,bag_unit,true,false,true,false,true,'STOCK_ITEM',
    'สต็อกรวมมัลเบอร์รีแช่แข็ง 3 ยี่ห้อ ขนาด 1 กก. หน่วยถุง')
  returning id into pool_id;

  for variant in select x.code from (values
    ('ITEM-0039'),('ITEM-0350'),('ITEM-0351')) x(code)
  loop
    select r.row_data into before_data from boy_central.master_catalog_rows r
    where r.sheet_id=sheet and r.record_key=variant.code for update;
    if before_data->>'base_unit_id'<>'UNIT-001' then
      raise exception 'BigC mulberry migration: % is not measured in bags',variant.code;
    end if;
    update boy_central.master_catalog_rows r set
      row_data=r.row_data||jsonb_build_object(
        'ติดตามสต็อก',false,'รูปแบบสต็อก','รวมเข้ารายการอื่น',
        'stock_target_item_id','ITEM-MULBERRY-FROZEN-1KG','เบิกได้',false),
      source_version='20261028-mulberry-pool',updated_at=now()
    where r.sheet_id=sheet and r.record_key=variant.code
    returning r.id,r.row_data into variant_row,after_data;
    insert into boy_central.master_catalog_changes
      (company_id,sheet_id,row_id,action,before_data,after_data,actor_label)
    values(company,sheet,variant_row,'update',before_data,after_data,
      'BigC mulberry shared-stock migration');

    insert into boy_central.items
      (company_id,code,name,category_id,base_unit_id,track_stock,purchaseable,issueable,sellable,active,
       stock_target_item_id,item_type,notes)
    values(company,variant.code,after_data->>'ชื่อสินค้า',ingredient_category,bag_unit,
      false,true,false,false,true,pool_id,'STOCK_ITEM',
      'ซื้อยี่ห้อนี้จริง; รวมสต็อกมัลเบอร์รีแช่แข็ง 1 กก.')
    returning id into variant_id;
    insert into boy_central.item_units
      (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
    values(company,variant_id,bag_unit,1,true,true,false,true);
    insert into boy_central.expense_items
      (company_id,code,name,category_id,item_id,affects_stock,active,requires_quantity,
       requires_unit,requires_supplier,requires_receipt,purchase_unit_id,stock_conversion_to_base,notes)
    values(company,'EXP-MUL-'||variant.code,after_data->>'ชื่อสินค้า',ingredient_category,
      variant_id,true,true,true,true,false,false,bag_unit,1,
      'ซื้อมัลเบอร์รียี่ห้อนี้; เพิ่มเข้าสต็อกรวมขนาด 1 กก.')
    on conflict(company_id,code) do update set
      item_id=excluded.item_id,affects_stock=true,active=true,
      purchase_unit_id=excluded.purchase_unit_id,stock_conversion_to_base=1,updated_at=now();
  end loop;

  insert into boy_central.item_units
    (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
  values(company,pool_id,bag_unit,1,true,false,true,true);
  foreach target_branch_id in array array[bigc_branch,tawana_branch] loop
    insert into boy_central.branch_items(company_id,branch_id,item_id,active)
    select company,target_branch_id,i.id,true from boy_central.items i
    where i.company_id=company and i.code in
      ('ITEM-MULBERRY-FROZEN-1KG','ITEM-0039','ITEM-0350','ITEM-0351')
    on conflict(branch_id,item_id) do update set active=true,updated_at=now();
  end loop;
  insert into boy_central.branch_expense_items(branch_id,expense_item_id,active)
  select tawana_branch,e.id,true from boy_central.expense_items e
  where e.company_id=company and e.code in
    ('EXP-MUL-ITEM-0039','EXP-MUL-ITEM-0350','EXP-MUL-ITEM-0351')
  on conflict(branch_id,expense_item_id) do update set active=true,updated_at=now();

  update boy_central.bigc_workflow_settings settings set
    menu_config=(select jsonb_agg(
      case when entry->>'key'='item-1282ec6d' then entry||jsonb_build_object(
        'masterItemId','ITEM-MULBERRY-FROZEN-1KG',
        'masterItemIds',jsonb_build_array('ITEM-MULBERRY-FROZEN-1KG',
          'ITEM-0039','ITEM-0350','ITEM-0351'),
        'itemId',pool_id)
      else entry end order by ordinality)
      from jsonb_array_elements(settings.menu_config) with ordinality as menu(entry,ordinality)),
    version=settings.version+1,updated_at=now()
  where settings.branch_id=bigc_branch;
  if not found then raise exception 'BigC mulberry migration: workflow settings missing'; end if;
  update boy_central.master_catalog_sheets
  set source_revision=extract(epoch from clock_timestamp())::text,updated_at=now()
  where id=sheet;
end
$migration$;
