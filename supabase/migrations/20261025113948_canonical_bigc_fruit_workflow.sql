-- One fruit has one canonical master item.  Terms such as box, bag, bottle,
-- peeled and juiced describe the BigC receiving form, not another product.

do $migration$
declare
  target_company uuid;
  bigc_branch uuid;
  tawana_branch uuid;
  fruit_category uuid;
  row_item record;
begin
  select b.company_id,b.id into target_company,bigc_branch
  from boy_central.branches b
  where b.code='BIGC-CENTRAL-PATTAYA' and b.active
  limit 1;
  if target_company is null then raise exception 'active BigC branch not found'; end if;

  select b.id into tawana_branch from boy_central.branches b
  where b.company_id=target_company and b.code='TAWANA' and b.active limit 1;
  if tawana_branch is null then raise exception 'active Tawana branch not found'; end if;

  select c.id into fruit_category from boy_central.categories c
  where c.company_id=target_company and c.code='SUB-0001' and c.active limit 1;
  if fruit_category is null then raise exception 'fruit category SUB-0001 not found'; end if;

  -- Keep legacy prepared rows for audit/history, but remove them from all live pickers.
  update boy_central.master_catalog_rows r
  set row_data=r.row_data || jsonb_build_object(
      'เปิดใช้งาน',false,
      'สถานะตรวจสอบ','ยุบเข้ารายการผลไม้หลัก',
      'หมายเหตุ',concat_ws(' · ',nullif(r.row_data->>'หมายเหตุ',''),'เลิกใช้รายการแยกตามรูปแบบรับของ; BigC จะแสดงชื่อกล่อง/ถุง/ขวดจากเมนูรับของ'),
      'แก้ไขล่าสุด',current_date::text
    ),
    source_version='20261025-canonical-fruit',updated_at=now()
  from boy_central.master_catalog_sheets s
  where r.sheet_id=s.id and s.company_id=target_company and s.sheet_name='M_สินค้า'
    and r.row_data->>'item_id' in ('ITEM-0256','ITEM-0257','ITEM-0258','ITEM-0260','ITEM-0261','ITEM-0263');

  -- These four rows did not have a raw counterpart.  Convert the existing ID into
  -- the canonical fruit instead of creating another ID and breaking references.
  update boy_central.master_catalog_rows r
  set row_data=r.row_data || jsonb_build_object(
      'ชื่อสินค้า',case r.row_data->>'item_id'
        when 'ITEM-0259' then 'มะพร้าว'
        when 'ITEM-0264' then 'มะละกอ'
        when 'ITEM-0265' then 'เมลอน'
        when 'ITEM-0266' then 'แคนตาลูป' end,
      'ชื่อเดิม',r.row_data->>'ชื่อสินค้า',
      'ประเภทข้อมูล','STOCK_ITEM','เปิดใช้งาน',true,'ซื้อได้',true,'เบิกได้',true,
      'หมายเหตุ',concat_ws(' · ',nullif(r.row_data->>'หมายเหตุ',''),'ผลไม้หลัก; รูปแบบกล่อง/ปอกแล้วกำหนดในหน้า BigC'),
      'แก้ไขล่าสุด',current_date::text
    ),
    source_version='20261025-canonical-fruit',updated_at=now()
  from boy_central.master_catalog_sheets s
  where r.sheet_id=s.id and s.company_id=target_company and s.sheet_name='M_สินค้า'
    and r.row_data->>'item_id' in ('ITEM-0259','ITEM-0264','ITEM-0265','ITEM-0266');

  update boy_central.master_catalog_sheets
  set source_revision='20261025-canonical-fruit',updated_at=now()
  where company_id=target_company and sheet_name='M_สินค้า';

  -- Build the normalized UUID-backed records used by workflow costing.
  insert into boy_central.items(
    company_id,code,name,category_id,base_unit_id,track_stock,purchaseable,issueable,
    sellable,active,legacy_name,item_type,notes
  )
  select target_company,m.code,m.name,fruit_category,u.id,false,true,true,false,true,
    m.legacy_name,'STOCK_ITEM','ผลไม้หลักสำหรับซื้อ เบิก และคำนวณต้นทุน BigC'
  from (values
    ('ITEM-0002','เสาวรส','เสาวรส'),('ITEM-0006','ส้ม','ส้ม'),
    ('ITEM-0011','แตงโม','แตงโม'),('ITEM-0012','สับปะรด','สับปะรด'),
    ('ITEM-0016','มะนาว','มะนาว'),('ITEM-0020','อโวคาโด','อโวคาโด'),
    ('ITEM-0026','มะม่วง','มะม่วง'),('ITEM-0028','ส้มเช้ง','ส้มเช้ง'),
    ('ITEM-0259','มะพร้าว','มะพร้าว (กล่อง)'),('ITEM-0264','มะละกอ','มะละกอ (กล่อง)'),
    ('ITEM-0265','เมลอน','เมลอน (กล่อง)'),('ITEM-0266','แคนตาลูป','แคนตาลูป (กล่อง)')
  ) as m(code,name,legacy_name)
  join boy_central.master_catalog_sheets s on s.company_id=target_company and s.sheet_name='M_สินค้า'
  join boy_central.master_catalog_rows r on r.sheet_id=s.id and r.row_data->>'item_id'=m.code
  join boy_central.units u on u.company_id=target_company and u.code=r.row_data->>'base_unit_id' and u.active
  on conflict(company_id,code) do update set
    name=excluded.name,category_id=excluded.category_id,base_unit_id=excluded.base_unit_id,
    purchaseable=true,issueable=true,active=true,legacy_name=excluded.legacy_name,
    item_type='STOCK_ITEM',notes=excluded.notes,updated_at=now();

  insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
  select i.company_id,i.id,i.base_unit_id,1,true,true,true,true
  from boy_central.items i
  where i.company_id=target_company and i.code in (
    'ITEM-0002','ITEM-0006','ITEM-0011','ITEM-0012','ITEM-0016','ITEM-0020',
    'ITEM-0026','ITEM-0028','ITEM-0259','ITEM-0264','ITEM-0265','ITEM-0266')
  on conflict(item_id,unit_id) do update set is_base_unit=true,allow_purchase=true,allow_issue=true,active=true,updated_at=now();

  insert into boy_central.branch_items(company_id,branch_id,item_id,active)
  select target_company,b.id,i.id,true
  from (values(bigc_branch),(tawana_branch)) b(id)
  cross join boy_central.items i
  where i.company_id=target_company and i.code in (
    'ITEM-0002','ITEM-0006','ITEM-0011','ITEM-0012','ITEM-0016','ITEM-0020',
    'ITEM-0026','ITEM-0028','ITEM-0259','ITEM-0264','ITEM-0265','ITEM-0266')
  on conflict(branch_id,item_id) do update set active=true,updated_at=now();

  for row_item in
    select i.* from boy_central.items i where i.company_id=target_company and i.code in (
      'ITEM-0002','ITEM-0006','ITEM-0011','ITEM-0012','ITEM-0016','ITEM-0020',
      'ITEM-0026','ITEM-0028','ITEM-0259','ITEM-0264','ITEM-0265','ITEM-0266')
  loop
    insert into boy_central.expense_items(
      company_id,code,name,category_id,item_id,affects_stock,active,requires_quantity,
      requires_unit,requires_supplier,requires_receipt,notes,purchase_unit_id,stock_conversion_to_base
    ) values(
      target_company,'EXP-FRUIT-'||right(row_item.code,4),row_item.name,fruit_category,row_item.id,
      false,true,true,true,false,false,'ซื้อผลไม้หลัก; ใช้คำนวณราคาเฉลี่ยรายเดือน',row_item.base_unit_id,1
    ) on conflict(company_id,code) do update set
      name=excluded.name,category_id=excluded.category_id,item_id=excluded.item_id,
      active=true,requires_quantity=true,requires_unit=true,purchase_unit_id=excluded.purchase_unit_id,
      stock_conversion_to_base=1,notes=excluded.notes,updated_at=now();
  end loop;

  insert into boy_central.branch_expense_items(branch_id,expense_item_id,active)
  select tawana_branch,e.id,true from boy_central.expense_items e
  where e.company_id=target_company and e.code like 'EXP-FRUIT-%'
  on conflict(branch_id,expense_item_id) do update set active=true,updated_at=now();

  -- Update every BigC display form to point to the same canonical UUID and code.
  update boy_central.bigc_workflow_settings settings
  set menu_config=(
    select coalesce(jsonb_agg(
      case
        when mapped.master_code is null then entry
        else entry || jsonb_build_object(
          'masterItemId',mapped.master_code,'itemId',i.id,
          'handlingType',mapped.handling_type,'costingBasis',mapped.costing_basis,
          'inputMode',mapped.input_mode
        )
      end order by ordinality
    ),'[]'::jsonb)
    from jsonb_array_elements(settings.menu_config) with ordinality as menu(entry,ordinality)
    left join lateral (
      select * from (values
        ('อโวคาโด','ITEM-0020'),('แตงโม','ITEM-0011'),('สับปะรด','ITEM-0012'),
        ('มะม่วง','ITEM-0026'),('เสาวรส','ITEM-0002'),('มะพร้าว','ITEM-0259'),
        ('น้ำมะพร้าว','ITEM-0259'),('มะนาว','ITEM-0016'),('น้ำมะนาว','ITEM-0016'),
        ('มะละกอ','ITEM-0264'),('เมลอน','ITEM-0265'),('เมล่อน','ITEM-0265'),
        ('แคนตาลูป','ITEM-0266'),('ส้มเช้ง','ITEM-0028'),('ส้ม','ITEM-0006')
      ) x(label,master_code)
      where regexp_replace(coalesce(entry->>'name',entry->>'displayName'),E'\\s*\\([^)]*\\)\\s*$','')=x.label
      order by length(x.label) desc limit 1
    ) name_map on true
    left join lateral (
      select name_map.master_code,
        case
          when coalesce(entry->>'displayName','')='น้ำส้ม (ขวด)' then 'consignment'
          when coalesce(entry->>'name','') like 'น้ำ%' then 'juiced'
          when coalesce(entry->>'unit','') in ('กล่อง','ถุง') then 'prepared'
          else 'whole_fruit'
        end as handling_type,
        case
          when coalesce(entry->>'displayName','')='น้ำส้ม (ขวด)' then 'consignment'
          when coalesce(entry->>'name','') like 'น้ำ%' or coalesce(entry->>'unit','') in ('กล่อง','ถุง') then 'backend_yield_from_actual_weight'
          when coalesce(entry->>'unit','')='ลูก' and coalesce(entry->>'name','') in ('แตงโม','สับปะรด') then 'estimated_raw_piece'
          else 'actual_raw_weight_kg'
        end as costing_basis,
        case when coalesce(entry->>'unit','') in ('กล่อง','ถุง','ขวด','กิโลกรัม') then 'weight' else 'quantity' end as input_mode
      where name_map.master_code is not null
    ) mapped on true
    left join boy_central.items i on i.company_id=settings.company_id and i.code=mapped.master_code
  ),version=version+1,updated_at=now()
  where settings.branch_id=bigc_branch;

  -- Create the costing rule identity now; yield may be filled later in the admin UI.
  insert into boy_central.bigc_interbranch_cost_rules(
    company_id,receiving_branch_id,received_item_id,raw_item_id,effective_month,active,counted_by_piece,note
  )
  select target_company,bigc_branch,i.id,i.id,date_trunc('month',current_date)::date,true,
    i.code in ('ITEM-0011','ITEM-0012'),'ผลไม้หลักตัวเดียว; รูปแบบรับของอยู่ใน BigC'
  from boy_central.items i
  where i.company_id=target_company and i.code in (
    'ITEM-0002','ITEM-0006','ITEM-0011','ITEM-0012','ITEM-0016','ITEM-0020',
    'ITEM-0026','ITEM-0028','ITEM-0259','ITEM-0264','ITEM-0265','ITEM-0266')
  on conflict(receiving_branch_id,received_item_id,effective_month) do update set
    raw_item_id=excluded.raw_item_id,active=true,counted_by_piece=excluded.counted_by_piece,
    note=excluded.note,updated_at=now();
