-- BigC receives goods prepared or purchased by Tawana.  This migration records
-- an internal branch allocation only; it deliberately does not create another
-- purchase/expense or touch stock, so consolidated company cost is unchanged.

alter table boy_central.bigc_workflow_lines
  add column if not exists actual_weight_kg numeric(18,6),
  add column if not exists handling_type text,
  add column if not exists costing_basis text,
  add column if not exists measurement_basis text;

alter table boy_central.bigc_workflow_lines
  drop constraint if exists bigc_workflow_lines_actual_weight_positive,
  add constraint bigc_workflow_lines_actual_weight_positive
    check (actual_weight_kg is null or actual_weight_kg > 0),
  drop constraint if exists bigc_workflow_lines_handling_type_check,
  add constraint bigc_workflow_lines_handling_type_check
    check (handling_type is null or handling_type in ('standard','whole_fruit','prepared','juiced','consignment')),
  drop constraint if exists bigc_workflow_lines_measurement_basis_check,
  add constraint bigc_workflow_lines_measurement_basis_check
    check (measurement_basis is null or measurement_basis in ('raw','estimated_raw','finished','unknown'));

comment on column boy_central.bigc_workflow_lines.actual_weight_kg is
  'Observed mass in kilograms. Quantity remains the operational unit (for example, dozens); cost must never infer kilograms from it.';
comment on column boy_central.bigc_workflow_lines.measurement_basis is
  'Whether actual_weight_kg is raw input mass or finished received mass. Unknown values remain pending.';

create table if not exists boy_central.bigc_interbranch_cost_rules (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  receiving_branch_id uuid not null references boy_central.branches(id),
  received_item_id uuid not null references boy_central.items(id),
  raw_item_id uuid not null references boy_central.items(id),
  effective_month date not null,
  active boolean not null default true,
  counted_by_piece boolean not null default false,
  note text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bigc_interbranch_cost_rules_month_start
    check (effective_month = date_trunc('month',effective_month)::date),
  unique (receiving_branch_id,received_item_id,effective_month)
);

create table if not exists boy_central.bigc_interbranch_yields (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  cost_rule_id uuid not null references boy_central.bigc_interbranch_cost_rules(id) on delete cascade,
  effective_month date not null,
  yield_ratio numeric(12,8) not null,
  source_note text,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bigc_interbranch_yields_month_start
    check (effective_month = date_trunc('month',effective_month)::date),
  constraint bigc_interbranch_yields_ratio_check
    check (yield_ratio > 0 and yield_ratio <= 1),
  unique (cost_rule_id,effective_month)
);

-- The count-to-mass rule is a costing estimate, not a stock-unit conversion.
-- Keep monthly snapshots so changing the estimate does not silently change old purchases.
create table if not exists boy_central.bigc_raw_fruit_piece_weights (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  raw_item_id uuid not null references boy_central.items(id),
  effective_month date not null,
  kg_per_piece numeric(18,6) not null check (kg_per_piece>0),
  sample_note text not null check (length(trim(sample_note))>0),
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint bigc_raw_fruit_piece_weights_month_start
    check (effective_month=date_trunc('month',effective_month)::date),
  unique(raw_item_id,effective_month)
);

create table if not exists boy_central.branch_cost_allocations (
  id uuid primary key default extensions.gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  source_branch_id uuid not null references boy_central.branches(id),
  target_branch_id uuid not null references boy_central.branches(id),
  workflow_id uuid not null references boy_central.bigc_workflows(id),
  workflow_line_id uuid references boy_central.bigc_workflow_lines(id) on delete set null,
  line_key text not null,
  allocation_type text not null check (allocation_type in ('receive','return')),
  cost_status text not null check (cost_status in ('pending','not_applicable','provisional','final','reversed','voided')),
  pending_reason text,
  received_item_id uuid references boy_central.items(id),
  raw_item_id uuid references boy_central.items(id),
  valuation_month date not null,
  measurement_basis text check (measurement_basis in ('raw','estimated_raw','finished','unknown')),
  observed_weight_kg numeric(18,6) check (observed_weight_kg is null or observed_weight_kg > 0),
  raw_equivalent_kg numeric(18,6) check (raw_equivalent_kg is null or raw_equivalent_kg > 0),
  yield_ratio numeric(12,8) check (yield_ratio is null or (yield_ratio > 0 and yield_ratio <= 1)),
  yield_source_month date,
  yield_fallback_months integer check (yield_fallback_months is null or yield_fallback_months >= 0),
  raw_unit_cost_per_kg numeric(18,6) check (raw_unit_cost_per_kg is null or raw_unit_cost_per_kg > 0),
  price_source_month date,
  price_fallback_months integer check (price_fallback_months is null or price_fallback_months >= 0),
  price_source_quantity numeric(18,6),
  price_source_value numeric(18,4),
  price_source_line_count integer,
  price_source_line_ids uuid[],
  source_branch_cost_delta numeric(18,4),
  target_branch_cost_delta numeric(18,4),
  company_cost_delta numeric(18,4) generated always as (
    coalesce(source_branch_cost_delta,0) + coalesce(target_branch_cost_delta,0)
  ) stored,
  reversal_of_allocation_id uuid references boy_central.branch_cost_allocations(id),
  reversal_fraction numeric(12,8) check (reversal_fraction is null or (reversal_fraction > 0 and reversal_fraction <= 1)),
  calculation_version integer not null default 1,
  provenance jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id),
  updated_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint branch_cost_allocations_distinct_branches check (source_branch_id <> target_branch_id),
  constraint branch_cost_allocations_company_eliminated check (company_cost_delta = 0),
  constraint branch_cost_allocations_pending_shape check (
    (cost_status='pending' and pending_reason is not null and source_branch_cost_delta is null and target_branch_cost_delta is null)
    or (cost_status='not_applicable' and pending_reason is null
      and source_branch_cost_delta is null and target_branch_cost_delta is null
      and raw_unit_cost_per_kg is null and raw_equivalent_kg is null)
    or (cost_status in ('provisional','final','reversed') and pending_reason is null
      and source_branch_cost_delta is not null and target_branch_cost_delta is not null)
    or (cost_status='voided' and pending_reason is not null)
  ),
  constraint branch_cost_allocations_receive_sign check (
    allocation_type <> 'receive' or cost_status in ('pending','not_applicable','voided') or target_branch_cost_delta > 0
  ),
  constraint branch_cost_allocations_return_sign check (
    allocation_type <> 'return' or cost_status in ('pending','not_applicable','voided') or target_branch_cost_delta < 0
  ),
  unique (workflow_id,line_key)
);

comment on table boy_central.branch_cost_allocations is
  'Internal branch reallocation ledger. Source and target deltas always net to zero company-wide; it is not a second purchase expense.';
comment on column boy_central.branch_cost_allocations.cost_status is
  'Monthly averages are provisional until a later close/revaluation process explicitly marks them final.';

create index if not exists bigc_interbranch_cost_rules_lookup_idx
  on boy_central.bigc_interbranch_cost_rules(receiving_branch_id,received_item_id,effective_month desc)
  where active;
