-- Main-only rows are valid category definitions, not fake subcategories.
update boy_central.master_catalog_sheets set required_headers='["ชื่อประเภทหลัก"]'::jsonb
where sheet_name='M_หมวดหมู่';
create function boy_central_private.sync_master_category() returns trigger
language plpgsql security definer set search_path='' as $$
declare main uuid;enabled boolean;
begin
 if not exists(select 1 from boy_central.master_catalog_sheets where id=new.sheet_id and sheet_name='M_หมวดหมู่') then return new;end if;
 if not boy_central_private.is_company_admin(new.company_id) then raise exception 'เฉพาะแอดมินที่แก้หมวดหมู่ได้';end if;
 if nullif(trim(new.row_data->>'category_id'),'') is null or nullif(trim(new.row_data->>'ชื่อประเภทหลัก'),'') is null then raise exception 'ระบุประเภทหลัก';end if;
 enabled:=new.active and lower(coalesce(new.row_data->>'เปิดใช้งาน','true')) not in('false','0','no');
 insert into boy_central.categories(company_id,code,name,category_type,active)
 values(new.company_id,new.row_data->>'category_id',trim(new.row_data->>'ชื่อประเภทหลัก'),'item',true)
 on conflict(company_id,category_type,code) do update set name=excluded.name,updated_at=now() returning id into main;
 if nullif(trim(new.row_data->>'ชื่อประเภทย่อย'),'') is not null then
  insert into boy_central.categories(company_id,code,name,parent_id,category_type,active,sort_order)
  values(new.company_id,new.record_key,trim(new.row_data->>'ชื่อประเภทย่อย'),main,'item',enabled,coalesce(nullif(new.row_data->>'ลำดับการแสดง','')::integer,0))
  on conflict(company_id,category_type,code) do update set name=excluded.name,parent_id=excluded.parent_id,active=excluded.active,sort_order=excluded.sort_order,updated_at=now();
 end if;
 return new;
end $$;
revoke all on function boy_central_private.sync_master_category() from public,anon,authenticated;
create trigger master_category_after_write after insert or update of row_data on boy_central.master_catalog_rows
for each row execute function boy_central_private.sync_master_category();

-- Populate missing operational UUID definitions from existing central codes.
-- Existing category UUIDs and their transaction references are never replaced.
insert into boy_central.categories(company_id,code,name,category_type,active)
select distinct on(r.company_id,r.row_data->>'category_id') r.company_id,r.row_data->>'category_id',r.row_data->>'ชื่อประเภทหลัก','item',true
from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id
where s.sheet_name='M_หมวดหมู่' and nullif(r.row_data->>'category_id','') is not null and nullif(r.row_data->>'ชื่อประเภทหลัก','') is not null
order by r.company_id,r.row_data->>'category_id',r.updated_at desc
on conflict(company_id,category_type,code) do nothing;
insert into boy_central.categories(company_id,code,name,parent_id,category_type,active)
select r.company_id,r.record_key,r.row_data->>'ชื่อประเภทย่อย',p.id,'item',r.active and lower(coalesce(r.row_data->>'เปิดใช้งาน','true')) not in('false','0','no')
from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id
join boy_central.categories p on p.company_id=r.company_id and p.category_type='item' and p.code=r.row_data->>'category_id'
where s.sheet_name='M_หมวดหมู่' and nullif(r.row_data->>'ชื่อประเภทย่อย','') is not null
on conflict(company_id,category_type,code) do nothing;

