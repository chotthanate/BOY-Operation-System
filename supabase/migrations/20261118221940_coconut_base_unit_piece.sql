-- User-approved correction. No historical quantities or BigC receipts are rewritten.
do $fix$
declare item boy_central.items; m boy_central.master_catalog_rows; u boy_central.master_catalog_rows; piece uuid;
begin
 select * into item from boy_central.items where code='ITEM-0259' for update;
 if item.id is null then raise exception 'Coconut identity missing'; end if;
 if exists(select 1 from boy_central.transaction_lines where item_id=item.id)
 or exists(select 1 from boy_central.stock_movements where item_id=item.id)
 or exists(select 1 from boy_central.recipes where item_id=item.id)
 or exists(select 1 from boy_central.pos_modifier_recipes where item_id=item.id)
 or item.stock_target_item_id is not null
 or exists(select 1 from boy_central.items where stock_target_item_id=item.id)
 then raise exception 'Coconut has history or stock mappings; manual unit conversion required'; end if;
 select id into piece from boy_central.units where company_id=item.company_id and code='UNIT-013' and name='ลูก' and active;
 select r.* into m from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id where s.company_id=item.company_id and s.sheet_name='M_สินค้า' and r.record_key='ITEM-0259' for update of r;
 select r.* into u from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id where s.company_id=item.company_id and s.sheet_name='M_หน่วยสินค้า' and r.record_key='IU-00052' for update of r;
 if piece is null or m.row_data->>'base_unit_id'<>'UNIT-011' or u.row_data->>'unit_id'<>'UNIT-011' or u.row_data->>'item_id'<>'ITEM-0259' then raise exception 'Coconut unit configuration changed; review required'; end if;
 perform set_config('request.jwt.claim.sub',(select user_id::text from boy_central.profiles where company_id=item.company_id and active and company_role='admin' limit 1),true);
 perform boy_central.bulk_upsert_master_catalog_rows('M_สินค้า',jsonb_build_array(jsonb_build_object('item_id',m.record_key,'__version',m.source_version,'base_unit_id','UNIT-013')),'แก้หน่วยมะพร้าวเป็นลูกตามเจ้าของยืนยัน');
 perform boy_central.bulk_upsert_master_catalog_rows('M_หน่วยสินค้า',jsonb_build_array(jsonb_build_object('item_unit_id',u.record_key,'__version',u.source_version,'unit_id','UNIT-013','อัตราแปลงเป็นหน่วยฐาน',1,'เป็นหน่วยฐาน',true,'ใช้หน่วยนี้ตอนซื้อ',true,'ใช้หน่วยนี้ตอนเบิก',true,'หน่วยเดิม','ลูก')),'แก้หน่วยมะพร้าวเป็นลูกตามเจ้าของยืนยัน');
 -- There is no known kg/piece ratio. Disable the obsolete kg conversion instead of inventing one.
 update boy_central.item_units set active=false,is_base_unit=false,allow_purchase=false,allow_issue=false where item_id=item.id and unit_id<>piece;
 if not exists(select 1 from boy_central.items where id=item.id and base_unit_id=piece)
 or not exists(select 1 from boy_central.item_units where item_id=item.id and unit_id=piece and conversion_to_base=1 and active and is_base_unit)
 then raise exception 'Coconut unit verification failed'; end if;
end;
$fix$;
