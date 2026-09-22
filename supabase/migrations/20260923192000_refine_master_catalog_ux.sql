-- Extend the Supabase-first BOY master catalog with fields required by the
-- purpose-built branch, employee, supplier, and purchase-source editors.
update boy_central.master_catalog_sheets
set headers = headers || '["รูปแบบค่าแรง","ค่าแรงต่อเดือน"]'::jsonb,
    updated_at = now()
where sheet_name = 'M_พนักงาน'
  and not (headers ? 'รูปแบบค่าแรง');

update boy_central.master_catalog_sheets
set headers = headers || '["ที่อยู่","ชื่อผู้ติดต่อ","เบอร์โทรติดต่อ","อีเมล","ผู้จัดการสาขา","ผู้ประสานงาน","เบอร์ผู้ประสานงาน"]'::jsonb,
    updated_at = now()
where sheet_name = 'M_สาขา'
  and not (headers ? 'ชื่อผู้ติดต่อ');

update boy_central.master_catalog_sheets
set headers = headers || '["จัดหาวัตถุดิบ","จัดหาบรรจุภัณฑ์","จัดหาอุปกรณ์","จัดหาของใช้สิ้นเปลือง","ให้บริการ","ประเภทอื่นๆ"]'::jsonb,
    updated_at = now()
where sheet_name = 'M_ผู้ขาย'
  and not (headers ? 'จัดหาวัตถุดิบ');

update boy_central.master_catalog_sheets
set headers = headers || '["รหัสสินค้าของซัพพลายเออร์","ยี่ห้อ","ขนาดบรรจุ","หน่วยขนาดบรรจุ"]'::jsonb,
    updated_at = now()
where sheet_name = 'M_ผู้ขายสินค้า'
  and not (headers ? 'ยี่ห้อ');

update boy_central.master_catalog_rows r
set row_data = r.row_data || jsonb_build_object(
      'รูปแบบค่าแรง', coalesce(nullif(r.row_data->>'รูปแบบค่าแรง',''), 'รายวัน'),
      'ค่าแรงต่อเดือน', coalesce(r.row_data->'ค่าแรงต่อเดือน', '""'::jsonb)
    ),
    updated_at = now()
from boy_central.master_catalog_sheets s
where r.sheet_id = s.id and s.sheet_name = 'M_พนักงาน';

update boy_central.master_catalog_rows r
set row_data = (r.row_data || jsonb_build_object(
      'จัดหาวัตถุดิบ', (coalesce(r.row_data->>'หมายเหตุ','') ~ '(อาหาร|วัตถุดิบ)'),
      'จัดหาบรรจุภัณฑ์', (coalesce(r.row_data->>'หมายเหตุ','') like '%บรรจุภัณฑ์%'),
      'จัดหาอุปกรณ์', (coalesce(r.row_data->>'หมายเหตุ','') like '%อุปกรณ์%'),
      'จัดหาของใช้สิ้นเปลือง', (coalesce(r.row_data->>'หมายเหตุ','') like '%ของใช้สิ้นเปลือง%'),
      'ให้บริการ', (coalesce(r.row_data->>'หมายเหตุ','') like '%บริการ%'),
      'ประเภทอื่นๆ', false
    )) || case when coalesce(r.row_data->>'หมายเหตุ','') like 'หลายประเภท:%'
          then jsonb_build_object('หมายเหตุ','') else '{}'::jsonb end,
    updated_at = now()
from boy_central.master_catalog_sheets s
where r.sheet_id = s.id and s.sheet_name = 'M_ผู้ขาย';