create index if not exists bigc_interbranch_cost_rules_company_id_idx
  on boy_central.bigc_interbranch_cost_rules(company_id);
create index if not exists bigc_interbranch_cost_rules_raw_item_id_idx
  on boy_central.bigc_interbranch_cost_rules(raw_item_id);
create index if not exists bigc_interbranch_cost_rules_created_by_idx
  on boy_central.bigc_interbranch_cost_rules(created_by) where created_by is not null;
create index if not exists bigc_interbranch_cost_rules_updated_by_idx
  on boy_central.bigc_interbranch_cost_rules(updated_by) where updated_by is not null;
create index if not exists bigc_interbranch_yields_lookup_idx
  on boy_central.bigc_interbranch_yields(cost_rule_id,effective_month desc);
create index if not exists bigc_raw_fruit_piece_weights_lookup_idx
  on boy_central.bigc_raw_fruit_piece_weights(raw_item_id,effective_month desc);
create index if not exists bigc_interbranch_yields_company_id_idx
  on boy_central.bigc_interbranch_yields(company_id);
create index if not exists bigc_interbranch_yields_created_by_idx
  on boy_central.bigc_interbranch_yields(created_by) where created_by is not null;
create index if not exists bigc_interbranch_yields_updated_by_idx
  on boy_central.bigc_interbranch_yields(updated_by) where updated_by is not null;
create index if not exists branch_cost_allocations_company_month_idx
  on boy_central.branch_cost_allocations(company_id,valuation_month,cost_status);
create index if not exists branch_cost_allocations_source_branch_idx
  on boy_central.branch_cost_allocations(source_branch_id,valuation_month);
create index if not exists branch_cost_allocations_target_branch_idx
  on boy_central.branch_cost_allocations(target_branch_id,valuation_month);
create index if not exists branch_cost_allocations_reversal_idx
  on boy_central.branch_cost_allocations(reversal_of_allocation_id)
  where reversal_of_allocation_id is not null;
create index if not exists branch_cost_allocations_workflow_line_idx
  on boy_central.branch_cost_allocations(workflow_line_id)
  where workflow_line_id is not null;
create index if not exists branch_cost_allocations_received_item_id_idx
  on boy_central.branch_cost_allocations(received_item_id) where received_item_id is not null;
create index if not exists branch_cost_allocations_raw_item_id_idx
  on boy_central.branch_cost_allocations(raw_item_id) where raw_item_id is not null;
create index if not exists branch_cost_allocations_created_by_idx
  on boy_central.branch_cost_allocations(created_by) where created_by is not null;
create index if not exists branch_cost_allocations_updated_by_idx
  on boy_central.branch_cost_allocations(updated_by) where updated_by is not null;

alter table boy_central.bigc_interbranch_cost_rules enable row level security;
alter table boy_central.bigc_interbranch_yields enable row level security;
alter table boy_central.bigc_raw_fruit_piece_weights enable row level security;
alter table boy_central.branch_cost_allocations enable row level security;

drop policy if exists bigc_interbranch_cost_rules_read on boy_central.bigc_interbranch_cost_rules;
create policy bigc_interbranch_cost_rules_read on boy_central.bigc_interbranch_cost_rules
for select to authenticated
using (boy_central_private.has_branch_access(receiving_branch_id,null));

drop policy if exists bigc_interbranch_yields_read on boy_central.bigc_interbranch_yields;
create policy bigc_interbranch_yields_read on boy_central.bigc_interbranch_yields
for select to authenticated
using (exists (
  select 1 from boy_central.bigc_interbranch_cost_rules r
  where r.id=cost_rule_id and boy_central_private.has_branch_access(r.receiving_branch_id,null)
));

drop policy if exists bigc_raw_fruit_piece_weights_read on boy_central.bigc_raw_fruit_piece_weights;
create policy bigc_raw_fruit_piece_weights_read on boy_central.bigc_raw_fruit_piece_weights
for select to authenticated
using (exists (
  select 1 from boy_central.profiles p
  where p.user_id=auth.uid() and p.company_id=bigc_raw_fruit_piece_weights.company_id and p.active
));

drop policy if exists branch_cost_allocations_read on boy_central.branch_cost_allocations;
create policy branch_cost_allocations_read on boy_central.branch_cost_allocations
for select to authenticated
using (
  boy_central_private.has_branch_access(source_branch_id,null)
  or boy_central_private.has_branch_access(target_branch_id,null)
);

revoke all on boy_central.bigc_interbranch_cost_rules from public,anon,authenticated;
revoke all on boy_central.bigc_interbranch_yields from public,anon,authenticated;
revoke all on boy_central.bigc_raw_fruit_piece_weights from public,anon,authenticated;
revoke all on boy_central.branch_cost_allocations from public,anon,authenticated;
grant select on boy_central.bigc_interbranch_cost_rules to authenticated;
grant select on boy_central.bigc_interbranch_yields to authenticated;
grant select on boy_central.bigc_raw_fruit_piece_weights to authenticated;
grant select on boy_central.branch_cost_allocations to authenticated;
grant select,insert,update,delete on boy_central.bigc_interbranch_cost_rules to service_role;
grant select,insert,update,delete on boy_central.bigc_interbranch_yields to service_role;
grant select,insert,update,delete on boy_central.bigc_raw_fruit_piece_weights to service_role;
grant select,insert,update,delete on boy_central.branch_cost_allocations to service_role;

create or replace function boy_central_private.resolve_bigc_piece_weight(
  target_company_id uuid,target_raw_item_id uuid,target_date date
) returns table(kg_per_piece numeric,weight_id uuid,source_month date)
language sql stable security definer set search_path=''
as $function$
  select w.kg_per_piece,w.id,w.effective_month
  from boy_central.bigc_raw_fruit_piece_weights w
  where w.company_id=target_company_id and w.raw_item_id=target_raw_item_id
    and w.effective_month<=date_trunc('month',target_date)::date
  order by w.effective_month desc
  limit 1
$function$;
revoke all on function boy_central_private.resolve_bigc_piece_weight(uuid,uuid,date)
  from public,anon,authenticated;

