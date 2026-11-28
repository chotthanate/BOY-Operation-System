-- BigC South fixture with an admin and tracked packaging. Nothing is committed.
begin;
do $test$
declare b uuid; i uuid; l uuid; actor uuid; qty numeric; result jsonb; body jsonb; expected numeric; rid uuid:=gen_random_uuid();
begin
  select br.id,bi.item_id,bi.default_location_id,p.user_id,bal.quantity_on_hand
  into strict b,i,l,actor,expected from boy_central.branches br join boy_central.branch_items bi on bi.branch_id=br.id
  join boy_central.inventory_balances bal on bal.item_id=bi.item_id and bal.location_id=bi.default_location_id
  join boy_central.items it on it.id=bi.item_id and it.track_stock and it.stock_target_item_id is null and it.active
  join boy_central.profiles p on p.company_id=br.company_id and p.active and p.company_role='admin'
  where br.code='BIGC-SOUTH-PATTAYA' and bi.active and it.code like 'WATER-PKG%' limit 1;
  body:=jsonb_build_object('branch_id',b,'item_id',i,'location_id',l,'expected_quantity',expected,'quantity',-123456,'reason','QA rollback only','request_id',rid);
  begin
    perform boy_central.admin_set_water_stock(body);
    raise exception 'unauthenticated adjustment allowed';
  exception when insufficient_privilege then null; end;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  perform set_config('request.jwt.claims',jsonb_build_object('sub',actor,'role','authenticated')::text,true);
  result:=boy_central.admin_set_water_stock(body);
  select quantity_on_hand into qty from boy_central.inventory_balances where item_id=i and location_id=l;
  if qty<>-123456 or result<>boy_central.admin_set_water_stock(body) then raise exception 'negative or retry failed'; end if;
  if (select count(*) from boy_central.stock_movements where source_system='water_admin' and external_id=rid::text)<>1 then raise exception 'movement not atomic'; end if;
  begin
    perform boy_central.admin_set_water_stock(body||jsonb_build_object('request_id',gen_random_uuid(),'quantity',0));
    raise exception 'stale input overwrote stock';
  exception when serialization_failure then null; end;
end $test$;
rollback;
