-- Extend the already-tested receipt logic without changing GRILL authorization.
-- The same purchase_receipt_lines, balances and movements are used by web/POS.
do $clone$
declare definition text; signature text;
begin
 foreach signature in array array['grill_receipts(text)','grill_receive(text,jsonb)'] loop
  select pg_get_functiondef(('boy_central_private.'||signature)::regprocedure) into definition;
  definition:=replace(definition,'boy_central_private.grill_receipts(', 'boy_central_private.burger_receipts(');
  definition:=replace(definition,'boy_central_private.grill_receive(', 'boy_central_private.burger_receive(');
  definition:=replace(definition,'d.branch_id <> ''a05ff385-0c34-40ac-be61-7f12a0774737''::uuid',
   'not exists(select 1 from boy_central.branches where id=d.branch_id and code=''BURGER'' and active)');
  definition:=replace(definition,'grill_receive_purchase','burger_receive_purchase');
  definition:=replace(definition,'grill_pos_android','burger_pos_android');
  if position('code=''BURGER''' in definition)=0 then raise exception 'Burger branch guard not installed';end if;
  execute definition;
 end loop;
end $clone$;
revoke all on function boy_central_private.burger_receipts(text),boy_central_private.burger_receive(text,jsonb) from public,anon,authenticated;
create function public.burger_purchase_receipts(device_token text) returns jsonb language sql security definer set search_path='' as $$
 select boy_central_private.burger_receipts(device_token)
$$;
create function public.burger_receive_purchase(device_token text,payload jsonb) returns jsonb language sql security definer set search_path='' as $$
 select boy_central_private.burger_receive(device_token,payload)
$$;
revoke all on function public.burger_purchase_receipts(text),public.burger_receive_purchase(text,jsonb) from public;
grant execute on function public.burger_purchase_receipts(text),public.burger_receive_purchase(text,jsonb) to anon,authenticated;
-- Old whole-bill clients must never add partially received stock a second time.
do $guard$
declare definition text;
begin
 select pg_get_functiondef('boy_central_private.complete_purchase_receipt(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure) into definition;
 definition:=replace(definition,'  for receipt_line in select * from boy_central.purchase_receipt_lines',
  '  if exists(select 1 from boy_central.branches where id=target_branch_id and code=''BURGER'') and exists(select 1 from boy_central.purchase_receipt_lines where receipt_id=receipt_row.id and quantity_received>0 and status=''pending'') then raise exception ''Burger partial receipt must be completed in POS'';end if;'||chr(10)||'  for receipt_line in select * from boy_central.purchase_receipt_lines');
 if position('Burger partial receipt must be completed in POS' in definition)=0 then raise exception 'legacy receiver guard not installed';end if;
 execute definition;
end $guard$;
notify pgrst,'reload schema';