create or replace function boy_central_private.resolve_tawana_monthly_raw_price(
  target_company_id uuid,
  target_raw_item_id uuid,
  target_month date,
  max_lookback_months integer default 12
) returns table(
  unit_cost numeric,
  source_month date,
  fallback_months integer,
  source_quantity numeric,
  source_value numeric,
  source_line_count integer,
  source_line_ids uuid[],
  source_branch_id uuid,
  estimated_line_count integer,
  piece_weight_ids uuid[]
)
language sql
stable
security definer
set search_path=''
as $function$
  with candidate_months as (
    select n,
      (date_trunc('month',target_month)::date-(n::text||' months')::interval)::date as month_start
    from generate_series(0,greatest(coalesce(max_lookback_months,0),0)) as g(n)
  ), purchase_lines as (
    select cm.n,cm.month_start,t.branch_id,tl.id,tl.line_total,
      case
        when coalesce(purchase_unit.code,base_unit.code)='UNIT-011' and tl.quantity>0
          then tl.quantity
        when coalesce(purchase_unit.code,base_unit.code)='UNIT-013'
          and tl.quantity>0 and piece.kg_per_piece>0
          then tl.quantity*piece.kg_per_piece
        else null
      end as raw_kg,
      coalesce(purchase_unit.code,base_unit.code)='UNIT-013' as estimated_from_piece,
      piece.weight_id
    from candidate_months cm
    join boy_central.branches b on b.company_id=target_company_id and b.code='TAWANA' and b.active
    join boy_central.items raw_item on raw_item.id=target_raw_item_id
      and raw_item.company_id=target_company_id and raw_item.active
    join boy_central.units base_unit on base_unit.id=raw_item.base_unit_id
    join boy_central.transactions t on t.branch_id=b.id and t.company_id=target_company_id
      and t.status='confirmed' and t.affects_stock
      and t.transaction_type in ('expense','purchase')
      and t.transaction_date>=cm.month_start
      and t.transaction_date<(cm.month_start+interval '1 month')
    join boy_central.transaction_lines tl on tl.transaction_id=t.id
      and tl.company_id=target_company_id and tl.item_id=target_raw_item_id
      and tl.line_total>0
    left join boy_central.units purchase_unit on purchase_unit.id=tl.unit_id
    left join lateral boy_central_private.resolve_bigc_piece_weight(
      target_company_id,target_raw_item_id,t.transaction_date
    ) piece on true
  ), monthly_purchase as (
    select cm.n,cm.month_start,t.branch_id,
      sum(t.raw_kg)::numeric as total_quantity,
      sum(t.line_total)::numeric as total_value,
      count(*)::integer as line_count,
      array_agg(t.id order by t.id) as line_ids,
      bool_and(t.raw_kg is not null and t.raw_kg>0) as complete_mass,
      count(*) filter (where t.estimated_from_piece)::integer as estimated_count,
      array_agg(distinct t.weight_id) filter (where t.weight_id is not null) as weight_ids
    from candidate_months cm
    join purchase_lines t on t.n=cm.n and t.month_start=cm.month_start
    group by cm.n,cm.month_start,t.branch_id
  )
  select case when complete_mass and total_quantity>0 then total_value/total_quantity end,
    month_start,n,total_quantity,total_value,line_count,line_ids,branch_id,estimated_count,weight_ids
  from monthly_purchase
  order by n
  limit 1
$function$;

create or replace function boy_central_private.resolve_bigc_yield(
  target_rule_id uuid,
  target_month date,
  max_lookback_months integer default 12
) returns table(
  yield_ratio numeric,
  source_month date,
  fallback_months integer,
  yield_id uuid
)
language sql
stable
security definer
set search_path=''
as $function$
  select y.yield_ratio,y.effective_month,
    ((extract(year from age(date_trunc('month',target_month),y.effective_month))*12)
      +extract(month from age(date_trunc('month',target_month),y.effective_month)))::integer,
    y.id
  from boy_central.bigc_interbranch_yields y
  join boy_central.bigc_interbranch_cost_rules source_rule on source_rule.id=y.cost_rule_id
  join boy_central.bigc_interbranch_cost_rules target_rule on target_rule.id=target_rule_id
    and target_rule.company_id=source_rule.company_id
    and target_rule.receiving_branch_id=source_rule.receiving_branch_id
    and target_rule.received_item_id=source_rule.received_item_id
    and target_rule.raw_item_id=source_rule.raw_item_id
  where source_rule.active
    and y.effective_month<=date_trunc('month',target_month)::date
    and y.effective_month>=(date_trunc('month',target_month)::date
      -(greatest(coalesce(max_lookback_months,0),0)::text||' months')::interval)::date
  order by y.effective_month desc
  limit 1
$function$;

revoke all on function boy_central_private.resolve_tawana_monthly_raw_price(uuid,uuid,date,integer)
  from public,anon,authenticated;
revoke all on function boy_central_private.resolve_bigc_yield(uuid,date,integer)
  from public,anon,authenticated;

