-- Expense submission accepts the shared item-category hierarchy. Do not offer
-- identically named POS/sales category trees as manual expense categories.
do $patch$
declare definition text;
begin
 select pg_get_functiondef('boy_central.get_daily_catalog(text,text)'::regprocedure) into definition;
 definition:=replace(definition,
  'from boy_central.categories where company_id=b.company_id and active)',
  'from boy_central.categories where company_id=b.company_id and active and category_type=''item'')');
 if position('and category_type=''item''' in definition)=0 then raise exception 'catalog category scope patch did not match';end if;
 execute definition;
end $patch$;
notify pgrst,'reload schema';
