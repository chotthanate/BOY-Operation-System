-- Run inside BEGIN/ROLLBACK; never leave fixture balances or device tokens behind.
do $$
declare d boy_central.pos_devices%rowtype; item uuid; qty numeric; request jsonb; result jsonb; owner uuid;
begin
 select * into d from boy_central.pos_devices where branch_id=(select id from boy_central.branches where code='GRILL') and status='active' limit 1;
 if d.id is null then raise exception 'missing GRILL fixture device'; end if;
 update boy_central.pos_devices set access_token_hash=encode(extensions.digest('qa-rollback-admin-stock','sha256'),'hex') where id=d.id;
 select user_id into owner from boy_central.profiles where company_id=d.company_id and active and company_role='admin' limit 1;
 select b.item_id,b.quantity_on_hand into item,qty from boy_central.inventory_balances b
 join boy_central.branch_items bi on bi.branch_id=b.branch_id and bi.item_id=b.item_id and bi.default_location_id=b.location_id
 where b.branch_id=d.branch_id and bi.active limit 1;
 if item is null then raise exception 'missing stock fixture'; end if;
 request:=jsonb_build_object('request_id',gen_random_uuid(),'item_id',item,'quantity',50,'expected_quantity',qty,'reason','QA rollback');
 perform set_config('request.jwt.claim.sub',gen_random_uuid()::text,true);
 begin
   perform boy_central.admin_set_grill_stock('qa-rollback-admin-stock',request);
   raise exception 'staff was allowed';
 exception when insufficient_privilege then null; end;
 begin
   perform boy_central.sync_pos_stock_adjustment('qa-rollback-admin-stock',jsonb_build_object('external_id',gen_random_uuid(),'stock_deltas','[]'::jsonb));
   raise exception 'device-only adjustment was allowed';
 exception when insufficient_privilege then null; end;
 perform set_config('request.jwt.claim.sub',owner::text,true);
 result:=boy_central.admin_set_grill_stock('qa-rollback-admin-stock',request);
 if result->>'status'<>'saved' then raise exception 'admin save failed'; end if;
 if boy_central.admin_set_grill_stock('qa-rollback-admin-stock',request)<>result then raise exception 'retry mismatch'; end if;
 if (select count(*) from boy_central.audit_log where action='grill_admin_set_stock' and request_id=request->>'request_id')<>1 then raise exception 'duplicate audit'; end if;
 begin
   perform boy_central.admin_set_grill_stock('qa-rollback-admin-stock',request||jsonb_build_object('quantity',51));
   raise exception 'changed retry payload was allowed';
 exception when raise_exception then if sqlerrm<>'request_id conflict' then raise; end if; end;
 begin
   perform boy_central.admin_set_grill_stock('qa-rollback-admin-stock',request||jsonb_build_object('request_id',gen_random_uuid(),'expected_quantity',49));
   raise exception 'stale stock was allowed';
 exception when serialization_failure then null; end;
 begin
   perform boy_central.admin_set_grill_stock('qa-rollback-admin-stock',request||jsonb_build_object('request_id',gen_random_uuid(),'quantity',-1));
   raise exception 'negative quantity allowed';
 exception when raise_exception then if sqlerrm<>'จำนวนหรือเหตุผลไม่ถูกต้อง' then raise; end if; end;
end $$;
