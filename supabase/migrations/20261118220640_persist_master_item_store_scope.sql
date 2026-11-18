-- Scope is explicit metadata on the canonical row. Existing rows are not reassigned.
update boy_central.master_catalog_sheets
set headers=headers||'["store_types"]'::jsonb
where sheet_name in ('M_สินค้า','M_รายการค่าใช้จ่าย') and not headers ? 'store_types';

create or replace function boy_central_private.master_store_scope_after_write()
returns trigger language plpgsql security definer set search_path='' as $$
declare
 sheet text; scope jsonb; runtime uuid; branch record; kind text; enabled boolean;
 links boy_central.master_catalog_sheets; link boy_central.master_catalog_rows;
 payload jsonb; patches jsonb:='[]'::jsonb;
begin
 select sheet_name into sheet from boy_central.master_catalog_sheets where id=new.sheet_id;
 if sheet not in ('M_สินค้า','M_รายการค่าใช้จ่าย') or not new.row_data ? 'store_types' then return new; end if;
 if tg_op='UPDATE' and old.row_data->'store_types' is not distinct from new.row_data->'store_types' then return new; end if;
 if auth.uid() is null or not boy_central_private.is_company_admin(new.company_id) then raise exception 'ไม่มีสิทธิ์กำหนดร้านของรายการ'; end if;
 scope:=new.row_data->'store_types';
 if jsonb_typeof(scope) is distinct from 'array' then raise exception 'รูปแบบการเลือกร้านไม่ถูกต้อง'; end if;
 if exists(select 1 from jsonb_array_elements(scope) v where jsonb_typeof(v)<>'string' or v#>>'{}' not in ('water','grill','burger')) then raise exception 'ประเภทร้านไม่ถูกต้อง'; end if;
 if sheet='M_สินค้า' then
  select id into runtime from boy_central.items where company_id=new.company_id and code=new.record_key;
 else
  select id into runtime from boy_central.expense_items where company_id=new.company_id and code=new.record_key;
 end if;
 if runtime is null then raise exception 'รายการนี้ยังไม่เชื่อมกับข้อมูลใช้งาน กรุณาตรวจรหัสรายการก่อนกำหนดร้าน'; end if;
 select * into links from boy_central.master_catalog_sheets where company_id=new.company_id and sheet_name='M_สินค้าสาขา' and active for update;
 for branch in
  select b.id,b.code,m.row_data->>'branch_id' as master_id,
   lower(coalesce(m.row_data->>'รหัสสาขา','')||' '||coalesce(m.row_data->>'ชื่อสาขา','')) as label
  from boy_central.branches b
  join boy_central.master_catalog_sheets s on s.company_id=b.company_id and s.sheet_name='M_สาขา'
  join boy_central.master_catalog_rows m on m.sheet_id=s.id and m.row_data->>'รหัสสาขา'=b.code
  where b.company_id=new.company_id
 loop
  kind:=case when branch.label ~ 'burger|เบอร์เกอร์' then 'burger' when branch.label ~ 'grill|เนื้อย่าง' then 'grill' else 'water' end;
  enabled:=jsonb_array_length(scope)=0 or scope ? kind;
  if sheet='M_สินค้า' then
   insert into boy_central.branch_items(company_id,branch_id,item_id,active)
   values(new.company_id,branch.id,runtime,enabled)
   on conflict(branch_id,item_id) do update set active=excluded.active
   where branch_items.active is distinct from excluded.active;
   if links.id is null then raise exception 'ไม่พบตารางสินค้าประจำสาขา'; end if;
   link.id:=null;
   select * into link from boy_central.master_catalog_rows
   where sheet_id=links.id and row_data->>'item_id'=new.record_key and row_data->>'branch_id'=branch.master_id
   order by row_number limit 1;
   if link.id is null then
    payload:=jsonb_build_object('branch_item_id','BI-'||gen_random_uuid()::text,'branch_id',branch.master_id,'item_id',new.record_key,'เปิดใช้งาน',enabled);
   elsif (link.row_data->>'เปิดใช้งาน')::boolean is distinct from enabled then
    payload:=jsonb_build_object('branch_item_id',link.record_key,'เปิดใช้งาน',enabled,'__version',link.source_version);
   else continue;
   end if;
   patches:=patches||jsonb_build_array(payload);
  else
   insert into boy_central.branch_expense_items(branch_id,expense_item_id,active)
   values(branch.id,runtime,enabled)
   on conflict(branch_id,expense_item_id) do update set active=excluded.active
   where branch_expense_items.active is distinct from excluded.active;
  end if;
 end loop;
 if jsonb_array_length(patches)>0 then
  perform boy_central.bulk_upsert_master_catalog_rows('M_สินค้าสาขา',patches,'กำหนดร้านจากรายการสินค้า');
 end if;
 return new;
end;
$$;
revoke all on function boy_central_private.master_store_scope_after_write() from public,anon,authenticated;
drop trigger if exists zz_master_store_scope_after_write on boy_central.master_catalog_rows;
create trigger zz_master_store_scope_after_write after insert or update of row_data on boy_central.master_catalog_rows
for each row execute function boy_central_private.master_store_scope_after_write();
