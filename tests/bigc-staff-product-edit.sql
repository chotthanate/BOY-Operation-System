-- Real staff identity; every test write is rolled back.
begin;
do $test$
declare actor uuid; menu jsonb; expected jsonb; before_menu jsonb; after_menu jsonb; changed jsonb; result jsonb; denied boolean:=false;
begin
  select user_id into actor from boy_central.profiles where employee_code='BIGC-SHARED-STAFF' and active;
  if actor is null then raise exception 'staff missing'; end if;
  perform set_config('request.jwt.claim.sub',actor::text,true);
  select menu_config into before_menu from boy_central.bigc_workflow_settings
    where branch_id=(select id from boy_central.branches where code='BIGC-CENTRAL-PATTAYA');
  menu:=before_menu->0;
  expected:=jsonb_build_object('name',coalesce(menu->>'name',menu->>'displayName'),'category',menu->>'category',
    'unit',coalesce(menu->>'unit',''),'active',coalesce((menu->>'active')::boolean,true));
  result:=boy_central.edit_bigc_v2_product(expected || jsonb_build_object('key',menu->>'key','name','ทดสอบสิทธิ์แก้ชื่อ','expected',expected));
  after_menu:=result->'menu_config'; changed:=after_menu->0;
  if changed->>'name'<>'ทดสอบสิทธิ์แก้ชื่อ'
    or changed - array['name','displayName'] is distinct from menu - array['name','displayName']
    or after_menu - 0 is distinct from before_menu - 0 then raise exception 'unrelated fields changed'; end if;
  begin
    perform boy_central.edit_bigc_v2_product(expected || jsonb_build_object('key',menu->>'key','expected',expected,'stockAtBigc',true));
  exception when others then denied:=true; end;
  if not denied then raise exception 'forbidden field accepted'; end if;
  denied:=false;
  begin
    perform boy_central.edit_bigc_v2_product(expected || jsonb_build_object('key',menu->>'key','expected',expected));
  exception when others then denied:=true; end;
  if not denied then raise exception 'stale update accepted'; end if;
  if has_function_privilege('anon','boy_central.edit_bigc_v2_product(jsonb)','EXECUTE') then
    raise exception 'anonymous product editing allowed'; end if;
end $test$;
rollback;
