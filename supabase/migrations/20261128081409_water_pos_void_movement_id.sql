-- A sale and its reversal share the order ID but must have different ledger IDs.
-- Preserve historical keys, stock-adjustment behavior, and RPC permissions.
do $migration$
declare
  ddl text := pg_get_functiondef('boy_central.sync_water_pos_event(text,jsonb)'::regprocedure);
  before text := $old$'water_pos',ext||':'||item_id_value,coalesce$old$;
  after text := $new$'water_pos',case when kind='VOID' then 'void:'||d.branch_id||':'||ext||':'||item_id_value else ext||':'||item_id_value end,coalesce$new$;
begin
  if strpos(ddl,before)=0 or length(ddl)-length(replace(ddl,before,''))<>length(before) then
    raise exception 'unexpected Water POS stock movement definition';
  end if;
  execute replace(ddl,before,after);
end
$migration$;
