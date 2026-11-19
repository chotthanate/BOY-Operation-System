-- Explicit admin-only 1:1 count-unit relabel. No historical numeric values are
-- rescaled. Other conversions and stock pools still require a migration plan.
create function boy_central_private.change_master_base_unit_one_to_one(payload jsonb,actor_name text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
 s boy_central.master_catalog_sheets%rowtype;m boy_central.master_catalog_rows%rowtype;
 p boy_central.items%rowtype;old_unit boy_central.units%rowtype;new_unit boy_central.units%rowtype;
 link boy_central.master_runtime_links%rowtype;urow record;patches jsonb:='[]';result jsonb;
begin
 if (select auth.uid()) is null then raise exception 'กรุณาเข้าสู่ระบบออนไลน์';end if;
 select * into s from boy_central.master_catalog_sheets
 where sheet_name='M_สินค้า' and active and boy_central_private.is_company_admin(company_id) for update;
 if s.id is null then raise exception 'เฉพาะแอดมินเท่านั้นที่เปลี่ยนหน่วยฐานได้';end if;
 select * into m from boy_central.master_catalog_rows where sheet_id=s.id and record_key=payload->>'item_id' for update;
 if m.id is null then raise exception 'ไม่พบรายการสินค้า';end if;
 if nullif(payload->>'__version','') is null or payload->>'__version' is distinct from m.source_version then
   raise exception 'ข้อมูลสินค้ามีการแก้ไขแล้ว กรุณาเปิดรายการใหม่ก่อนเปลี่ยนหน่วย';end if;
 select * into link from boy_central.master_runtime_links where master_row_id=m.id;
 if link.status is distinct from 'ready' or link.item_id is null then raise exception 'รายการนี้ต้องตรวจการเชื่อมข้อมูลกลางก่อนเปลี่ยนหน่วย';end if;
 select * into strict p from boy_central.items where id=link.item_id and company_id=s.company_id for update;
 select * into strict old_unit from boy_central.units where id=p.base_unit_id;
 select * into new_unit from boy_central.units where company_id=s.company_id and code=payload->>'base_unit_id' and active;
 if new_unit.id is null then raise exception 'ไม่พบหน่วยฐานใหม่';end if;
 if new_unit.id=old_unit.id then return boy_central.bulk_upsert_master_catalog_rows('M_สินค้า',jsonb_build_array(payload),actor_name);end if;
 if m.row_data->>'base_unit_id' is distinct from old_unit.code then raise exception 'หน่วยข้อมูลกลางและหน่วยใช้งานไม่ตรงกัน กรุณาตรวจสอบก่อนเปลี่ยน';end if;
 if old_unit.unit_type<>'count' or new_unit.unit_type<>'count' then
   raise exception 'การเปลี่ยนหน่วยนี้ต้องแปลงจำนวน ไม่ใช่แบบ 1 ต่อ 1 กรุณาใช้หน่วยซื้อและอัตราแปลงแทน';end if;
 if p.stock_target_item_id is not null or nullif(payload->>'stock_target_item_id','') is not null
   or exists(select 1 from boy_central.items where stock_target_item_id=p.id) then
   raise exception 'รายการนี้อยู่ในสต็อกรวม ต้องเปลี่ยนหน่วยทั้งกลุ่มพร้อมกัน';end if;
 if exists(select 1 from boy_central.item_units where item_id=p.id and unit_id in(old_unit.id,new_unit.id) and conversion_to_base<>1) then
   raise exception 'หน่วยที่เลือกมีอัตราแปลงเดิมไม่เท่ากับ 1 กรุณาใช้หน่วยซื้อแทน';end if;
 update boy_central.item_units set is_base_unit=false where item_id=p.id and is_base_unit;
 insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
 values(p.company_id,p.id,new_unit.id,1,true,true,true,true)
 on conflict(item_id,unit_id) do update set conversion_to_base=1,is_base_unit=true,allow_purchase=true,allow_issue=true,active=true;
 update boy_central.items set base_unit_id=new_unit.id,updated_at=now() where id=p.id;
 result:=boy_central.bulk_upsert_master_catalog_rows('M_สินค้า',jsonb_build_array(payload),
   coalesce(actor_name,'แอดมิน')||' · เปลี่ยนหน่วยฐาน 1 '||old_unit.name||' = 1 '||new_unit.name||' (คงยอดและประวัติเดิม)');
 for urow in select r.* from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets us on us.id=r.sheet_id
   where r.company_id=p.company_id and us.sheet_name='M_หน่วยสินค้า' and r.row_data->>'item_id'=p.code
 loop
   if urow.row_data->>'unit_id'=old_unit.code then
     patches:=patches||jsonb_build_array(jsonb_build_object('item_unit_id',urow.record_key,'__version',urow.source_version,'เป็นหน่วยฐาน',false));
   elsif urow.row_data->>'unit_id'=new_unit.code then
     patches:=patches||jsonb_build_array(jsonb_build_object('item_unit_id',urow.record_key,'__version',urow.source_version,'เป็นหน่วยฐาน',true,'อัตราแปลงเป็นหน่วยฐาน',1,'เปิดใช้งาน',true));
   end if;
 end loop;
 if not exists(select 1 from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets us on us.id=r.sheet_id
   where r.company_id=p.company_id and us.sheet_name='M_หน่วยสินค้า' and r.row_data->>'item_id'=p.code and r.row_data->>'unit_id'=new_unit.code) then
   patches:=patches||jsonb_build_array(jsonb_build_object('item_id',p.code,'unit_id',new_unit.code,'เป็นหน่วยฐาน',true,
    'อัตราแปลงเป็นหน่วยฐาน',1,'ใช้หน่วยนี้ตอนซื้อ',true,'ใช้หน่วยนี้ตอนเบิก',true,'เปิดใช้งาน',true));
 end if;
 if jsonb_array_length(patches)>0 then perform boy_central.bulk_upsert_master_catalog_rows('M_หน่วยสินค้า',patches,actor_name);end if;
 return result||jsonb_build_object('unitCatalog',boy_central.get_master_catalog('M_หน่วยสินค้า'));
end $$;
revoke all on function boy_central_private.change_master_base_unit_one_to_one(jsonb,text) from public,anon;
grant execute on function boy_central_private.change_master_base_unit_one_to_one(jsonb,text) to authenticated;
create function boy_central.change_master_base_unit_one_to_one(payload jsonb,actor_name text default null)
returns jsonb language sql security invoker set search_path='' as $$
 select boy_central_private.change_master_base_unit_one_to_one(payload,actor_name);
$$;
revoke all on function boy_central.change_master_base_unit_one_to_one(jsonb,text) from public,anon;
grant execute on function boy_central.change_master_base_unit_one_to_one(jsonb,text) to authenticated;
