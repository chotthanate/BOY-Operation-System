-- Master catalog records and operational UUIDs are separate identities. Persist
-- the relationship; never infer it from the display name or rewrite history.
create table boy_central.master_runtime_links(
 master_row_id uuid primary key references boy_central.master_catalog_rows(id),
 company_id uuid not null references boy_central.companies(id),
 item_id uuid references boy_central.items(id),expense_item_id uuid references boy_central.expense_items(id),
 status text not null check(status in('ready','missing_unit','name_conflict','unit_review','missing_category')),
 detail text,source_fingerprint text not null,source_data jsonb not null,updated_at timestamptz not null default now(),
 check(not(item_id is not null and expense_item_id is not null)));
create index master_runtime_links_company on boy_central.master_runtime_links(company_id,status);
create index master_runtime_links_item on boy_central.master_runtime_links(item_id);
create index master_runtime_links_expense on boy_central.master_runtime_links(expense_item_id);
alter table boy_central.master_runtime_links enable row level security;
revoke all on boy_central.master_runtime_links from public,anon,authenticated;
grant select on boy_central.master_runtime_links to authenticated;
create policy master_runtime_link_read on boy_central.master_runtime_links for select to authenticated
 using((select boy_central_private.is_company_member(company_id)));

create function boy_central_private.sync_master_runtime_row(row_id uuid,strict_changes boolean default false)
returns text language plpgsql security definer set search_path='' as $$
declare r boy_central.master_catalog_rows%rowtype;s text;d jsonb;u uuid;c uuid;runtime uuid;
 old_item boy_central.items%rowtype;label text;state text:='ready';message text;enabled boolean;rate numeric;
 old_rate numeric;used boolean;source_item uuid;prior jsonb;base_changed boolean;new_label text;
