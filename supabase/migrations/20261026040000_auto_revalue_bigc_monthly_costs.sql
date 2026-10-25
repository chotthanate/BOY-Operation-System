-- Keep provisional BigC inter-branch costs in sync with Tawana's evolving
-- weighted monthly purchase price. A receipt may be recorded before some (or
-- all) purchases for that month, so eligible receipts must be recalculated
-- whenever a source purchase changes.

create or replace function boy_central_private.revalue_bigc_costs_for_month(
  target_company_id uuid,
  target_purchase_month date,
  target_raw_item_id uuid default null
) returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  month_start date:=date_trunc('month',target_purchase_month)::date;
  workflow_record record;
  refreshed_count integer:=0;
  failed_count integer:=0;
begin
  if target_company_id is null or target_purchase_month is null then
    return jsonb_build_object('refreshed_count',0,'failed_count',0);
  end if;

  -- A price from this month can be used by the same month or as a fallback for
  -- any of the next 12 months. Re-running the resolver is safe: it will still
  -- choose a newer eligible month when one exists.
  for workflow_record in
    select distinct a.workflow_id
    from boy_central.branch_cost_allocations a
    where a.company_id=target_company_id
      and a.allocation_type='receive'
      and a.cost_status in ('pending','provisional')
      and a.valuation_month>=month_start
      and a.valuation_month<=(month_start+interval '12 months')::date
      and (target_raw_item_id is null or a.raw_item_id=target_raw_item_id)
      -- Once a receipt has been returned against, its original valuation must
      -- remain stable so that the reversal continues to use the same cost.
      and not exists(
        select 1
        from boy_central.branch_cost_allocations reversal
        where reversal.reversal_of_allocation_id=a.id
          and reversal.cost_status='reversed'
      )
    order by a.workflow_id
  loop
    begin
      perform boy_central_private.refresh_bigc_interbranch_costs(workflow_record.workflow_id);
      refreshed_count:=refreshed_count+1;
    exception when others then
      -- A costing problem must never make the source expense impossible to
      -- save. The admin can inspect/reprocess the still-pending workflow.
      failed_count:=failed_count+1;
      raise warning 'BigC cost revaluation failed for workflow %: %',
        workflow_record.workflow_id,sqlerrm;
    end;
  end loop;

  return jsonb_build_object(
    'refreshed_count',refreshed_count,
    'failed_count',failed_count,
    'purchase_month',month_start,
    'raw_item_id',target_raw_item_id
  );
end
$function$;

revoke all on function boy_central_private.revalue_bigc_costs_for_month(uuid,date,uuid)
  from public,anon,authenticated;

create or replace function boy_central_private.revalue_bigc_costs_after_transaction_line()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  source_transaction boy_central.transactions%rowtype;
  source_item_id uuid;
begin
  if tg_op='DELETE'
    or (tg_op='UPDATE' and (
      old.transaction_id is distinct from new.transaction_id
      or old.item_id is distinct from new.item_id
    )) then
    select t.* into source_transaction
    from boy_central.transactions t
    join boy_central.branches b on b.id=t.branch_id and b.code='TAWANA'
    where t.id=old.transaction_id
      and t.transaction_type in ('expense','purchase')
      and t.status='confirmed'
      and t.affects_stock;

    source_item_id:=old.item_id;
    if source_transaction.id is not null and source_item_id is not null then
      perform boy_central_private.revalue_bigc_costs_for_month(
        source_transaction.company_id,source_transaction.transaction_date,source_item_id
      );
    end if;
  end if;

  if tg_op in ('INSERT','UPDATE') then
    source_transaction:=null;
    select t.* into source_transaction
    from boy_central.transactions t
    join boy_central.branches b on b.id=t.branch_id and b.code='TAWANA'
    where t.id=new.transaction_id
      and t.transaction_type in ('expense','purchase')
      and t.status='confirmed'
      and t.affects_stock;

    source_item_id:=new.item_id;
    if source_transaction.id is not null and source_item_id is not null then
      perform boy_central_private.revalue_bigc_costs_for_month(
        source_transaction.company_id,source_transaction.transaction_date,source_item_id
      );
    end if;
  end if;

  if tg_op='DELETE' then return old; end if;
  return new;
end
$function$;

revoke all on function boy_central_private.revalue_bigc_costs_after_transaction_line()
  from public,anon,authenticated;

drop trigger if exists revalue_bigc_costs_after_transaction_line
  on boy_central.transaction_lines;
create trigger revalue_bigc_costs_after_transaction_line
after insert or delete or update of company_id,transaction_id,item_id,quantity,unit_id,line_total
on boy_central.transaction_lines
for each row execute function boy_central_private.revalue_bigc_costs_after_transaction_line();

create or replace function boy_central_private.revalue_bigc_costs_after_transaction()
returns trigger
language plpgsql
security definer
set search_path=''
as $function$
declare
  old_is_tawana boolean:=false;
  new_is_tawana boolean:=false;
begin
  select exists(
    select 1 from boy_central.branches b
    where b.id=old.branch_id and b.code='TAWANA'
  ) into old_is_tawana;
  select exists(
    select 1 from boy_central.branches b
    where b.id=new.branch_id and b.code='TAWANA'
  ) into new_is_tawana;

  -- Revalue the old scope after the update so the price resolver sees the
  -- transaction's new state (for example voided or moved to another month).
  if old_is_tawana
    and old.transaction_type in ('expense','purchase')
    and old.status='confirmed'
    and old.affects_stock then
    perform boy_central_private.revalue_bigc_costs_for_month(
      old.company_id,old.transaction_date,null
    );
  end if;

  if new_is_tawana
    and new.transaction_type in ('expense','purchase')
    and new.status='confirmed'
    and new.affects_stock then
    perform boy_central_private.revalue_bigc_costs_for_month(
      new.company_id,new.transaction_date,null
    );
  end if;

  return new;
end
$function$;

revoke all on function boy_central_private.revalue_bigc_costs_after_transaction()
  from public,anon,authenticated;

drop trigger if exists revalue_bigc_costs_after_transaction
  on boy_central.transactions;
create trigger revalue_bigc_costs_after_transaction
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
execute function boy_central_private.revalue_bigc_costs_after_transaction();
