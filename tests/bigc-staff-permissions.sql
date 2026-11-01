begin;
select set_config('request.jwt.claims',jsonb_build_object('sub',(select user_id from boy_central.profiles where employee_code='BIGC-SHARED-STAFF' and active),'role','authenticated')::text,true);
set local role authenticated;
do $test$
declare before_menu jsonb; after_menu jsonb; selected_key text; saved jsonb; denied boolean:=false;
begin
 select s.menu_config into before_menu from boy_central.bigc_workflow_settings s
 join boy_central.branches b on b.id=s.branch_id where b.code='BIGC-CENTRAL-PATTAYA';
 selected_key:=before_menu->0->>'key';
 if selected_key is null then raise exception 'menu fixture missing'; end if;
 saved:=boy_central.save_bigc_v2_default_returns(jsonb_build_object('default_return_keys',jsonb_build_array(selected_key)));
 after_menu:=saved->'menu_config';
 if (select jsonb_agg(item-'defaultReturn' order by ord) from jsonb_array_elements(before_menu) with ordinality row(item,ord))
  is distinct from (select jsonb_agg(item-'defaultReturn' order by ord) from jsonb_array_elements(after_menu) with ordinality row(item,ord)) then
   raise exception 'staff preference save changed product fields'; end if;
 if saved->'default_return_keys'<>jsonb_build_array(selected_key) then raise exception 'return preference did not save'; end if;
 begin
  perform boy_central.save_bigc_v2_settings(jsonb_build_object('menu_config','[]'::jsonb,'default_return_keys','[]'::jsonb));
 exception when others then denied:=sqlerrm like '%manager access required%'; end;
 if not denied then raise exception 'staff menu edit was not denied'; end if;
 denied:=false;
 begin
  perform boy_central.save_bigc_v2_default_returns(jsonb_build_object('menu_config','[]'::jsonb,'default_return_keys','[]'::jsonb));
 exception when others then denied:=sqlerrm like '%only default return keys%'; end;
 if not denied then raise exception 'extra staff fields were not denied'; end if;
 if has_function_privilege('authenticated','boy_central.configure_bigc_staff_account(uuid,uuid)','EXECUTE') then
  raise exception 'authenticated users can provision accounts'; end if;
end $test$;
rollback;
select 'PASS: staff default returns save only allowed fields; catalog edits, extra fields and account provisioning denied; all preference test writes rolled back' as verification;