begin
 select * into r from boy_central.master_catalog_rows where id=row_id;
 select sheet_name into s from boy_central.master_catalog_sheets where id=r.sheet_id;
 d:=r.row_data;enabled:=r.active and lower(coalesce(d->>'เปิดใช้งาน','true')) not in('false','0','no','ไม่');
 select source_data into prior from boy_central.master_runtime_links where master_row_id=r.id;
 if not enabled or s not in('M_สินค้า','M_รายการค่าใช้จ่าย','M_หน่วยสินค้า') then return 'skipped';end if;
 if s='M_หน่วยสินค้า' then
  select i.id,i.base_unit_id into runtime,source_item from boy_central.master_runtime_links l
   join boy_central.master_catalog_rows m on m.id=l.master_row_id join boy_central.items i on i.id=l.item_id
   join boy_central.master_catalog_sheets ms on ms.id=m.sheet_id
   where l.company_id=r.company_id and ms.sheet_name='M_สินค้า' and m.record_key=d->>'item_id' and l.status='ready';
  select id into u from boy_central.units where company_id=r.company_id and code=d->>'unit_id';
  if runtime is null or u is null then return 'missing_unit';end if;
  rate:=nullif(d->>'อัตราแปลงเป็นหน่วยฐาน','')::numeric;
  if rate is null or rate<=0 then return 'missing_unit';end if;
  if u=source_item and rate<>1 then
   if strict_changes then raise exception 'หน่วยฐานต้องมีอัตราแปลงเท่ากับ 1';end if;return 'unit_review';
  end if;
  select conversion_to_base into old_rate from boy_central.item_units where item_id=runtime and unit_id=u;
  if old_rate is not null and old_rate<>rate and exists(select 1 from boy_central.transaction_lines where item_id=runtime and unit_id=u) then
   if strict_changes then raise exception 'หน่วยนี้มีธุรกรรมแล้ว ต้องปรับหน่วยแบบมีวันที่เริ่มใช้';end if;return 'unit_review';
  end if;
  insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue)
  values(r.company_id,runtime,u,rate,u=source_item,coalesce((d->>'ใช้หน่วยนี้ตอนซื้อ')::boolean,true),coalesce((d->>'ใช้หน่วยนี้ตอนเบิก')::boolean,true))
  on conflict(item_id,unit_id) do update set conversion_to_base=excluded.conversion_to_base,allow_purchase=excluded.allow_purchase,allow_issue=excluded.allow_issue,active=true
  where (item_units.conversion_to_base,item_units.allow_purchase,item_units.allow_issue,item_units.active) is distinct from(excluded.conversion_to_base,excluded.allow_purchase,excluded.allow_issue,true);
  return 'ready';
 end if;
 select id into c from boy_central.categories where company_id=r.company_id and category_type='item' and code=coalesce(nullif(d->>'subcategory_id',''),d->>'category_id');
 if c is null then select id into c from boy_central.categories where company_id=r.company_id and category_type='item' and code=d->>'category_id';end if;
 if s='M_สินค้า' then
  label:=nullif(trim(d->>'ชื่อสินค้า'),'');
  select * into old_item from boy_central.items where company_id=r.company_id and code=r.record_key for update;
  runtime:=old_item.id;
  select id into u from boy_central.units where company_id=r.company_id and code=d->>'base_unit_id' and active;
  if runtime is null then
   if u is null then state:='missing_unit';message:='ยังไม่กำหนดหน่วยฐาน';
   elsif exists(select 1 from boy_central.items where company_id=r.company_id and name=label) then state:='name_conflict';message:='มีสินค้าชื่อเดียวกันต่างรหัส ต้องตรวจตัวตนและหน่วยก่อนรวม';
   else
    insert into boy_central.items(company_id,code,name,category_id,base_unit_id,track_stock,item_type,brand,legacy_name)
    values(r.company_id,r.record_key,label,c,u,
    coalesce((d->>'ติดตามสต็อก')::boolean,false) and nullif(d->>'stock_target_item_id','') is null,
    case when d->>'ประเภทข้อมูล'='NON_STOCK_ITEM' then 'NON_STOCK_ITEM' else 'STOCK_ITEM' end,nullif(d->>'ยี่ห้อ',''),nullif(d->>'ชื่อเดิม','')) returning id into runtime;
   end if;
  elsif strict_changes and prior is not null then
   if u is null then raise exception 'กรุณากำหนดหน่วยฐานให้ครบ';end if;
   base_changed:=(prior->>'base_unit_id') is distinct from(d->>'base_unit_id');
   if u<>old_item.base_unit_id and base_changed then
    used:=exists(select 1 from boy_central.transaction_lines where item_id=runtime)
     or exists(select 1 from boy_central.stock_movements where item_id=runtime)
     or exists(select 1 from boy_central.recipes where item_id=runtime)
     or exists(select 1 from boy_central.pos_modifier_recipes where item_id=runtime)
     or old_item.stock_target_item_id is not null
     or exists(select 1 from boy_central.items where stock_target_item_id=runtime);
    if used then raise exception 'สินค้านี้มีธุรกรรม สูตร หรือกลุ่มสต็อกแล้ว ต้องแปลงหน่วยแบบมีวันที่เริ่มใช้';end if;
    update boy_central.item_units set is_base_unit=false where item_id=runtime and is_base_unit;
   end if;
   new_label:=case when prior->>'ชื่อสินค้า' is distinct from d->>'ชื่อสินค้า' then label else old_item.name end;
   update boy_central.items set name=new_label,category_id=coalesce(c,category_id),base_unit_id=case when base_changed then u else base_unit_id end,brand=nullif(d->>'ยี่ห้อ','') where id=runtime
    and(name,category_id,base_unit_id,brand) is distinct from(new_label,coalesce(c,category_id),case when base_changed then u else base_unit_id end,nullif(d->>'ยี่ห้อ',''));
   if u<>old_item.base_unit_id and not base_changed then state:='unit_review';message:='หน่วยข้อมูลกลางต่างจากหน่วยที่ใช้ทำรายการ เก็บ UUID และประวัติเดิมไว้';end if;
  elsif u is not null and u<>old_item.base_unit_id then
   state:='unit_review';message:='หน่วยข้อมูลกลางต่างจากหน่วยที่ใช้ทำรายการ เก็บ UUID และประวัติเดิมไว้';
  end if;
  if runtime is not null then
   insert into boy_central.item_units(company_id,item_id,unit_id,conversion_to_base,is_base_unit)
    select company_id,id,base_unit_id,1,true from boy_central.items where id=runtime on conflict(item_id,unit_id) do nothing;
  end if;
 else
  label:=nullif(trim(d->>'ชื่อรายการค่าใช้จ่าย'),'');
  select id into runtime from boy_central.expense_items where company_id=r.company_id and code=r.record_key;
  -- A pre-existing explicit ITEM->EXP definition is an identity link, not a name guess.
  if runtime is null and nullif(d->>'item_id','') is not null then
   select id into runtime from boy_central.expense_items where company_id=r.company_id and code='EXP-'||(d->>'item_id');
  end if;
  if runtime is null then
   if c is null then state:='missing_category';message:='ยังไม่เชื่อมหมวดค่าใช้จ่าย';
   elsif exists(select 1 from boy_central.expense_items where company_id=r.company_id and name=label) then state:='name_conflict';message:='ชื่อค่าใช้จ่ายซ้ำต่างรหัส ต้องตรวจรายการเดิมก่อนรวม';
   else
    insert into boy_central.expense_items(company_id,code,name,category_id,affects_stock,requires_quantity,requires_unit,requires_supplier,requires_receipt)
    values(r.company_id,r.record_key,label,c,false,false,false,coalesce((d->>'ต้องระบุผู้ขาย')::boolean,false),coalesce((d->>'ต้องมีหลักฐาน')::boolean,false)) returning id into runtime;
   end if;
  elsif strict_changes then
   update boy_central.expense_items set name=label,category_id=coalesce(c,category_id) where id=runtime and(name,category_id) is distinct from(label,coalesce(c,category_id));
  end if;
 end if;
 insert into boy_central.master_runtime_links(master_row_id,company_id,item_id,expense_item_id,status,detail,source_fingerprint,source_data)
 values(r.id,r.company_id,case when s='M_สินค้า' then runtime end,case when s='M_รายการค่าใช้จ่าย' then runtime end,state,message,md5(d::text),d)
 on conflict(master_row_id) do update set item_id=excluded.item_id,expense_item_id=excluded.expense_item_id,status=excluded.status,detail=excluded.detail,source_fingerprint=excluded.source_fingerprint,source_data=excluded.source_data,updated_at=now();
 return state;