create function boy_central.get_expense_category_options(branch_code text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare b boy_central.branches%rowtype;scope_key text;result jsonb;
begin
 select * into b from boy_central.branches where code=branch_code and active;
 if auth.uid() is null or b.id is null or not boy_central_private.has_branch_access(b.id,null) then raise exception 'branch access denied';end if;
 scope_key:=case b.code when 'GRILL' then 'ใช้กับร้านเนื้อย่าง' when 'BURGER' then 'ใช้กับร้านเบอร์เกอร์' else 'ใช้กับร้านน้ำ' end;
 with definitions as(
  select r.row_data d,r.record_key,r.active and lower(coalesce(r.row_data->>'เปิดใช้งาน','true')) not in('false','0','no') enabled from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id
  where r.company_id=b.company_id and s.sheet_name='M_หมวดหมู่'
 ), allowed as(
  select * from definitions where enabled and (lower(coalesce(d->>scope_key,'false')) in('true','1','yes')
   or not exists(select 1 from unnest(array['ใช้กับร้านน้ำ','ใช้กับร้านเนื้อย่าง','ใช้กับร้านเบอร์เกอร์']) k where lower(coalesce(d->>k,'false')) in('true','1','yes')))
 ), eligible as(
  select c.* from boy_central.categories c where c.company_id=b.company_id and c.active and c.category_type='item' and c.code<>'CAT-900000'
   and (exists(select 1 from allowed a where c.code=case when nullif(a.d->>'ชื่อประเภทย่อย','') is null then a.d->>'category_id' else a.record_key end)
    or (not exists(select 1 from definitions a where a.record_key=c.code or a.d->>'category_id'=c.code)
     and exists(select 1 from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id where bi.branch_id=b.id and bi.active and i.active and i.category_id=c.id)))
 ), visible as(select * from eligible union select c.* from boy_central.categories c where c.id in(select parent_id from eligible)), combined as(
 select * from visible union select e.* from boy_central.categories e where e.company_id=b.company_id and e.category_type='expense' and e.active and exists(select 1 from visible v where e.code='EXP-'||v.code))
 select coalesce(jsonb_agg(jsonb_build_object('id',id,'code',code,'name',name,'parent_id',parent_id,'category_type',category_type) order by category_type desc,sort_order,name),'[]') into result from combined;
 return result;
end $$;
revoke all on function boy_central.get_expense_category_options(text) from public,anon;
grant execute on function boy_central.get_expense_category_options(text) to authenticated;

create function boy_central_private.create_expense_category(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype;s boy_central.master_catalog_sheets%rowtype;
 parent boy_central.categories%rowtype;created boy_central.categories%rowtype;
 kind text:=payload->>'kind';label text:=trim(payload->>'name');v_code text;number bigint;row_data jsonb;scopes jsonb:=payload->'store_types';
begin
 select * into b from boy_central.branches where code=payload->>'branch_code' and active;
 if auth.uid() is null or b.id is null or not boy_central_private.is_company_admin(b.company_id) then raise exception 'เฉพาะแอดมินที่เพิ่มหมวดหมู่ได้';end if;
 if kind not in('main','sub') or label is null or length(label) not between 1 and 120 then raise exception 'ระบุชื่อประเภทให้ถูกต้อง';end if;
 if jsonb_typeof(scopes) is distinct from 'array' or exists(select 1 from jsonb_array_elements_text(scopes)x where x not in('water','grill','burger')) then raise exception 'เลือกร้านให้ถูกต้อง';end if;
 select * into s from boy_central.master_catalog_sheets where company_id=b.company_id and sheet_name='M_หมวดหมู่' and active for update;
 if kind='main' then
  if exists(select 1 from boy_central.categories where company_id=b.company_id and category_type='item' and parent_id is null and lower(name)=lower(label)) then raise exception 'มีประเภทหลักชื่อนี้แล้ว';end if;
  select coalesce(max(substring(code from '[0-9]+$')::bigint),0)+1 into number from boy_central.categories where company_id=b.company_id and category_type='item' and code~'^CAT-[0-9]+$' and code<>'CAT-900000';
  v_code:='CAT-'||lpad(number::text,greatest(3,length(number::text)),'0');
  row_data:=jsonb_build_object('category_id',v_code,'ชื่อประเภทหลัก',label,'ชื่อประเภทย่อย','');
 else
  select * into parent from boy_central.categories where company_id=b.company_id and id=(payload->>'parent_id')::uuid and category_type='item' and parent_id is null and active;
  if parent.id is null then raise exception 'เลือกประเภทหลัก';end if;
  if exists(select 1 from boy_central.categories where company_id=b.company_id and category_type='item' and parent_id=parent.id and lower(name)=lower(label)) then raise exception 'มีประเภทย่อยชื่อนี้แล้ว';end if;
  row_data:=jsonb_build_object('category_id',parent.code,'ชื่อประเภทหลัก',parent.name,'ชื่อประเภทย่อย',label);
 end if;
 row_data:=row_data||jsonb_build_object('เปิดใช้งาน',true,'ใช้กับร้านน้ำ',scopes?'water','ใช้กับร้านเนื้อย่าง',scopes?'grill','ใช้กับร้านเบอร์เกอร์',scopes?'burger');
 perform boy_central.bulk_upsert_master_catalog_rows('M_หมวดหมู่',jsonb_build_array(row_data),'เพิ่มหมวดจากหน้ารายจ่าย');
 if kind='main' then select * into created from boy_central.categories where company_id=b.company_id and category_type='item' and categories.code=v_code;
 else select * into created from boy_central.categories where company_id=b.company_id and category_type='item' and parent_id=parent.id and name=label;end if;
 return jsonb_build_object('id',created.id,'code',created.code,'name',created.name,'parent_id',created.parent_id,'main_name',coalesce(parent.name,created.name),'categories',boy_central.get_expense_category_options(b.code));
end $$;
revoke all on function boy_central_private.create_expense_category(jsonb) from public,anon;
grant execute on function boy_central_private.create_expense_category(jsonb) to authenticated;
create function boy_central.create_expense_category(payload jsonb) returns jsonb
language sql security invoker set search_path='' as $$select boy_central_private.create_expense_category(payload)$$;
revoke all on function boy_central.create_expense_category(jsonb) from public,anon;
grant execute on function boy_central.create_expense_category(jsonb) to authenticated;

-- Preserve the daily API and its cache/version contract, but scope both the
-- category hierarchy and item options before they reach the legacy adapters.
do $patch$ declare definition text;needle text;
begin
 definition:=pg_get_functiondef('boy_central.get_daily_catalog(text,text)'::regprocedure);
 definition:=replace(definition,'e.name,e.category_id,null::uuid',
 'e.name,coalesce((select ci.id from boy_central.categories ce join boy_central.categories ci on ci.company_id=ce.company_id and ci.category_type=''item'' and ci.code=replace(ce.code,''EXP-'','''') where ce.id=e.category_id and ce.category_type=''expense''),e.category_id),null::uuid');
 definition:=replace(definition,'''category_id'',coalesce(c.parent_id,c.id)', '''subcategory_id'',case when c.parent_id is not null then c.id else null end,''category_id'',coalesce(c.parent_id,c.id)');
 needle:=' return result;';
 if strpos(definition,needle)=0 then raise exception 'Daily catalog definition changed';end if;
 definition:=replace(definition,needle,$body$ result:=jsonb_set(result,'{categories}',coalesce((select jsonb_agg(c) from jsonb_array_elements(boy_central.get_expense_category_options(target_branch_code))c where c->>'category_type'='item'),'[]'));
 result:=jsonb_set(result,'{items}',coalesce((select jsonb_agg(x) from jsonb_array_elements(result->'items')x
  where exists(select 1 from jsonb_array_elements(result->'categories')c where c->>'id'=coalesce(x->>'subcategory_id',x->>'category_id'))),'[]'));
 return result;$body$);
 execute definition;
end $patch$;
