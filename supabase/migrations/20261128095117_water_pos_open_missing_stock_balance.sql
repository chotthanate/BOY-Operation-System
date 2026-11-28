-- Initialize a missing balance at the stock location already resolved by the device RPC.
-- Do not create catalog rows or allow voids to synthesize a balance.
do $migration$
declare
  ddl text := pg_get_functiondef('boy_central.sync_water_pos_event(text,jsonb)'::regprocedure);
  anchor text := '     select * into bal from boy_central.inventory_balances where location_id=location_id_value and item_id=item_id_value for update;';
begin
  if strpos(ddl,anchor)=0 or length(ddl)-length(replace(ddl,anchor,''))<>length(anchor) then
    raise exception 'unexpected Water POS balance lookup';
  end if;
  execute replace(ddl,anchor,$patch$     if kind='STOCK_ADJUST' then
       insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id)
       values(d.company_id,d.branch_id,location_id_value,item_id_value)
       on conflict(location_id,item_id) do nothing;
     end if;
$patch$||anchor);
end
$migration$;