create or replace function boy_central_private.refresh_bigc_interbranch_costs(target_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  workflow_row boy_central.bigc_workflows%rowtype;
  line_row boy_central.bigc_workflow_lines%rowtype;
  rule_row boy_central.bigc_interbranch_cost_rules%rowtype;
  existing_row boy_central.branch_cost_allocations%rowtype;
  source_allocation boy_central.branch_cost_allocations%rowtype;
  source_line boy_central.bigc_workflow_lines%rowtype;
  tawana_branch_id uuid;
  target_month date;
  basis_value text;
  pending_value text;
  status_value text;
  raw_equivalent_value numeric(18,6);
  yield_value numeric(12,8);
  yield_month_value date;
  yield_fallback_value integer;
  yield_id_value uuid;
  unit_cost_value numeric(18,6);
  price_month_value date;
  price_fallback_value integer;
  price_quantity_value numeric(18,6);
  price_value_value numeric(18,4);
  price_line_count_value integer;
  price_line_ids_value uuid[];
  price_branch_value uuid;
  price_estimated_line_count integer;
  price_piece_weight_ids uuid[];
  piece_kg_value numeric(18,6);
  piece_weight_id uuid;
  piece_weight_month date;
  target_delta_value numeric(18,4);
  source_delta_value numeric(18,4);
  reversal_fraction_value numeric(12,8);
  already_reversed_fraction numeric(12,8);
  provenance_value jsonb;
  pending_count integer:=0;
  posted_count integer:=0;
  not_applicable_count integer:=0;
begin
  perform pg_advisory_xact_lock(hashtextextended('boy_central.bigc_cost:'||target_workflow_id::text,0));

  select * into workflow_row
  from boy_central.bigc_workflows
  where id=target_workflow_id
  for update;
  if workflow_row.id is null then raise exception 'BigC workflow not found'; end if;
  if workflow_row.workflow_type not in ('receive','return') then
    return jsonb_build_object('status','not_applicable','workflow_id',workflow_row.id);
  end if;

  select b.id into tawana_branch_id
  from boy_central.branches b
  where b.company_id=workflow_row.company_id and b.code='TAWANA' and b.active;
  if tawana_branch_id is null then raise exception 'active Tawana branch not found'; end if;
  target_month:=date_trunc('month',workflow_row.business_date)::date;

  for existing_row in
    select a.* from boy_central.branch_cost_allocations a
    where a.workflow_id=workflow_row.id and a.cost_status<>'voided'
      and not exists (
        select 1 from boy_central.bigc_workflow_lines l
        where l.workflow_id=workflow_row.id and l.line_key=a.line_key
      )
    for update
  loop
    if exists(select 1 from boy_central.branch_cost_allocations r
      where r.reversal_of_allocation_id=existing_row.id and r.cost_status='reversed') then
      raise exception 'cannot remove a received line after its cost has been reversed: %',existing_row.line_key;
    end if;
    update boy_central.branch_cost_allocations
    set cost_status='voided',pending_reason='source_line_removed',workflow_line_id=null,
      updated_by=workflow_row.submitted_by,updated_at=now()
    where id=existing_row.id;
  end loop;

  for line_row in
    select * from boy_central.bigc_workflow_lines
    where workflow_id=workflow_row.id
    order by sort_order,id
    for update
  loop
    basis_value:=coalesce(line_row.measurement_basis,'unknown');
    pending_value:=null;
    status_value:='pending';
    raw_equivalent_value:=null;
    yield_value:=null;
    yield_month_value:=null;
    yield_fallback_value:=null;
    yield_id_value:=null;
    unit_cost_value:=null;
    price_month_value:=null;
    price_fallback_value:=null;
    price_quantity_value:=null;
    price_value_value:=null;
    price_line_count_value:=null;
    price_line_ids_value:=null;
    price_branch_value:=null;
    price_estimated_line_count:=null;
    price_piece_weight_ids:=null;
    piece_kg_value:=null;
    piece_weight_id:=null;
    piece_weight_month:=null;
    target_delta_value:=null;
    source_delta_value:=null;
    reversal_fraction_value:=null;
    provenance_value:=jsonb_build_object(
      'calculation_version',1,
      'workflow_revision',workflow_row.revision,
      'quantity_is_operational_only',true
    );

    if workflow_row.workflow_type='receive' then
      rule_row:=null;
      if not line_row.received then
        status_value:='not_applicable';
        not_applicable_count:=not_applicable_count+1;
        provenance_value:=provenance_value||jsonb_build_object(
          'not_applicable_reason','line_not_received'
        );
      elsif line_row.handling_type='consignment' then
        status_value:='not_applicable';
        not_applicable_count:=not_applicable_count+1;
        provenance_value:=provenance_value||jsonb_build_object(
          'not_applicable_reason','consignment_item_excluded_from_interbranch_costing'
        );
      else
        if line_row.item_id is null then
          pending_value:='missing_received_item_id';
        else
          select * into rule_row
          from boy_central.bigc_interbranch_cost_rules r
          where r.company_id=workflow_row.company_id
            and r.receiving_branch_id=workflow_row.branch_id
            and r.received_item_id=line_row.item_id
            and r.effective_month<=target_month and r.active
          order by r.effective_month desc,r.created_at desc
          limit 1;
          if rule_row.id is null then
            pending_value:='missing_cost_rule';
          else
            provenance_value:=provenance_value||jsonb_build_object(
              'cost_rule_id',rule_row.id,
              'cost_rule_effective_month',rule_row.effective_month,
              'received_item_id',rule_row.received_item_id,
              'raw_item_id',rule_row.raw_item_id
            );
          end if;
        end if;

        if pending_value is null and basis_value not in ('raw','estimated_raw','finished') then
          pending_value:='missing_measurement_basis';
        end if;
        if pending_value is null and basis_value in ('raw','finished') and line_row.actual_weight_kg is null then
          pending_value:='missing_observed_weight_kg';
        end if;
        if pending_value is null and basis_value='estimated_raw' then
          if not rule_row.counted_by_piece or line_row.handling_type<>'whole_fruit'
            or line_row.input_mode<>'quantity'
            or line_row.quantity<=0 or line_row.quantity<>trunc(line_row.quantity) then
            pending_value:='invalid_fruit_piece_quantity';
          else
            select p.kg_per_piece,p.weight_id,p.source_month
            into piece_kg_value,piece_weight_id,piece_weight_month
            from boy_central_private.resolve_bigc_piece_weight(
              workflow_row.company_id,rule_row.raw_item_id,workflow_row.business_date
            ) p;
            if piece_kg_value is null then pending_value:='missing_piece_weight_estimate'; end if;
          end if;
        end if;

        if pending_value is null then
          select p.unit_cost,p.source_month,p.fallback_months,p.source_quantity,p.source_value,
            p.source_line_count,p.source_line_ids,p.source_branch_id,p.estimated_line_count,p.piece_weight_ids
          into unit_cost_value,price_month_value,price_fallback_value,price_quantity_value,
            price_value_value,price_line_count_value,price_line_ids_value,price_branch_value,
            price_estimated_line_count,price_piece_weight_ids
          from boy_central_private.resolve_tawana_monthly_raw_price(
            workflow_row.company_id,rule_row.raw_item_id,target_month,12
          ) p;
          if unit_cost_value is null then pending_value:='missing_tawana_monthly_price_in_kg'; end if;
        end if;

        if pending_value is null and basis_value='finished' then
          select y.yield_ratio,y.source_month,y.fallback_months,y.yield_id
          into yield_value,yield_month_value,yield_fallback_value,yield_id_value
          from boy_central_private.resolve_bigc_yield(rule_row.id,target_month,12) y;
          if yield_value is null then pending_value:='missing_yield_ratio'; end if;
        end if;

        if pending_value is null then
          raw_equivalent_value:=case
            when basis_value='raw' then line_row.actual_weight_kg
            when basis_value='estimated_raw' then line_row.quantity*piece_kg_value
            else line_row.actual_weight_kg/yield_value end;
          raw_equivalent_value:=round(raw_equivalent_value,6);
          target_delta_value:=round(raw_equivalent_value*unit_cost_value,4);
          if target_delta_value<=0 then
            pending_value:='non_positive_calculated_cost';
            raw_equivalent_value:=null;
            target_delta_value:=null;
          else
            source_delta_value:=-target_delta_value;
            status_value:='provisional';
            provenance_value:=provenance_value||jsonb_build_object(
              'price_method','tawana_weighted_monthly_purchase_kg',
              'price_is_provisional',true,
              'price_source_branch_id',price_branch_value,
              'price_source_line_count',price_line_count_value,
              'price_source_line_ids',to_jsonb(price_line_ids_value),
              'price_estimated_purchase_line_count',price_estimated_line_count,
              'price_piece_weight_ids',to_jsonb(price_piece_weight_ids),
              'received_piece_weight_id',piece_weight_id,
              'received_piece_weight_month',piece_weight_month,
              'received_estimated_kg_per_piece',piece_kg_value,
              'yield_id',yield_id_value
            );
          end if;
        end if;

        if pending_value is not null then
          status_value:='pending';
          pending_count:=pending_count+1;
          provenance_value:=provenance_value||jsonb_build_object('pending_reason',pending_value);
        else posted_count:=posted_count+1; end if;
      end if;

      select * into existing_row from boy_central.branch_cost_allocations
      where workflow_id=workflow_row.id and line_key=line_row.line_key for update;
      if existing_row.id is not null
        and exists(select 1 from boy_central.branch_cost_allocations r
          where r.reversal_of_allocation_id=existing_row.id and r.cost_status='reversed')
        and (existing_row.target_branch_cost_delta is distinct from target_delta_value
          or existing_row.raw_equivalent_kg is distinct from raw_equivalent_value) then
        raise exception 'cannot revalue a received line after its cost has been reversed: %',line_row.line_key;
      end if;

      insert into boy_central.branch_cost_allocations(
        company_id,source_branch_id,target_branch_id,workflow_id,workflow_line_id,line_key,
        allocation_type,cost_status,pending_reason,received_item_id,raw_item_id,valuation_month,
        measurement_basis,observed_weight_kg,raw_equivalent_kg,yield_ratio,yield_source_month,
        yield_fallback_months,raw_unit_cost_per_kg,price_source_month,price_fallback_months,
        price_source_quantity,price_source_value,price_source_line_count,
        price_source_line_ids,
        source_branch_cost_delta,target_branch_cost_delta,calculation_version,provenance,
        created_by,updated_by
      ) values(
        workflow_row.company_id,tawana_branch_id,workflow_row.branch_id,workflow_row.id,line_row.id,line_row.line_key,
        'receive',status_value,pending_value,line_row.item_id,rule_row.raw_item_id,target_month,
        basis_value,line_row.actual_weight_kg,raw_equivalent_value,yield_value,yield_month_value,
        yield_fallback_value,unit_cost_value,price_month_value,price_fallback_value,
        price_quantity_value,price_value_value,price_line_count_value,
        price_line_ids_value,
        source_delta_value,target_delta_value,1,provenance_value,
        workflow_row.submitted_by,workflow_row.submitted_by
      ) on conflict(workflow_id,line_key) do update set
        workflow_line_id=excluded.workflow_line_id,allocation_type=excluded.allocation_type,
        cost_status=excluded.cost_status,pending_reason=excluded.pending_reason,
        received_item_id=excluded.received_item_id,raw_item_id=excluded.raw_item_id,
        valuation_month=excluded.valuation_month,measurement_basis=excluded.measurement_basis,
        observed_weight_kg=excluded.observed_weight_kg,raw_equivalent_kg=excluded.raw_equivalent_kg,
        yield_ratio=excluded.yield_ratio,yield_source_month=excluded.yield_source_month,
        yield_fallback_months=excluded.yield_fallback_months,raw_unit_cost_per_kg=excluded.raw_unit_cost_per_kg,
        price_source_month=excluded.price_source_month,price_fallback_months=excluded.price_fallback_months,
        price_source_quantity=excluded.price_source_quantity,price_source_value=excluded.price_source_value,
        price_source_line_count=excluded.price_source_line_count,
        price_source_line_ids=excluded.price_source_line_ids,
        source_branch_cost_delta=excluded.source_branch_cost_delta,
        target_branch_cost_delta=excluded.target_branch_cost_delta,
        reversal_of_allocation_id=null,reversal_fraction=null,provenance=excluded.provenance,
        updated_by=excluded.updated_by,updated_at=now();

    else
      source_allocation:=null;
      source_line:=null;
      if not line_row.received then
        status_value:='not_applicable';
        not_applicable_count:=not_applicable_count+1;
        provenance_value:=provenance_value||jsonb_build_object(
          'not_applicable_reason','line_not_returned'
        );
      elsif line_row.handling_type='consignment' then
        status_value:='not_applicable';
        not_applicable_count:=not_applicable_count+1;
        provenance_value:=provenance_value||jsonb_build_object(
          'not_applicable_reason','consignment_item_excluded_from_interbranch_costing'
        );
      else
        if workflow_row.source_workflow_id is null then
          pending_value:='missing_source_workflow';
        else
          select a.* into source_allocation
          from boy_central.branch_cost_allocations a
          join boy_central.bigc_workflows sw on sw.id=a.workflow_id and sw.workflow_type='receive'
          where a.workflow_id=workflow_row.source_workflow_id
            and a.line_key=coalesce(line_row.source_line_key,line_row.line_key)
            and a.allocation_type='receive' and a.cost_status in ('provisional','final')
          for update;
          if source_allocation.id is null then pending_value:='missing_source_allocation'; end if;
        end if;

        if pending_value is null then
          select * into source_line from boy_central.bigc_workflow_lines
          where workflow_id=source_allocation.workflow_id and line_key=source_allocation.line_key;
          if line_row.actual_weight_kg is not null and source_allocation.observed_weight_kg is not null then
            reversal_fraction_value:=line_row.actual_weight_kg/source_allocation.observed_weight_kg;
          elsif source_allocation.measurement_basis='estimated_raw'
            and source_line.quantity>0 and line_row.quantity>0
            and line_row.quantity=trunc(line_row.quantity) then
            reversal_fraction_value:=line_row.quantity/source_line.quantity;
          elsif source_line.id is not null and line_row.quantity>0 and line_row.quantity=source_line.quantity then
            reversal_fraction_value:=1;
          else pending_value:='missing_return_weight_or_full_quantity_match'; end if;
        end if;

        if pending_value is null then
          select coalesce(sum(a.reversal_fraction),0) into already_reversed_fraction
          from boy_central.branch_cost_allocations a
          where a.reversal_of_allocation_id=source_allocation.id
            and a.cost_status='reversed'
            and not (a.workflow_id=workflow_row.id and a.line_key=line_row.line_key);
          if reversal_fraction_value<=0
            or reversal_fraction_value+already_reversed_fraction>1.00000001 then
            pending_value:='return_exceeds_original_allocation';
          end if;
        end if;

        if pending_value is null then
          basis_value:=source_allocation.measurement_basis;
          raw_equivalent_value:=round(source_allocation.raw_equivalent_kg*reversal_fraction_value,6);
          yield_value:=source_allocation.yield_ratio;
          yield_month_value:=source_allocation.yield_source_month;
          yield_fallback_value:=source_allocation.yield_fallback_months;
          unit_cost_value:=source_allocation.raw_unit_cost_per_kg;
          price_month_value:=source_allocation.price_source_month;
          price_fallback_value:=source_allocation.price_fallback_months;
          price_quantity_value:=source_allocation.price_source_quantity;
          price_value_value:=source_allocation.price_source_value;
          price_line_count_value:=source_allocation.price_source_line_count;
          price_line_ids_value:=source_allocation.price_source_line_ids;
          target_delta_value:=-round(source_allocation.target_branch_cost_delta*reversal_fraction_value,4);
          source_delta_value:=-target_delta_value;
          status_value:='reversed';
          posted_count:=posted_count+1;
          provenance_value:=provenance_value||jsonb_build_object(
            'reversal_uses_original_cost',true,
            'reversal_of_allocation_id',source_allocation.id,
            'source_cost_status',source_allocation.cost_status
          );
        else
          status_value:='pending';
          pending_count:=pending_count+1;
          provenance_value:=provenance_value||jsonb_build_object('pending_reason',pending_value);
        end if;
      end if;

      insert into boy_central.branch_cost_allocations(
        company_id,source_branch_id,target_branch_id,workflow_id,workflow_line_id,line_key,
        allocation_type,cost_status,pending_reason,received_item_id,raw_item_id,valuation_month,
        measurement_basis,observed_weight_kg,raw_equivalent_kg,yield_ratio,yield_source_month,
        yield_fallback_months,raw_unit_cost_per_kg,price_source_month,price_fallback_months,
        price_source_quantity,price_source_value,price_source_line_count,
        price_source_line_ids,
        source_branch_cost_delta,target_branch_cost_delta,reversal_of_allocation_id,
        reversal_fraction,calculation_version,provenance,created_by,updated_by
      ) values(
        workflow_row.company_id,tawana_branch_id,workflow_row.branch_id,workflow_row.id,line_row.id,line_row.line_key,
        'return',status_value,pending_value,line_row.item_id,source_allocation.raw_item_id,target_month,
        basis_value,line_row.actual_weight_kg,raw_equivalent_value,yield_value,yield_month_value,
        yield_fallback_value,unit_cost_value,price_month_value,price_fallback_value,
        price_quantity_value,price_value_value,price_line_count_value,
        price_line_ids_value,
        source_delta_value,target_delta_value,source_allocation.id,reversal_fraction_value,
        1,provenance_value,workflow_row.submitted_by,workflow_row.submitted_by
      ) on conflict(workflow_id,line_key) do update set
        workflow_line_id=excluded.workflow_line_id,allocation_type=excluded.allocation_type,
        cost_status=excluded.cost_status,pending_reason=excluded.pending_reason,
        received_item_id=excluded.received_item_id,raw_item_id=excluded.raw_item_id,
        valuation_month=excluded.valuation_month,measurement_basis=excluded.measurement_basis,
        observed_weight_kg=excluded.observed_weight_kg,raw_equivalent_kg=excluded.raw_equivalent_kg,
        yield_ratio=excluded.yield_ratio,yield_source_month=excluded.yield_source_month,
        yield_fallback_months=excluded.yield_fallback_months,raw_unit_cost_per_kg=excluded.raw_unit_cost_per_kg,
        price_source_month=excluded.price_source_month,price_fallback_months=excluded.price_fallback_months,
        price_source_quantity=excluded.price_source_quantity,price_source_value=excluded.price_source_value,
        price_source_line_count=excluded.price_source_line_count,
        price_source_line_ids=excluded.price_source_line_ids,
        source_branch_cost_delta=excluded.source_branch_cost_delta,
        target_branch_cost_delta=excluded.target_branch_cost_delta,
        reversal_of_allocation_id=excluded.reversal_of_allocation_id,
        reversal_fraction=excluded.reversal_fraction,provenance=excluded.provenance,
        updated_by=excluded.updated_by,updated_at=now();
    end if;

    update boy_central.bigc_workflow_lines
    set estimated_unit_cost=null,estimated_value=target_delta_value
    where id=line_row.id;
  end loop;

  return jsonb_build_object(
    'status',case
      when pending_count>0 then 'pending'
      when posted_count=0 and not_applicable_count>0 then 'not_applicable'
      else 'calculated'
    end,
    'workflow_id',workflow_row.id,
    'posted_count',posted_count,
    'pending_count',pending_count,
    'not_applicable_count',not_applicable_count,
    'company_cost_delta',0
  );
end
$function$;

revoke all on function boy_central_private.refresh_bigc_interbranch_costs(uuid)
  from public,anon,authenticated;

create or replace function boy_central.admin_save_bigc_interbranch_cost_rule(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid();
  actor_company uuid;
  target_branch boy_central.branches%rowtype;
  received_item boy_central.items%rowtype;
  raw_item boy_central.items%rowtype;
  target_month date;
  target_rule_id uuid;
  target_yield numeric(12,8);
  target_counted_by_piece boolean;
begin
  select p.company_id into actor_company from boy_central.profiles p
  where p.user_id=actor_id and p.active and p.company_role='admin';
  if actor_company is null then raise exception 'admin access required'; end if;
  select * into target_branch from boy_central.branches
  where company_id=actor_company and code=coalesce(nullif(payload->>'branch_code',''),'BIGC-CENTRAL-PATTAYA') and active;
  if target_branch.id is null then raise exception 'active receiving branch not found'; end if;
  select * into received_item from boy_central.items
  where id=nullif(payload->>'received_item_id','')::uuid and company_id=actor_company and active;
  select * into raw_item from boy_central.items
  where id=nullif(payload->>'raw_item_id','')::uuid and company_id=actor_company and active;
  if received_item.id is null then raise exception 'active received item not found'; end if;
  if raw_item.id is null then raise exception 'active raw item not found'; end if;
  if not exists(
    select 1 from boy_central.units u
    where u.id=raw_item.base_unit_id and u.company_id=actor_company and u.active
      and u.code in ('UNIT-011','UNIT-013')
  ) then raise exception 'raw fruit base unit must be kilograms or pieces'; end if;
  target_month:=date_trunc('month',coalesce(nullif(payload->>'effective_month','')::date,current_date))::date;
  target_yield:=nullif(payload->>'yield_ratio','')::numeric;
  target_counted_by_piece:=coalesce(nullif(payload->>'counted_by_piece','')::boolean,false);
  if target_yield is not null and (target_yield<=0 or target_yield>1) then raise exception 'yield_ratio must be greater than 0 and at most 1'; end if;

  insert into boy_central.bigc_interbranch_cost_rules(
    company_id,receiving_branch_id,received_item_id,raw_item_id,effective_month,active,counted_by_piece,note,created_by,updated_by
  ) values(
    actor_company,target_branch.id,received_item.id,raw_item.id,target_month,
    coalesce(nullif(payload->>'active','')::boolean,true),target_counted_by_piece,nullif(trim(payload->>'note'),''),actor_id,actor_id
  ) on conflict(receiving_branch_id,received_item_id,effective_month) do update set
    raw_item_id=excluded.raw_item_id,active=excluded.active,
    counted_by_piece=excluded.counted_by_piece,note=excluded.note,updated_by=actor_id,updated_at=now()
  returning id into target_rule_id;

  if target_yield is not null then
    insert into boy_central.bigc_interbranch_yields(
      company_id,cost_rule_id,effective_month,yield_ratio,source_note,created_by,updated_by
    ) values(
      actor_company,target_rule_id,target_month,target_yield,nullif(trim(payload->>'yield_source_note'),''),actor_id,actor_id
    ) on conflict(cost_rule_id,effective_month) do update set
      yield_ratio=excluded.yield_ratio,source_note=excluded.source_note,updated_by=actor_id,updated_at=now();
  end if;
  return jsonb_build_object('status','saved','rule_id',target_rule_id,'effective_month',target_month,'yield_ratio',target_yield);
end
$function$;

create or replace function boy_central.admin_save_bigc_piece_weight(payload jsonb)
returns jsonb
language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid();
  actor_company uuid;
  raw_item uuid:=nullif(payload->>'raw_item_id','')::uuid;
  target_month date:=date_trunc('month',coalesce(nullif(payload->>'effective_month','')::date,current_date))::date;
  target_kg numeric:=nullif(payload->>'kg_per_piece','')::numeric;
  source_note text:=nullif(trim(payload->>'sample_note'),'');
  target_id uuid;
  affected_count integer;
begin
  select p.company_id into actor_company from boy_central.profiles p
  where p.user_id=actor_id and p.active and p.company_role='admin';
  if actor_company is null then raise exception 'admin access required'; end if;
  if raw_item is null or not exists(
    select 1 from boy_central.items i where i.id=raw_item and i.company_id=actor_company and i.active
  ) then raise exception 'active raw item required'; end if;
  if target_kg is null or target_kg<=0 or source_note is null then
    raise exception 'positive kg_per_piece and sample_note required';
  end if;
  if exists(
    select 1 from boy_central.branch_cost_allocations a
    where a.company_id=actor_company and a.raw_item_id=raw_item
      and a.valuation_month>=target_month and a.cost_status='final'
  ) then raise exception 'cannot change a piece estimate used by finalized allocations'; end if;
  insert into boy_central.bigc_raw_fruit_piece_weights(
    company_id,raw_item_id,effective_month,kg_per_piece,sample_note,created_by,updated_by
  ) values(actor_company,raw_item,target_month,target_kg,source_note,actor_id,actor_id)
  on conflict(raw_item_id,effective_month) do update set
    kg_per_piece=excluded.kg_per_piece,sample_note=excluded.sample_note,
    updated_by=actor_id,updated_at=now()
  returning id into target_id;
  select count(distinct a.workflow_id) into affected_count
  from boy_central.branch_cost_allocations a
  where a.company_id=actor_company and a.raw_item_id=raw_item
    and a.valuation_month>=target_month and a.cost_status='provisional';
  return jsonb_build_object('status','saved','weight_id',target_id,
    'effective_month',target_month,'kg_per_piece',target_kg,
    'workflows_requiring_reprocess',affected_count);
end
$function$;

create or replace function boy_central.get_bigc_piece_weight_settings()
returns jsonb
language plpgsql stable security definer set search_path=''
as $function$
declare
  actor_company uuid;
  result jsonb;
begin
  select p.company_id into actor_company from boy_central.profiles p
  where p.user_id=auth.uid() and p.active and p.company_role='admin';
  if actor_company is null then raise exception 'admin access required'; end if;
  select jsonb_build_object(
    'items',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'code',i.code)
      order by i.name) from boy_central.items i
      where i.company_id=actor_company and i.active
        and (i.name like '%แตงโม%' or i.name like '%สับปะรด%')),'[]'::jsonb),
    'weights',coalesce((select jsonb_agg(jsonb_build_object(
      'raw_item_id',w.raw_item_id,'effective_month',w.effective_month,
      'kg_per_piece',w.kg_per_piece,'sample_note',w.sample_note)
      order by w.effective_month desc) from boy_central.bigc_raw_fruit_piece_weights w
      where w.company_id=actor_company),'[]'::jsonb)
  ) into result;
  return result;
