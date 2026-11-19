-- Owner-requested semantic 1:1 unit change for this SKU only: piece -> skewer.
-- Keep historical records and all numeric quantities; retain the old unit at
-- conversion 1 so documents/formulas using its UUID are still interpretable.
do $migration$
declare
  product boy_central.items%rowtype;
  master boy_central.master_catalog_rows%rowtype;
  old_unit boy_central.units%rowtype;
  new_unit boy_central.units%rowtype;
  unit_row record;
  before_movements jsonb;
  after_movements jsonb;
  before_transactions jsonb;
  before_recipes jsonb;
  actor uuid;
begin
  select * into strict product from boy_central.items where code='ITEM-0324' and name='หมูนมสด' for update;
  select * into strict old_unit from boy_central.units where company_id=product.company_id and code='UNIT-015' and name='ชิ้น';
  select * into strict new_unit from boy_central.units where company_id=product.company_id and name='ไม้' and active;
  if product.base_unit_id=new_unit.id then return;end if;
  if product.base_unit_id<>old_unit.id then raise exception 'Pork milk base unit changed; review before conversion';end if;
  if product.stock_target_item_id is not null or exists(select 1 from boy_central.items where stock_target_item_id=product.id) then
    raise exception 'Stock group requires a coordinated unit conversion';
  end if;
  select * into strict master from boy_central.master_catalog_rows r
  where r.company_id=product.company_id and r.record_key=product.code
    and r.sheet_id=(select id from boy_central.master_catalog_sheets where company_id=product.company_id and sheet_name='M_สินค้า') for update;
  if master.row_data->>'base_unit_id'<>old_unit.code then raise exception 'Catalog base unit changed; review';end if;
  if exists(select 1 from boy_central.item_units where item_id=product.id and unit_id in(old_unit.id,new_unit.id) and conversion_to_base<>1) then
    raise exception 'Existing unit rate is not 1:1';
  end if;
  select jsonb_agg(to_jsonb(m) order by m.id) into before_movements from boy_central.stock_movements m where item_id=product.id;
  select jsonb_agg(to_jsonb(t) order by t.id) into before_transactions from boy_central.transaction_lines t where item_id=product.id;
  select jsonb_agg(to_jsonb(r) order by r.id) into before_recipes from boy_central.recipes r where item_id=product.id;
  select user_id into actor from boy_central.profiles where company_id=product.company_id and active and company_role='admin' limit 1;
  if actor is null then raise exception 'No company administrator';end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);

  update boy_central.item_units set is_base_unit=false where item_id=product.id and is_base_unit;
  insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
  values(product.company_id,product.id,new_unit.id,1,true,true,true,true)
  on conflict(item_id,unit_id) do update set conversion_to_base=1,is_base_unit=true,allow_purchase=true,allow_issue=true,active=true;
  update boy_central.items set base_unit_id=new_unit.id,updated_at=now() where id=product.id;
  perform boy_central.bulk_upsert_master_catalog_rows('M_สินค้า',jsonb_build_array(jsonb_build_object(
    'item_id',product.code,'__version',master.source_version,'base_unit_id',new_unit.code
  )),'เปลี่ยนหมูนมสด ชิ้นเป็นไม้ 1:1 ตามเจ้าของยืนยัน; คงประวัติและยอดเดิม');

  for unit_row in select r.record_key,r.source_version from boy_central.master_catalog_rows r
    join boy_central.master_catalog_sheets s on s.id=r.sheet_id
    where r.company_id=product.company_id and s.sheet_name='M_หน่วยสินค้า'
      and r.row_data->>'item_id'=product.code and r.row_data->>'unit_id'=old_unit.code
  loop
    perform boy_central.bulk_upsert_master_catalog_rows('M_หน่วยสินค้า',jsonb_build_array(jsonb_build_object(
      'item_unit_id',unit_row.record_key,'__version',unit_row.source_version,'เป็นหน่วยฐาน',false
    )),'คงหน่วยชิ้นเดิม อัตรา 1:1 สำหรับประวัติหมูนมสด');
  end loop;
  if not exists(select 1 from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id
    where r.company_id=product.company_id and s.sheet_name='M_หน่วยสินค้า' and r.row_data->>'item_id'=product.code and r.row_data->>'unit_id'=new_unit.code) then
    perform boy_central.bulk_upsert_master_catalog_rows('M_หน่วยสินค้า',jsonb_build_array(jsonb_build_object(
      'item_id',product.code,'unit_id',new_unit.code,'อัตราแปลงเป็นหน่วยฐาน',1,'เป็นหน่วยฐาน',true,
      'ใช้หน่วยนี้ตอนซื้อ',true,'ใช้หน่วยนี้ตอนเบิก',true,'เปิดใช้งาน',true
    )),'หน่วยฐานไม้ของหมูนมสด 1:1');
  end if;
  select jsonb_agg(to_jsonb(m) order by m.id) into after_movements from boy_central.stock_movements m where item_id=product.id;
  if after_movements is distinct from before_movements then raise exception 'Stock history changed';end if;
  if (select jsonb_agg(to_jsonb(t) order by t.id) from boy_central.transaction_lines t where item_id=product.id) is distinct from before_transactions then raise exception 'Transaction history changed';end if;
  if (select jsonb_agg(to_jsonb(r) order by r.id) from boy_central.recipes r where item_id=product.id) is distinct from before_recipes then raise exception 'Recipe history changed';end if;
end $migration$;