end
$migration$;

create or replace function boy_central.get_bigc_fruit_cost_settings()
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare actor_company uuid; bigc_branch uuid; result jsonb;
begin
  select p.company_id into actor_company from boy_central.profiles p
  where p.user_id=auth.uid() and p.active and p.company_role='admin';
  if actor_company is null then raise exception 'admin access required'; end if;
  select b.id into bigc_branch from boy_central.branches b
  where b.company_id=actor_company and b.code='BIGC-CENTRAL-PATTAYA' and b.active;
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object(
      'id',i.id,'name',i.name,'code',i.code,'base_unit',u.name,'base_unit_code',u.code
    ) order by i.name) from boy_central.items i
      join boy_central.categories c on c.id=i.category_id and c.code='SUB-0001'
      join boy_central.units u on u.id=i.base_unit_id
      where i.company_id=actor_company and i.active),'[]'::jsonb),
    'rules',coalesce((select jsonb_agg(jsonb_build_object(
      'received_item_id',r.received_item_id,'raw_item_id',r.raw_item_id,
      'effective_month',r.effective_month,'counted_by_piece',r.counted_by_piece,
      'yield_ratio',y.yield_ratio,'yield_source_note',y.source_note,'note',r.note
    ) order by r.effective_month desc) from boy_central.bigc_interbranch_cost_rules r
      left join boy_central.bigc_interbranch_yields y
        on y.cost_rule_id=r.id and y.effective_month=r.effective_month
      where r.company_id=actor_company and r.receiving_branch_id=bigc_branch),'[]'::jsonb),
    'weights',coalesce((select jsonb_agg(jsonb_build_object(
      'raw_item_id',w.raw_item_id,'effective_month',w.effective_month,
      'kg_per_piece',w.kg_per_piece,'sample_note',w.sample_note
    ) order by w.effective_month desc) from boy_central.bigc_raw_fruit_piece_weights w
      where w.company_id=actor_company),'[]'::jsonb)
  ) into result;
  return result;
end
$function$;

revoke all on function boy_central.get_bigc_fruit_cost_settings() from public,anon;
grant execute on function boy_central.get_bigc_fruit_cost_settings() to authenticated;