end $$;
revoke all on function boy_central_private.sync_master_runtime_row(uuid,boolean) from public,anon,authenticated;

create function boy_central_private.backfill_master_runtime(company uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare entry record;result text;
begin
 for entry in select r.id from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id
 where r.company_id=company and r.active and s.sheet_name in('M_สินค้า','M_รายการค่าใช้จ่าย') order by s.sheet_name,r.row_number loop
 perform boy_central_private.sync_master_runtime_row(entry.id,false);end loop;
 for entry in select r.id from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id
 where r.company_id=company and r.active and s.sheet_name='M_หน่วยสินค้า' order by r.row_number loop
 perform boy_central_private.sync_master_runtime_row(entry.id,false);end loop;
 return (select coalesce(jsonb_object_agg(status,n),'{}') from(select status,count(*) n from boy_central.master_runtime_links where company_id=company group by status)x);
end $$;
revoke all on function boy_central_private.backfill_master_runtime(uuid) from public,anon,authenticated;

create function boy_central_private.master_runtime_after_write() returns trigger language plpgsql security definer set search_path='' as $$
declare kind text;
begin
 select sheet_name into kind from boy_central.master_catalog_sheets where id=new.sheet_id;
 if kind in('M_สินค้า','M_รายการค่าใช้จ่าย','M_หน่วยสินค้า') and(TG_OP='INSERT' or new.row_data is distinct from old.row_data) then
 perform boy_central_private.sync_master_runtime_row(new.id,true);
 end if;return new;
end $$;
revoke all on function boy_central_private.master_runtime_after_write() from public,anon,authenticated;
create trigger master_runtime_after_write after insert or update of row_data on boy_central.master_catalog_rows
 for each row execute function boy_central_private.master_runtime_after_write();

-- Add operational UUIDs only. No receipt, financial transaction, balance, recipe,
-- existing product UUID or historical unit is rewritten by this backfill.
do $$declare company uuid;begin
 for company in select distinct company_id from boy_central.master_catalog_sheets where active loop
 perform boy_central_private.backfill_master_runtime(company);
 end loop;
end $$;
notify pgrst,'reload schema';