end
$function$;

create or replace function boy_central.reprocess_bigc_interbranch_costs(target_workflow_id uuid)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare workflow_row boy_central.bigc_workflows%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into workflow_row from boy_central.bigc_workflows where id=target_workflow_id;
  if workflow_row.id is null
    or not boy_central_private.has_branch_access(workflow_row.branch_id,array['admin','manager']) then
    raise exception 'manager access required';
  end if;
  return boy_central_private.refresh_bigc_interbranch_costs(target_workflow_id);
end
$function$;

revoke all on function boy_central.admin_save_bigc_interbranch_cost_rule(jsonb) from public,anon;
revoke all on function boy_central.admin_save_bigc_piece_weight(jsonb) from public,anon;
revoke all on function boy_central.get_bigc_piece_weight_settings() from public,anon;
revoke all on function boy_central.reprocess_bigc_interbranch_costs(uuid) from public,anon;
grant execute on function boy_central.admin_save_bigc_interbranch_cost_rule(jsonb) to authenticated;
grant execute on function boy_central.admin_save_bigc_piece_weight(jsonb) to authenticated;
grant execute on function boy_central.get_bigc_piece_weight_settings() to authenticated;
grant execute on function boy_central.reprocess_bigc_interbranch_costs(uuid) to authenticated;

