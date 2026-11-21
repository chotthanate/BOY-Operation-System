-- Keep reviewed identity links stable on later master edits. Never resolve a
-- conflict by name: only a previously approved UUID in the same company wins.
do $patch$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('boy_central_private.sync_master_runtime_row(uuid,boolean)'::regprocedure);
 needle:='  select id into runtime from boy_central.expense_items where company_id=r.company_id and code=r.record_key;';
 if strpos(definition,needle)=0 then raise exception 'Runtime identity function changed';end if;
 definition:=replace(definition,needle,$body$
  select e.id into runtime from boy_central.master_runtime_links l
  join boy_central.expense_items e on e.id=l.expense_item_id and e.company_id=r.company_id
  where l.master_row_id=r.id and l.company_id=r.company_id and l.status='ready';
  if runtime is null then
   select id into runtime from boy_central.expense_items where company_id=r.company_id and code=r.record_key;
  end if;$body$);
 execute definition;
end $patch$;

-- Reviewed legacy alias: EXP-0003 / ITEM-0197 is the existing delivery expense.
-- Preserve the operational UUID, code and every historical reference. Refuse a
-- changed/ambiguous definition rather than create or merge arbitrary expenses.
do $link$
declare r boy_central.master_catalog_rows%rowtype; target uuid;
begin
 for r in select m.* from boy_central.master_catalog_rows m
  join boy_central.master_catalog_sheets s on s.id=m.sheet_id
  where s.sheet_name='M_รายการค่าใช้จ่าย' and m.record_key='EXP-0003'
 loop
  if r.row_data->>'item_id'<>'ITEM-0197' or r.row_data->>'ชื่อรายการค่าใช้จ่าย'<>'ค่าขนส่ง'
   or r.row_data->>'category_id'<>'CAT-004' or r.row_data->>'subcategory_id'<>'SUB-0028'
  then raise exception 'Delivery expense definition changed: review mapping';end if;
  select e.id into target from boy_central.expense_items e
   where e.company_id=r.company_id and e.code='EXP-BURGER-DELIVERY'
   and e.active and e.name='ค่าขนส่ง' and e.item_id is null and not e.affects_stock;
  if target is null or exists(select 1 from boy_central.master_runtime_links l
   where l.expense_item_id=target and l.master_row_id<>r.id)
  then raise exception 'Delivery expense identity is missing or already mapped';end if;
  update boy_central.master_runtime_links set expense_item_id=target,status='ready',
   detail='Reviewed alias EXP-0003 / ITEM-0197 -> EXP-BURGER-DELIVERY',updated_at=now()
   where master_row_id=r.id and (expense_item_id is null or expense_item_id=target);
  if not found then raise exception 'Delivery master link changed';end if;
 end loop;
end $link$;

-- Read current main/subcategory codes from the already UUID-linked master row.
-- Older operational rows sometimes only store the main category. Do not rewrite
-- those rows or reinterpret transactions; enrich the current entry catalog.
do $patch$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('boy_central.get_daily_catalog(text,text)'::regprocedure);
 needle:='from ready i left join boy_central.categories c on c.id=i.category_id';
 if strpos(definition,needle)=0 then raise exception 'Daily catalog join changed';end if;
 definition:=replace(definition,needle,$body$from ready i
 left join lateral (
  select c.id from boy_central.master_runtime_links l
  join boy_central.categories c on c.company_id=l.company_id and c.category_type='item'
   and c.code=coalesce(nullif(l.source_data->>'subcategory_id',''),l.source_data->>'category_id')
  where l.company_id=b.company_id and l.status='ready'
   and ((i.expense_item_id is null and l.item_id=i.id) or l.expense_item_id=i.expense_item_id)
  order by l.updated_at desc,l.master_row_id limit 1
 ) mapped on true
 left join boy_central.categories c on c.id=coalesce(mapped.id,i.category_id)$body$);
 -- A schema-only catalog fix must invalidate an old known_version as well.
 definition:=replace(definition,'select md5(concat(','select md5(concat(''daily-catalog-v4'',');
 execute definition;
end $patch$;
