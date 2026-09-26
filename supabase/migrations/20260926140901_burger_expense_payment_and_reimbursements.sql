alter table boy_central.payments drop constraint if exists payments_method_check;
alter table boy_central.payments add constraint payments_method_check
  check (method = any (array['cash','transfer','grab','thai_co_pay','credit_card','reimbursement_pending','other']));

create or replace function boy_central.record_expense_v3(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  line jsonb;
  key_value text;
  original_conversions jsonb := '{}'::jsonb;
  existing_override numeric;
  override_value numeric;
  result jsonb;
  target_transaction_id uuid;
begin
  if actor_id is null then raise exception 'authentication required'; end if;

  for line in select value from jsonb_array_elements(payload->'lines') loop
    if nullif(line->>'item_id','') is null or nullif(line->>'unit_id','') is null
       or nullif(line->>'conversion_to_base','') is null then continue; end if;
    override_value := (line->>'conversion_to_base')::numeric;
    if override_value <= 0 then raise exception 'conversion_to_base must be greater than zero'; end if;
    key_value := line->>'item_id' || '|' || line->>'unit_id';
    existing_override := nullif(original_conversions->>key_value,'')::numeric;
    if existing_override is not null then
      if (select iu.conversion_to_base from boy_central.item_units iu where iu.item_id=(line->>'item_id')::uuid and iu.unit_id=(line->>'unit_id')::uuid) <> override_value then
        raise exception 'one purchase unit cannot use different conversions in the same expense';
      end if;
      continue;
    end if;
    select iu.conversion_to_base into existing_override
    from boy_central.item_units iu
    where iu.item_id=(line->>'item_id')::uuid and iu.unit_id=(line->>'unit_id')::uuid and iu.active
    for update;
    if existing_override is null then raise exception 'purchase unit is not configured'; end if;
    original_conversions := original_conversions || jsonb_build_object(key_value, existing_override);
    update boy_central.item_units set conversion_to_base=override_value, updated_at=now()
    where item_id=(line->>'item_id')::uuid and unit_id=(line->>'unit_id')::uuid;
  end loop;

  result := boy_central.record_expense_v2(payload);

  for line in select value from jsonb_array_elements(payload->'lines') loop
    if nullif(line->>'item_id','') is null or nullif(line->>'unit_id','') is null then continue; end if;
    key_value := line->>'item_id' || '|' || line->>'unit_id';
    existing_override := nullif(original_conversions->>key_value,'')::numeric;
    if existing_override is not null then
      update boy_central.item_units set conversion_to_base=existing_override, updated_at=now()
      where item_id=(line->>'item_id')::uuid and unit_id=(line->>'unit_id')::uuid;
    end if;
  end loop;

  if result->>'status' <> 'duplicate' and coalesce(payload->'payment'->>'method','') = 'reimbursement_pending' then
    target_transaction_id := (result->>'transaction_id')::uuid;
    update boy_central.payments set status='pending', paid_at=null,
      note=coalesce(note || ' · ','') || 'รอเบิกค่าใช้จ่าย'
    where transaction_id=target_transaction_id and method='reimbursement_pending';
  end if;
  return result;
end;
$$;

create or replace function boy_central.get_burger_reimbursements()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := (select auth.uid()); target_branch_id uuid; result jsonb;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  select b.id into target_branch_id from boy_central.branches b
  where b.code='BURGER' and b.active and boy_central_private.has_branch_access(b.id,array['admin','manager','staff']) limit 1;
  if target_branch_id is null then raise exception 'branch access denied'; end if;
  select jsonb_build_object(
    'items', coalesce(jsonb_agg(jsonb_build_object(
      'transaction_id',t.id,'transaction_date',t.transaction_date,'amount',p.amount,
      'description',coalesce((select string_agg(tl.description, ', ' order by tl.line_no) from boy_central.transaction_lines tl where tl.transaction_id=t.id),'ค่าใช้จ่าย'),
      'created_by',coalesce(pr.display_name,'ผู้ใช้งาน BOY')
    ) order by t.transaction_date desc,t.created_at desc),'[]'::jsonb),
    'total',coalesce(sum(p.amount),0)
  ) into result
  from boy_central.payments p join boy_central.transactions t on t.id=p.transaction_id
  left join boy_central.profiles pr on pr.user_id=t.created_by
  where t.branch_id=target_branch_id and t.transaction_type='expense'
    and p.method='reimbursement_pending' and p.status='pending';
  return result;
end;
$$;

create or replace function boy_central.settle_burger_reimbursements(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare actor_id uuid := (select auth.uid()); target_branch_id uuid; settled_count integer; settled_total numeric;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  select b.id into target_branch_id from boy_central.branches b
  where b.code='BURGER' and b.active and boy_central_private.has_branch_access(b.id,array['admin','manager']) limit 1;
  if target_branch_id is null then raise exception 'manager access required'; end if;
  with wanted as (select value::uuid id from jsonb_array_elements_text(payload->'transaction_ids')),
  updated as (
    update boy_central.payments p set status='paid',paid_at=now(),note=coalesce(p.note || ' · ','') || 'รับเงินเบิกคืนแล้ว'
    from boy_central.transactions t,wanted w
    where p.transaction_id=t.id and t.id=w.id and t.branch_id=target_branch_id
      and p.method='reimbursement_pending' and p.status='pending'
    returning p.transaction_id,p.amount
  ) select count(*),coalesce(sum(amount),0) into settled_count,settled_total from updated;
  insert into boy_central.audit_log(company_id,branch_id,actor_user_id,action,entity_type,entity_id,source_system,after_data)
  select b.company_id,b.id,actor_id,'settle_reimbursement','transaction',value,'boy_burger_web',jsonb_build_object('status','paid')
  from boy_central.branches b,jsonb_array_elements_text(payload->'transaction_ids') where b.id=target_branch_id;
  return jsonb_build_object('status','success','settled',settled_count,'total',settled_total);
end;
$$;

revoke all on function boy_central.record_expense_v3(jsonb) from public, anon;
revoke all on function boy_central.get_burger_reimbursements() from public, anon;
revoke all on function boy_central.settle_burger_reimbursements(jsonb) from public, anon;
grant execute on function boy_central.record_expense_v3(jsonb) to authenticated;
grant execute on function boy_central.get_burger_reimbursements() to authenticated;
grant execute on function boy_central.settle_burger_reimbursements(jsonb) to authenticated;
notify pgrst, 'reload schema';