create or replace function boy_central.save_bigc_v2_workflow(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  actor uuid:=auth.uid();
  target_branch boy_central.branches%rowtype;
  target_id uuid;
  target_type text:=payload->>'workflow_type';
  target_date date;
  line jsonb;
  line_no integer:=0;
  weight_value numeric(18,6);
  handling_value text;
  basis_value text;
  costing_result jsonb:=jsonb_build_object('status','not_applicable');
begin
  if actor is null then raise exception 'authentication required'; end if;
  if target_type not in ('close_order','receive','return') then raise exception 'invalid workflow_type'; end if;
  select * into target_branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if target_branch.id is null then raise exception 'BigC branch not found'; end if;
  if not boy_central_private.has_branch_access(target_branch.id,array['admin','manager','staff']) then raise exception 'branch access denied'; end if;
  target_date:=coalesce(nullif(payload->>'business_date','')::date,current_date);

  insert into boy_central.bigc_workflows(
    company_id,branch_id,business_date,workflow_type,status,source_workflow_id,
    cash_amount,transfer_amount,thai_chuay_thai_amount,sheet_sync_status,sheet_sync_error,
    submitted_by,submitted_at,updated_at
  ) values(
    target_branch.company_id,target_branch.id,target_date,target_type,'submitted',
    nullif(payload->>'source_workflow_id','')::uuid,
    greatest(coalesce(nullif(payload->>'cash_amount','')::numeric,0),0),
    greatest(coalesce(nullif(payload->>'transfer_amount','')::numeric,0),0),
    greatest(coalesce(nullif(payload->>'thai_chuay_thai_amount','')::numeric,0),0),
    'pending',null,actor,now(),now()
  ) on conflict(branch_id,business_date,workflow_type) do update set
    status='submitted',source_workflow_id=excluded.source_workflow_id,
    cash_amount=excluded.cash_amount,transfer_amount=excluded.transfer_amount,
    thai_chuay_thai_amount=excluded.thai_chuay_thai_amount,
    sheet_sync_status='pending',sheet_sync_error=null,
    revision=boy_central.bigc_workflows.revision+1,
    submitted_by=actor,submitted_at=now(),updated_at=now()
  returning id into target_id;

  delete from boy_central.bigc_workflow_lines where workflow_id=target_id;
  for line in select value from jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)) loop
    line_no:=line_no+1;
    if trim(coalesce(line->>'item_name',''))='' then continue; end if;
    weight_value:=coalesce(nullif(line->>'actual_weight_kg','')::numeric,nullif(line->>'observed_weight_kg','')::numeric);
    if weight_value is not null and weight_value<=0 then weight_value:=null; end if;
    handling_value:=case when line->>'handling_type' in ('standard','whole_fruit','prepared','juiced','consignment')
      then line->>'handling_type' else 'standard' end;
    basis_value:=case
      when line->>'measurement_basis' in ('raw','estimated_raw','finished','unknown') then line->>'measurement_basis'
      when line->>'costing_basis'='estimated_raw_piece' then 'estimated_raw'
      when line->>'costing_basis'='actual_raw_weight_kg' then 'raw'
      when line->>'costing_basis'='backend_yield_from_actual_weight' then 'finished'
      when handling_value='whole_fruit' then 'raw'
      when handling_value in ('prepared','juiced') then 'finished'
      else 'unknown' end;

    insert into boy_central.bigc_workflow_lines(
      company_id,workflow_id,line_key,source_line_key,item_id,item_name,category_name,unit_name,input_mode,
      quantity,received,sort_order,estimated_unit_cost,estimated_value,note,
      actual_weight_kg,handling_type,costing_basis,measurement_basis
    ) values(
      target_branch.company_id,target_id,
      coalesce(nullif(line->>'line_key',''),'line-'||line_no),nullif(line->>'source_line_key',''),
      nullif(line->>'item_id','')::uuid,trim(line->>'item_name'),nullif(trim(line->>'category_name'),''),
      nullif(trim(line->>'unit_name'),''),case when line->>'input_mode'='weight' then 'weight' else 'quantity' end,
      greatest(coalesce(nullif(line->>'quantity','')::numeric,0),0),coalesce((line->>'received')::boolean,true),
      coalesce(nullif(line->>'sort_order','')::integer,line_no),nullif(line->>'estimated_unit_cost','')::numeric,
      nullif(line->>'estimated_value','')::numeric,nullif(trim(line->>'note'),''),
      weight_value,handling_value,nullif(line->>'costing_basis',''),basis_value
    );
  end loop;

  if target_type in ('receive','return') then
    costing_result:=boy_central_private.refresh_bigc_interbranch_costs(target_id);
  end if;
  delete from boy_central.bigc_workflow_drafts
  where branch_id=target_branch.id and business_date=target_date and user_id=actor;
  return jsonb_build_object(
    'status','saved','workflow_id',target_id,'sheet_sync_status','pending','costing',costing_result
  );
