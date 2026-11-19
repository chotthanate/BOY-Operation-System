-- Keep the existing authorization, validation, optimistic locking and mirror
-- path. Allocate only missing IDs, under the sheet lock already held by bulk
-- upsert. Existing IDs and unknown/non-master identity fields remain untouched.
do $migration$
declare definition text; old_block text; new_block text;
begin
  definition:=pg_get_functiondef('boy_central.bulk_upsert_master_catalog_rows(text,jsonb,text)'::regprocedure);
  old_block:=$old$    if target_key is null then
      raise exception 'ทุกรายการต้องมี %', target_sheet.id_header;
    end if;$old$;
  new_block:=$new$    if target_key is null then
      declare
        prefix text;
        sequence_number bigint;
      begin
        if nullif(entry->>'__version','') is not null then
          raise exception 'รายการแก้ไขต้องมี %', target_sheet.id_header;
        end if;
        prefix:=case target_sheet.sheet_name
          when 'M_หน่วย' then 'UNIT'
          when 'M_ผู้ขาย' then 'SUP'
          when 'M_พนักงาน' then 'EMP'
          when 'M_สินค้า' then 'ITEM'
          when 'M_รายการค่าใช้จ่าย' then 'EXP'
          when 'M_สาขา' then 'BR'
          when 'M_หมวดหมู่' then 'SUB'
          when 'M_หน่วยสินค้า' then 'IU'
          when 'M_ผู้ขายสินค้า' then 'IS'
          when 'M_สินค้าสาขา' then 'BI'
          else null end;
        if prefix is null then
          raise exception 'ทุกรายการต้องมี %', target_sheet.id_header;
        end if;
        select coalesce(max(substring(r.record_key from '[0-9]+$')::bigint),0)+1
        into sequence_number
        from boy_central.master_catalog_rows r
        where r.sheet_id=target_sheet.id and r.record_key~('^'||prefix||'-[0-9]+$');
        loop
          target_key:=prefix||'-'||lpad(sequence_number::text,greatest(4,length(sequence_number::text)),'0');
          exit when not exists(select 1 from jsonb_array_elements(rows) incoming where btrim(incoming->>target_sheet.id_header)=target_key)
            and not exists(select 1 from boy_central.master_catalog_rows r where r.sheet_id=target_sheet.id and r.record_key=target_key);
          sequence_number:=sequence_number+1;
        end loop;
      end;
    end if;$new$;
  if strpos(definition,old_block)=0 then
    raise exception 'Master upsert changed; review before applying automatic ID allocation';
  end if;
  execute replace(definition,old_block,new_block);
end $migration$;

-- New catalog units must be usable by operational item/unit UUID mappings too.
-- Extend the existing private trigger; do not grant a new privileged RPC.
do $migration$
declare definition text; needle text;
begin
  definition:=pg_get_functiondef('boy_central_private.master_runtime_after_write()'::regprocedure);
  needle:=$needle$ if kind in('M_สินค้า','M_รายการค่าใช้จ่าย','M_หน่วยสินค้า')$needle$;
  if strpos(definition,needle)=0 then raise exception 'Runtime trigger changed; review unit linkage';end if;
  execute replace(definition,needle,$replacement$ if kind='M_หน่วย' then
   if not boy_central_private.is_company_admin(new.company_id) then raise exception 'ไม่มีสิทธิ์แก้ไขหน่วย';end if;
   if nullif(btrim(new.row_data->>'ชื่อหน่วย'),'') is null then raise exception 'กรุณากรอกชื่อหน่วย';end if;
   insert into boy_central.units(company_id,code,name,symbol,unit_type,decimal_places,active)
   values(new.company_id,new.record_key,btrim(new.row_data->>'ชื่อหน่วย'),nullif(new.row_data->>'สัญลักษณ์',''),
     case new.row_data->>'ประเภทหน่วย' when 'น้ำหนัก' then 'weight' when 'ปริมาตร' then 'volume' when 'ความยาว' then 'length' else 'count' end,
     coalesce(nullif(new.row_data->>'จำนวนทศนิยม','')::smallint,0),
     new.active and lower(coalesce(new.row_data->>'เปิดใช้งาน','true')) not in('false','0','no','ไม่'))
   on conflict(company_id,code) do update set name=excluded.name,symbol=excluded.symbol,
     unit_type=excluded.unit_type,decimal_places=excluded.decimal_places,active=excluded.active,updated_at=now();
 end if;
 if kind in('M_สินค้า','M_รายการค่าใช้จ่าย','M_หน่วยสินค้า')$replacement$);
end $migration$;
