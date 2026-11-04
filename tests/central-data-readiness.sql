-- Read-only pre-cutover checks. Grain: one enabled M_สินค้า business code per
-- company; runtime joins must be by company + code, never by display name.
with rows_ as(
 select r.record_key,r.row_data,i.id runtime_id,u.id unit_uuid
 from boy_central.master_catalog_rows r
 join boy_central.master_catalog_sheets s on s.id=r.sheet_id
 left join boy_central.items i on i.company_id=r.company_id and i.code=r.record_key
 left join boy_central.units u on u.company_id=r.company_id and u.code=r.row_data->>'base_unit_id'
 where r.active and s.sheet_name='M_สินค้า'
 and lower(coalesce(r.row_data->>'เปิดใช้งาน','true')) not in ('false','0','no','ไม่')
)
select count(*) enabled_items,
 count(*) filter(where runtime_id is null) missing_runtime_uuid,
 count(*) filter(where runtime_id is null and unit_uuid is null) missing_runtime_and_unit,
 count(*) filter(where runtime_id is null and unit_uuid is not null) can_map_by_code
from rows_;

select r.record_key,r.row_data->>'ชื่อสินค้า' item_name,r.row_data->>'base_unit_id' master_base_unit_code
from boy_central.master_catalog_rows r
join boy_central.master_catalog_sheets s on s.id=r.sheet_id
left join boy_central.items i on i.company_id=r.company_id and i.code=r.record_key
left join boy_central.units u on u.company_id=r.company_id and u.code=r.row_data->>'base_unit_id'
where r.active and s.sheet_name='M_สินค้า' and i.id is null and u.id is null
and lower(coalesce(r.row_data->>'เปิดใช้งาน','true')) not in ('false','0','no','ไม่')
order by r.record_key;
