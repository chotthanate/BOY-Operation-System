-- Manual GRILL balances require an online company-admin identity, not a local PIN.
create or replace function boy_central.admin_set_grill_stock(device_token text, payload jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 d boy_central.pos_devices%rowtype;
 b boy_central.inventory_balances%rowtype;
 item uuid; loc uuid; rid uuid; target numeric; expected numeric; delta numeric;
 previous jsonb; result jsonb; reason text;
begin
 select * into d from boy_central_private.pos_device_for_token(device_token);
 if d.id is null or not exists(select 1 from boy_central.branches where id=d.branch_id and code='GRILL')
   or not boy_central_private.is_company_admin(d.company_id) then
   raise exception 'เฉพาะแอดมินที่เข้าสู่ระบบออนไลน์เท่านั้น' using errcode='42501';
 end if;
 rid := (payload->>'request_id')::uuid;
 if rid is null then raise exception 'request_id required'; end if;
 perform pg_advisory_xact_lock(hashtextextended('grill-stock:'||rid::text,0));
 select after_data into previous from boy_central.audit_log
 where company_id=d.company_id and branch_id=d.branch_id and action='grill_admin_set_stock' and request_id=rid::text;
 if previous is not null then
   if previous->'payload' <> payload then raise exception 'request_id conflict'; end if;
   return previous->'result';
 end if;
 target := (payload->>'quantity')::numeric;
 expected := (payload->>'expected_quantity')::numeric;
 reason := trim(coalesce(payload->>'reason',''));
 if target is null or expected is null or target::text in ('NaN','Infinity','-Infinity')
   or expected::text in ('NaN','Infinity','-Infinity') or target<0 or target>1000000000
   or scale(target)>6 or reason='' or length(reason)>500 then raise exception 'จำนวนหรือเหตุผลไม่ถูกต้อง'; end if;
 select r.item_id,r.location_id into item,loc from boy_central_private.resolve_pos_stock_item(d.branch_id,payload->>'item_id',null,null) r;
 if item is null or loc is null then raise exception 'ไม่พบรายการสต็อกของสาขา'; end if;
 if (select count(*) from boy_central.inventory_locations where branch_id=d.branch_id and active)<>1 then
   raise exception 'สาขานี้มีหลายจุดเก็บ กรุณาปรับผ่านผู้ดูแลระบบ';
 end if;
 -- Never silently reinterpret totals when more than one physical location exists.
 if exists(select 1 from boy_central.inventory_balances where branch_id=d.branch_id and item_id=item and location_id<>loc and quantity_on_hand<>0) then
   raise exception 'สินค้านี้มีหลายจุดเก็บ กรุณาปรับผ่านผู้ดูแลระบบ';
 end if;
 insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
 values(d.company_id,d.branch_id,loc,item,0,0,0) on conflict(location_id,item_id) do nothing;
 select * into b from boy_central.inventory_balances where location_id=loc and item_id=item for update;
 if b.quantity_on_hand<>expected then raise exception 'ยอดสต็อกเปลี่ยนแล้ว กรุณาโหลดใหม่' using errcode='40001'; end if;
 delta := target-b.quantity_on_hand;
 if delta<>0 then
   insert into boy_central.stock_movements(company_id,branch_id,location_id,item_id,movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,external_id,occurred_at,created_by,reason)
   values(d.company_id,d.branch_id,loc,item,'adjustment',b.quantity_on_hand,delta,target,b.average_unit_cost,abs(delta)*b.average_unit_cost,'grill_admin',rid::text,now(),auth.uid(),reason);
   update boy_central.inventory_balances set quantity_on_hand=target,inventory_value=target*average_unit_cost,updated_at=now() where id=b.id;
   update boy_central.pos_branch_configs set version=version+1,updated_at=now() where branch_id=d.branch_id;
 end if;
 result := jsonb_build_object('status','saved','quantity',target,'item_id',item,'request_id',rid);
 insert into boy_central.audit_log(company_id,branch_id,actor_user_id,action,entity_type,entity_id,source_system,request_id,before_data,after_data)
 values(d.company_id,d.branch_id,auth.uid(),'grill_admin_set_stock','inventory_balances',b.id::text,'grill_admin',rid::text,
 jsonb_build_object('quantity',b.quantity_on_hand),jsonb_build_object('payload',payload,'result',result));
 return result;
end $$;
revoke all on function boy_central.admin_set_grill_stock(text,jsonb) from public,anon;
grant execute on function boy_central.admin_set_grill_stock(text,jsonb) to authenticated;

-- A device bearer token alone must not provide a bypass around the admin API.
do $guard$
declare definition text;
begin
 select pg_get_functiondef('boy_central.sync_pos_stock_adjustment(text,jsonb)'::regprocedure) into definition;
 if position('GRILL manual adjustments require online admin' in definition)=0 then
   definition := replace(definition,
     'if d.id is null then raise exception ''device access denied''; end if;',
     'if d.id is null then raise exception ''device access denied''; end if;
      if exists(select 1 from boy_central.branches where id=d.branch_id and code=''GRILL'') then
        raise exception ''GRILL manual adjustments require online admin'' using errcode=''42501'';
      end if;');
   if position('GRILL manual adjustments require online admin' in definition)=0 then raise exception 'unexpected stock sync definition'; end if;
   execute definition;
 end if;
end $guard$;

-- Extract the already deployed, tested line receiver into one private core.
-- Stop rather than patch an unexpected upstream definition.
do $core$
declare definition text; old_auth text;
begin
 select pg_get_functiondef('boy_central_private.grill_receive(text,jsonb)'::regprocedure) into definition;
 old_auth := '  select * into d from boy_central_private.pos_device_for_token(raw_token);'||chr(10)||
 '  if d.id is null or d.branch_id <> ''a05ff385-0c34-40ac-be61-7f12a0774737''::uuid then raise exception ''device access denied''; end if;';
 if position(old_auth in definition)=0 then raise exception 'unexpected GRILL receipt definition'; end if;
 definition := replace(definition,'boy_central_private.grill_receive(raw_token text, payload jsonb)',
 'boy_central_private.receive_purchase_lines(target_company_id uuid, target_branch_id uuid, target_device_id uuid, target_actor uuid, source_name text, payload jsonb)');
 definition := replace(definition,'d boy_central.pos_devices%rowtype;','action_name text;');
 definition := replace(definition,old_auth,
 '  select case code when ''GRILL'' then ''grill_receive_purchase'' when ''BURGER'' then ''burger_receive_purchase'' else ''web_receive_purchase'' end into action_name from boy_central.branches where id=target_branch_id;');
 definition := replace(replace(replace(definition,'d.company_id','target_company_id'),'d.branch_id','target_branch_id'),'d.id','target_device_id');
 definition := replace(definition,'''grill_receive_purchase''', 'action_name');
 -- The CASE initializer must remain a literal, not self-reference.
 definition := replace(definition,'when ''GRILL'' then action_name','when ''GRILL'' then ''grill_receive_purchase''');
 definition := replace(definition,'''grill_pos_android''','source_name');
 definition := replace(definition,'audit_log(company_id,branch_id,action,','audit_log(company_id,branch_id,actor_user_id,action,');
 definition := replace(definition,'values(target_company_id,target_branch_id,action_name,','values(target_company_id,target_branch_id,target_actor,action_name,');
 if position('create or replace function boy_central_private.receive_purchase_lines' in lower(definition))=0 then raise exception 'receipt core signature not installed'; end if;
 execute definition;
end $core$;
revoke all on function boy_central_private.receive_purchase_lines(uuid,uuid,uuid,uuid,text,jsonb) from public,anon,authenticated;

create or replace function boy_central_private.grill_receive(raw_token text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d boy_central.pos_devices%rowtype;
begin
 select * into d from boy_central_private.pos_device_for_token(raw_token);
 if d.id is null or not exists(select 1 from boy_central.branches where id=d.branch_id and code='GRILL') then raise exception 'device access denied'; end if;
 return boy_central_private.receive_purchase_lines(d.company_id,d.branch_id,d.id,null,'grill_pos_android',payload);
end $$;
create or replace function boy_central_private.burger_receive(raw_token text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d boy_central.pos_devices%rowtype;
begin
 select * into d from boy_central_private.pos_device_for_token(raw_token);
 if d.id is null or not exists(select 1 from boy_central.branches where id=d.branch_id and code='BURGER') then raise exception 'device access denied'; end if;
 return boy_central_private.receive_purchase_lines(d.company_id,d.branch_id,d.id,null,'burger_pos_android',payload);
end $$;
revoke all on function boy_central_private.grill_receive(text,jsonb),boy_central_private.burger_receive(text,jsonb) from public,anon,authenticated;

create or replace function boy_central.receive_purchase_receipt_lines(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare r boy_central.purchase_receipts%rowtype;
begin
 if auth.uid() is null then raise exception 'authentication required' using errcode='42501'; end if;
 select * into r from boy_central.purchase_receipts where id=(payload->>'receipt_id')::uuid;
 if r.id is null or not boy_central_private.has_branch_access(r.branch_id,array['admin','manager','staff']) then raise exception 'branch access denied' using errcode='42501'; end if;
 return boy_central_private.receive_purchase_lines(r.company_id,r.branch_id,null,auth.uid(),'boy_web',payload);
end $$;
revoke all on function boy_central.receive_purchase_receipt_lines(jsonb) from public,anon;
grant execute on function boy_central.receive_purchase_receipt_lines(jsonb) to authenticated;

create or replace function boy_central.get_branch_pending_receipts(branch_code text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype; result jsonb;
begin
 if auth.uid() is null then raise exception 'authentication required'; end if;
 select * into b from boy_central.branches where code=branch_code and active;
 if b.id is null or not boy_central_private.has_branch_access(b.id,null) then raise exception 'branch access denied'; end if;
 select coalesce(jsonb_agg(data order by created_at desc),'[]'::jsonb) into result from (
 select r.created_at,jsonb_build_object('receipt_id',r.id,'status',r.status,'created_at',r.created_at,
 'transaction_no',t.transaction_no,'transaction_date',t.transaction_date,'supplier_name',s.name,'total_amount',t.total_amount,
 'lines',(select coalesce(jsonb_agg(jsonb_build_object('line_id',l.id,'item_id',l.item_id,'item_name',i.name,
 'quantity',l.quantity_expected,'quantity_received',l.quantity_received,'unit',u.name) order by i.name,l.id),'[]'::jsonb)
 from boy_central.purchase_receipt_lines l join boy_central.items i on i.id=l.item_id left join boy_central.units u on u.id=i.base_unit_id
 where l.receipt_id=r.id and l.status<>'cancelled'),
 'checks',(select coalesce(jsonb_agg(jsonb_build_object('created_at',a.created_at,'lines',a.after_data->'lines') order by a.created_at),'[]'::jsonb)
 from boy_central.audit_log a where a.branch_id=b.id and a.entity_id=r.id::text and a.action in ('grill_receive_purchase','burger_receive_purchase','web_receive_purchase'))) data
 from boy_central.purchase_receipts r join boy_central.transactions t on t.id=r.transaction_id left join boy_central.suppliers s on s.id=t.supplier_id
 where r.branch_id=b.id and r.company_id=b.company_id and r.status in ('pending','received')
 and (r.status='pending' or r.id in (select id from boy_central.purchase_receipts where branch_id=b.id and status='received' order by received_at desc limit 30))
 ) receipts;
 return result;
end $$;