end
$function$;

revoke all on function boy_central.save_bigc_v2_workflow(jsonb) from public,anon;
grant execute on function boy_central.save_bigc_v2_workflow(jsonb) to authenticated;

create or replace function boy_central.get_bigc_v2_context(target_date date default current_date)
returns jsonb
language plpgsql
security definer
set search_path=''
as $function$
declare
  actor uuid:=auth.uid();
  target_branch boy_central.branches%rowtype;
  result jsonb;
begin
  if actor is null then raise exception 'authentication required'; end if;
  select * into target_branch from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if target_branch.id is null then raise exception 'BigC branch not found'; end if;
  if not boy_central_private.has_branch_access(target_branch.id,array['admin','manager','staff']) then raise exception 'branch access denied'; end if;

  select jsonb_build_object(
    'branch',jsonb_build_object('id',target_branch.id,'code',target_branch.code,'name',target_branch.name),
    'business_date',target_date,
    'settings',coalesce((select jsonb_build_object('menu_config',s.menu_config,'default_return_keys',s.default_return_keys,'version',s.version)
      from boy_central.bigc_workflow_settings s where s.branch_id=target_branch.id),
      jsonb_build_object('menu_config','[]'::jsonb,'default_return_keys','[]'::jsonb,'version',0)),
    'draft',coalesce((select d.payload from boy_central.bigc_workflow_drafts d
      where d.branch_id=target_branch.id and d.business_date=target_date and d.user_id=actor),'{}'::jsonb),
    'workflows',coalesce((select jsonb_agg(jsonb_build_object(
      'id',w.id,'workflow_type',w.workflow_type,'status',w.status,'business_date',w.business_date,
      'cash_amount',w.cash_amount,'transfer_amount',w.transfer_amount,'thai_chuay_thai_amount',w.thai_chuay_thai_amount,
      'sheet_sync_status',w.sheet_sync_status,'sheet_sync_error',w.sheet_sync_error,'revision',w.revision,
      'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'line_key',l.line_key,'source_line_key',l.source_line_key,'item_id',l.item_id,'item_name',l.item_name,
        'category_name',l.category_name,'unit_name',l.unit_name,'input_mode',l.input_mode,
        'quantity',l.quantity,'received',l.received,'sort_order',l.sort_order,'note',l.note,
        'actual_weight_kg',l.actual_weight_kg,'observed_weight_kg',l.actual_weight_kg,
        'handling_type',l.handling_type,'costing_basis',l.costing_basis,
        'measurement_basis',l.measurement_basis,
        'estimated_unit_cost',l.estimated_unit_cost,
        'raw_unit_cost_per_kg',a.raw_unit_cost_per_kg,
        'estimated_value',coalesce(a.target_branch_cost_delta,l.estimated_value),
        'costing_status',coalesce(a.cost_status,'pending'),
        'cost_status',coalesce(a.cost_status,'pending'),
        'cost_value',a.target_branch_cost_delta,'calculated_cost',a.target_branch_cost_delta,
        'cost_pending_reason',a.pending_reason,'cost_provenance',a.provenance
      ) order by l.sort_order,l.item_name)
      from boy_central.bigc_workflow_lines l
      left join boy_central.branch_cost_allocations a on a.workflow_id=l.workflow_id and a.line_key=l.line_key
      where l.workflow_id=w.id),'[]'::jsonb)
    ) order by w.workflow_type) from boy_central.bigc_workflows w
      where w.branch_id=target_branch.id and w.business_date=target_date and w.status<>'voided'),'[]'::jsonb),
    'previous_order',coalesce((select jsonb_build_object(
      'id',w.id,'business_date',w.business_date,
      'lines',coalesce((select jsonb_agg(jsonb_build_object(
        'line_key',l.line_key,'item_id',l.item_id,'item_name',l.item_name,'category_name',l.category_name,
        'unit_name',l.unit_name,'input_mode',l.input_mode,'quantity',l.quantity,'sort_order',l.sort_order
      ) order by l.sort_order,l.item_name) from boy_central.bigc_workflow_lines l
        where l.workflow_id=w.id and l.quantity>0),'[]'::jsonb)
    ) from boy_central.bigc_workflows w where w.branch_id=target_branch.id
      and w.business_date=target_date-1 and w.workflow_type='close_order' and w.status='submitted'),'null'::jsonb),
    'pending_sheet_sync',coalesce((select jsonb_agg(jsonb_build_object('id',w.id,'workflow_type',w.workflow_type,'business_date',w.business_date))
      from boy_central.bigc_workflows w where w.branch_id=target_branch.id and w.sheet_sync_status in ('pending','error')),'[]'::jsonb),
    'pending_costing',coalesce((select jsonb_agg(jsonb_build_object(
      'workflow_id',a.workflow_id,'line_key',a.line_key,'reason',a.pending_reason
    ) order by a.created_at) from boy_central.branch_cost_allocations a
      where a.target_branch_id=target_branch.id and a.valuation_month=date_trunc('month',target_date)::date
        and a.cost_status='pending'),'[]'::jsonb)
  ) into result;
  return result;
end
$function$;

revoke all on function boy_central.get_bigc_v2_context(date) from public,anon;
grant execute on function boy_central.get_bigc_v2_context(date) to authenticated;

notify pgrst,'reload schema';
