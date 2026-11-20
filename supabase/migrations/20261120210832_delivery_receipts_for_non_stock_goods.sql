-- New delivery purchases include physical non-stock goods. Do not backfill old
-- transactions, and never turn a receipt check into stock tracking implicitly.
do $patch$ declare d text;needle text;
begin
 d:=pg_get_functiondef('boy_central.record_expense_v4_before_investments(jsonb)'::regprocedure);
 needle:=' return result||jsonb_build_object(''receiving_mode'',mode);';
 if strpos(d,needle)=0 then raise exception 'Receiving mode function changed';end if;
 d:=replace(d,needle,$body$ if mode='delivery' and result->>'status'<>'duplicate' then
  insert into boy_central.purchase_receipts(company_id,branch_id,transaction_id,created_by)
  select t.company_id,t.branch_id,t.id,auth.uid() from boy_central.transactions t
  where t.id=(result->>'transaction_id')::uuid and exists(select 1 from boy_central.transaction_lines l join boy_central.items i on i.id=l.item_id
   where l.transaction_id=t.id and not i.track_stock and i.item_type not in('EXPENSE_ITEM','SERVICE') and l.base_quantity>0)
  on conflict(transaction_id) do nothing;
  select id into receipt from boy_central.purchase_receipts where transaction_id=(result->>'transaction_id')::uuid;
  if receipt is not null then
   insert into boy_central.purchase_receipt_lines(company_id,branch_id,receipt_id,transaction_line_id,item_id,unit_id,quantity_expected,unit_cost_base,line_value)
   select l.company_id,t.branch_id,receipt,l.id,l.item_id,l.unit_id,l.base_quantity,coalesce(l.unit_cost_base,0),l.line_total
   from boy_central.transaction_lines l join boy_central.transactions t on t.id=l.transaction_id join boy_central.items i on i.id=l.item_id
   where t.id=(result->>'transaction_id')::uuid and not i.track_stock and i.item_type not in('EXPENSE_ITEM','SERVICE') and l.base_quantity>0
   on conflict(transaction_line_id) do nothing;
   result:=result||jsonb_build_object('pending_receipt_id',receipt,'pending_item_count',(select count(*) from boy_central.purchase_receipt_lines where receipt_id=receipt));
  end if;
 end if;
 return result||jsonb_build_object('receiving_mode',mode);$body$);execute d;

 d:=pg_get_functiondef('boy_central_private.receive_purchase_lines(uuid,uuid,uuid,uuid,text,jsonb)'::regprocedure);
 needle:='    select bi.default_location_id into location';
 if strpos(d,needle)=0 then raise exception 'Partial receiver changed';end if;
 d:=replace(d,needle,'    if (select track_stock from boy_central.items where id=l.item_id) then'||chr(10)||needle);
 d:=replace(d,'    update boy_central.purchase_receipt_lines set quantity_received=quantity_received+amount,','    end if;'||chr(10)||'    update boy_central.purchase_receipt_lines set quantity_received=quantity_received+amount,');
 d:=replace(d,'set affects_stock=true,updated_at=now()','set affects_stock=exists(select 1 from boy_central.stock_movements where transaction_id=r.transaction_id),updated_at=now()');execute d;

 d:=pg_get_functiondef('boy_central_private.complete_purchase_receipt(uuid,uuid,uuid,uuid,uuid,text)'::regprocedure);
 needle:='    select coalesce(bi.default_location_id,(';
 if strpos(d,needle)=0 then raise exception 'Whole receiver changed';end if;
 d:=replace(d,needle,'    if (select track_stock from boy_central.items where id=receipt_line.item_id) then'||chr(10)||needle);
 d:=replace(d,'    update boy_central.purchase_receipt_lines set status=''received'',','    end if;'||chr(10)||'    update boy_central.purchase_receipt_lines set status=''received'',');
 d:=replace(d,'set affects_stock=true,updated_by=actor_user_id','set affects_stock=exists(select 1 from boy_central.stock_movements where transaction_id=receipt_row.transaction_id),updated_by=actor_user_id');execute d;
end $patch$;
