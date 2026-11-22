-- Compare posted business values, not UI labels/cache fields. Numeric JSON
-- equality also treats 100, 100.0 and "100.00" as the same entered amount.
create function boy_central_private.daily_expense_signature(entry jsonb) returns jsonb
language sql immutable security invoker set search_path='' as $$
 select jsonb_build_object(
  'item',nullif(entry->>'item_id',''),'expense',nullif(entry->>'expense_item_id',''),
  'label',case when nullif(entry->>'item_id','') is null and nullif(entry->>'expense_item_id','') is null then trim(coalesce(entry->>'i','')) end,
  'category',coalesce(nullif(entry->>'category_id',''),trim(entry->>'m')),
  'unit',coalesce(nullif(entry->>'unit_id',''),nullif(trim(entry->>'u'),'')),
  'quantity',coalesce(nullif(entry->>'q','')::numeric,0),'amount',coalesce(nullif(entry->>'p','')::numeric,0),
  'payment',coalesce(nullif(entry->>'pay',''),'cash'),'receiving',coalesce(nullif(entry->>'receiving_mode',''),'immediate'),
  'supplier',trim(coalesce(entry->>'s','')),'note',trim(coalesce(entry->>'n','')),
  'class',coalesce(nullif(entry->>'expense_class',''),'operating'),
  'project',trim(coalesce(entry->>'project_name','')),'investment_category',coalesce(entry->>'investment_category',''))
$$;
revoke all on function boy_central_private.daily_expense_signature(jsonb) from public,anon,authenticated;

-- Existing document lock, revisions, request deduplication, permissions and mirror
-- queue stay intact. A received day may append purchases but may not replace old
-- ones. Multiset matching preserves two identical purchases as two separate rows.
do $patch$
declare definition text; needle text;
begin
 definition:=pg_get_functiondef('boy_central.post_daily_document(jsonb)'::regprocedure);
 needle:='cash numeric; transfer numeric; other numeric; mode text; role_name text;';
 if strpos(definition,needle)=0 then raise exception 'Daily declarations changed';end if;
 definition:=replace(definition,needle,needle||' posting_body jsonb; remaining jsonb; old_entry jsonb; matched_index integer; append_only boolean:=false;');
 definition:=replace(definition,'jsonb_array_elements(coalesce(body->''exp'',''[]''))','jsonb_array_elements(coalesce(posting_body->''exp'',''[]''))');
 definition:=replace(definition,'jsonb_array_elements(body->''exp'')','jsonb_array_elements(posting_body->''exp'')');
 needle:=$old$ if exists(select 1 from boy_central.purchase_receipts r join boy_central.purchase_receipt_lines l on l.receipt_id=r.id where r.transaction_id=any(d.transaction_ids) and l.quantity_received>0) and body->'exp' is distinct from d.data->'exp' then
   raise exception 'received purchase cannot be replaced; use a stock/cost adjustment';end if;$old$;
 if strpos(definition,needle)=0 then raise exception 'Received purchase guard changed';end if;
 definition:=replace(definition,needle,$new$
 posting_body:=body;
 if exists(select 1 from boy_central.purchase_receipts r join boy_central.purchase_receipt_lines l on l.receipt_id=r.id
  where r.transaction_id=any(d.transaction_ids) and l.quantity_received>0) then
  append_only:=true; ids:=d.transaction_ids; remaining:=coalesce(body->'exp','[]');
  for old_entry in select value from jsonb_array_elements(coalesce(d.data->'exp','[]')) loop
   select ordinality::integer-1 into matched_index from jsonb_array_elements(remaining) with ordinality candidate(value,ordinality)
    where boy_central_private.daily_expense_signature(value)=boy_central_private.daily_expense_signature(old_entry)
    order by ordinality limit 1;
   if matched_index is null then
    raise exception 'รายการ “%” รับสินค้าแล้ว กรุณาใช้การปรับยอดเพื่อแก้จำนวนหรือราคา',old_entry->>'i';
   end if;
   remaining:=remaining-matched_index;
  end loop;
  posting_body:=jsonb_set(body,'{exp}',remaining);
 end if;$new$);
 definition:=replace(definition,' update boy_central.transactions set status=''voided''',
  ' if not append_only then'||chr(10)||' update boy_central.transactions set status=''voided''');
 needle:=' for expense_kind in select distinct';
 if strpos(definition,needle)=0 then raise exception 'Expense class grouping changed';end if;
 definition:=replace(definition,needle,' end if;'||chr(10)||needle);
 execute definition;
end $patch$;
