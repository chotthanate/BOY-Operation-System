-- Applied migration version: 20261122121208.
-- Preserve the existing main-category reporting key and store the optional
-- selected subcategory separately. No historical rows are backfilled.
alter table boy_central.transaction_lines add column subcategory_id uuid references boy_central.categories(id);
create index transaction_lines_subcategory_id_idx on boy_central.transaction_lines(subcategory_id) where subcategory_id is not null;
create function boy_central_private.check_expense_line_subcategory() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.subcategory_id is not null and not exists(select 1 from boy_central.categories c
  where c.id=new.subcategory_id and c.company_id=new.company_id and c.active and c.category_type='item' and c.parent_id=new.category_id) then
  raise exception 'ประเภทย่อยไม่ตรงกับประเภทหลัก';
 end if;
 return new;
end $$;
revoke all on function boy_central_private.check_expense_line_subcategory() from public,anon,authenticated;
create trigger check_expense_line_subcategory before insert or update of category_id,subcategory_id
 on boy_central.transaction_lines for each row execute function boy_central_private.check_expense_line_subcategory();
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('boy_central.record_expense_v2(jsonb)'::regprocedure);
 needle:='set category_id = category_value';
 if strpos(d,needle)=0 then raise exception 'Expense main category assignment changed';end if;
 d:=replace(d,needle,'set category_id = category_value,subcategory_id = nullif(line->>''subcategory_id'','''')::uuid');
 execute d;
 d:=pg_get_functiondef('boy_central.record_expense_v4(jsonb)'::regprocedure);
 needle:='entry-''item_id''-''expense_item_id''-''unit_id''-''conversion_to_base''';
 if strpos(d,needle)=0 then raise exception 'Capital expense cleaning changed';end if;
 d:=replace(d,needle,needle||'-''subcategory_id''');
 execute d;
end $patch$;
