-- Purchased goods need monthly cost revaluation even if the central item does
-- not count stock. Existing fruit triggers only cover stock-affecting sources.
create or replace function boy_central_private.revalue_bigc_standard_costs_for_purchase(
  target_company_id uuid,
  target_purchase_date date,
  target_item_id uuid default null
) returns void
language plpgsql
security definer
set search_path=''
as $function$
declare
  target_pool_id uuid;
  workflow_record record;
begin
  if target_company_id is null or target_purchase_date is null then return; end if;
  if target_item_id is not null then
    select coalesce(i.stock_target_item_id,i.id) into target_pool_id
    from boy_central.items i where i.id=target_item_id;
  end if;
  for workflow_record in
    select distinct a.workflow_id
    from boy_central.branch_cost_allocations a
    join boy_central.bigc_workflow_lines l
      on l.workflow_id=a.workflow_id and l.line_key=a.line_key
    where a.company_id=target_company_id
      and a.allocation_type='receive' and a.cost_status in ('pending','provisional')
      and l.handling_type='standard' and l.received and l.item_id is not null
      and (target_pool_id is null or l.item_id=target_pool_id)
      and a.valuation_month>=date_trunc('month',target_purchase_date)::date
      and a.valuation_month<=(date_trunc('month',target_purchase_date)+interval '12 months')::date
      and not exists(select 1 from boy_central.branch_cost_allocations reversal
        where reversal.reversal_of_allocation_id=a.id and reversal.cost_status='reversed')
  loop
    begin
      perform boy_central_private.refresh_bigc_interbranch_costs(workflow_record.workflow_id);
    exception when others then
      -- Revaluation must not prevent the source purchase from being saved.
      raise warning 'BigC standard cost revaluation failed for workflow %: %',
        workflow_record.workflow_id,sqlerrm;
    end;
  end loop;
end
$function$;

revoke all on function boy_central_private.revalue_bigc_standard_costs_for_purchase(uuid,date,uuid)
  from public,anon,authenticated;

create or replace function boy_central_private.revalue_bigc_standard_costs_after_line()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  old_item uuid;
  new_item uuid;
  source_transaction boy_central.transactions%rowtype;
begin
  if tg_op in ('DELETE','UPDATE') then
    select t.* into source_transaction from boy_central.transactions t
    join boy_central.branches b on b.id=t.branch_id and b.code='TAWANA'
    where t.id=old.transaction_id and t.transaction_type in ('expense','purchase')
      and t.status='confirmed';
    old_item:=old.item_id;
    if old_item is null then
      select e.item_id into old_item from boy_central.expense_items e
      where e.id=old.expense_item_id;
    end if;
    if source_transaction.id is not null then
      perform boy_central_private.revalue_bigc_standard_costs_for_purchase(
        source_transaction.company_id,source_transaction.transaction_date,old_item);
    end if;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    select t.* into source_transaction from boy_central.transactions t
    join boy_central.branches b on b.id=t.branch_id and b.code='TAWANA'
    where t.id=new.transaction_id and t.transaction_type in ('expense','purchase')
      and t.status='confirmed';
    new_item:=new.item_id;
    if new_item is null then
      select e.item_id into new_item from boy_central.expense_items e
      where e.id=new.expense_item_id;
    end if;
    if source_transaction.id is not null then
      perform boy_central_private.revalue_bigc_standard_costs_for_purchase(
        source_transaction.company_id,source_transaction.transaction_date,new_item);
    end if;
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;

revoke all on function boy_central_private.revalue_bigc_standard_costs_after_line()
  from public,anon,authenticated;

create trigger revalue_bigc_standard_costs_after_line
after insert or delete or update of transaction_id,item_id,expense_item_id,quantity,unit_id,line_total
on boy_central.transaction_lines
for each row execute function boy_central_private.revalue_bigc_standard_costs_after_line();

create or replace function boy_central_private.revalue_bigc_standard_costs_after_transaction()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
begin
  if old.status='confirmed' and old.transaction_type in ('expense','purchase')
    and exists(select 1 from boy_central.branches b where b.id=old.branch_id and b.code='TAWANA') then
    perform boy_central_private.revalue_bigc_standard_costs_for_purchase(
      old.company_id,old.transaction_date,null);
  end if;
  if new.status='confirmed' and new.transaction_type in ('expense','purchase')
    and exists(select 1 from boy_central.branches b where b.id=new.branch_id and b.code='TAWANA') then
    perform boy_central_private.revalue_bigc_standard_costs_for_purchase(
      new.company_id,new.transaction_date,null);
  end if;
  return new;
end
$function$;

revoke all on function boy_central_private.revalue_bigc_standard_costs_after_transaction()
  from public,anon,authenticated;

create trigger revalue_bigc_standard_costs_after_transaction
after update of company_id,branch_id,transaction_type,transaction_date,status,affects_stock
on boy_central.transactions
for each row
when (
  old.company_id is distinct from new.company_id
  or old.branch_id is distinct from new.branch_id
  or old.transaction_type is distinct from new.transaction_type
  or old.transaction_date is distinct from new.transaction_date
  or old.status is distinct from new.status
  or old.affects_stock is distinct from new.affects_stock
)
execute function boy_central_private.revalue_bigc_standard_costs_after_transaction();
