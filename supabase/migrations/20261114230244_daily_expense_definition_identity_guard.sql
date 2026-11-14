-- An expense definition is a valid central identity, not a physical item.
do $patch$
declare definition text;
begin
 select pg_get_functiondef('boy_central.post_daily_document(jsonb)'::regprocedure) into definition;
 definition:=replace(definition,
  'if nullif(entry->>''master_code'','''') is not null and item is null then',
  'if nullif(entry->>''master_code'','''') is not null and item is null and nullif(entry->>''expense_item_id'','''') is null then');
 if position('and nullif(entry->>''expense_item_id'','''') is null' in definition)=0 then raise exception 'expense identity guard patch did not match';end if;
 execute definition;
end $patch$;
notify pgrst,'reload schema';
