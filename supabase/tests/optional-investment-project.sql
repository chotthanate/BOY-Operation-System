-- Run with a BOY fixture or a database containing the BigC South branch.
-- The subtransaction always rolls back; never leave a sample expense behind.
do $test$
declare
  branch uuid;
  actor uuid;
  request text := 'qa-unnamed-investment-' || gen_random_uuid()::text;
  day date := (now() at time zone 'Asia/Bangkok')::date;
  payload jsonb;
  result jsonb;
  transaction uuid;
begin
  select b.id, p.user_id into strict branch, actor
  from boy_central.branches b join boy_central.profiles p on p.company_id=b.company_id
  where b.code='BIGC-SOUTH-PATTAYA' and b.active and p.active and p.company_role='admin'
  order by p.user_id limit 1;

  begin
    perform set_config('request.jwt.claim.sub', actor::text, true);
    perform set_config('request.jwt.claims', jsonb_build_object('sub',actor,'role','authenticated')::text,true);
    payload := jsonb_build_object('branch_id',branch,'transaction_date',day,'source_system','boy_expense_entry',
      'idempotency_key',request,'receiving_mode','immediate','payment',jsonb_build_object('method','cash','amount',1),
      'lines',jsonb_build_array(jsonb_build_object('expense_class','capital','description','QA ค่าก่อสร้าง','line_total',1)));
    begin
      perform boy_central.record_expense_v4(payload);
      raise exception 'Expected missing investment category to fail';
    exception when raise_exception then
      if sqlerrm <> 'เลือกหมวดลงทุน' then raise; end if;
    end;
    payload := jsonb_set(payload,'{lines,0,investment_category}','"construction"');
    result := boy_central.record_expense_v4(payload);
    transaction := (result->>'transaction_id')::uuid;
    if not exists (
      select 1 from boy_central.transactions t join boy_central.transaction_lines l on l.transaction_id=t.id
      where t.id=transaction and t.accounting_class='capital' and l.line_total=1 and l.item_id is null
        and l.investment_details->>'category'='construction' and l.investment_details->>'project_name'=''
    ) then raise exception 'Unnamed investment was not recorded as capital'; end if;
    result := boy_central.record_expense_v4(payload);
    if result->>'status' is distinct from 'duplicate' then raise exception 'Expected a safe retry'; end if;
    raise exception using errcode='P0428',message='rollback fixture';
  exception when sqlstate 'P0428' then
    if sqlerrm <> 'rollback fixture' then raise; end if;
  end;
  if exists(select 1 from boy_central.transactions where id=transaction) then
    raise exception 'Fixture was not rolled back';
  end if;
end $test$;
