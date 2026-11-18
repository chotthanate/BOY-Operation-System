-- BEGIN/ROLLBACK only. Proves the live entry path accepts 30 coconuts / 720 baht.
do $test$
declare actor uuid; i boy_central.items; u boy_central.units; c uuid; body jsonb; result jsonb;
begin
 select user_id into actor from boy_central.profiles where active and company_role='admin' limit 1;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 select * into i from boy_central.items where code='ITEM-0259';
 select * into u from boy_central.units where id=i.base_unit_id;
 select coalesce(parent_id,id) into c from boy_central.categories where id=i.category_id;
 if u.name<>'ลูก' then raise exception 'coconut base unit is not a piece';end if;
 body:=jsonb_build_object('exp',jsonb_build_array(jsonb_build_object('i',i.name,'item_id',i.id,'unit_id',u.id,'u',u.name,'q',30,'p',720,'pay','cash','category_id',c)));
 result:=boy_central.post_daily_document(jsonb_build_object('branch_code','TAWANA','business_date','2098-11-21','request_id',gen_random_uuid(),'expected_revision',0,'expected_draft_revision',0,'data',body));
 if result->>'status'<>'Success' then raise exception 'coconut purchase failed';end if;
 if not exists(select 1 from boy_central.transaction_lines l join boy_central.transactions t on t.id=l.transaction_id where t.transaction_date='2098-11-21' and l.item_id=i.id and l.quantity=30 and l.line_total=720) then raise exception 'coconut quantity or amount mismatch';end if;
end;
$test$;
select 'coconut 30 pieces / 720 baht accepted; rollback required' result;
