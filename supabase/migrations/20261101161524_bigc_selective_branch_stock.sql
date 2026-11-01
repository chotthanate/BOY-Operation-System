-- Inventory policy is per BigC menu item. Existing pooled-stock postings are
-- retained as historical facts and are never silently recalculated by a rule change.
alter table boy_central.bigc_shared_stock_postings
  add column if not exists source_deducted boolean not null default true;

create or replace function boy_central_private.reconcile_bigc_shared_stock(target_workflow_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare
  workflow_row boy_central.bigc_workflows%rowtype;
  tawana_branch_id uuid;
  tawana_location_id uuid;
  bigc_location_id uuid;
  entry record;
  balance_row boy_central.inventory_balances%rowtype;
  conversion numeric(18,6);
  wanted_quantity numeric(18,6);
  delta numeric(18,6);
  movement_delta numeric(18,6);
  next_quantity numeric(18,6);
  next_value numeric(18,2);
  unit_cost numeric(18,6);
  source_enabled boolean;
  location_id_value uuid;
  branch_id_value uuid;
  direction text;
begin
  select * into workflow_row from boy_central.bigc_workflows
    where id=target_workflow_id for update;
  if workflow_row.id is null or workflow_row.workflow_type not in ('receive','return') then return; end if;

  select id into tawana_branch_id from boy_central.branches
    where company_id=workflow_row.company_id and code='TAWANA' and active;
  select id into tawana_location_id from boy_central.inventory_locations
    where branch_id=tawana_branch_id and active
    order by (location_type='main') desc,created_at limit 1;
  select id into bigc_location_id from boy_central.inventory_locations
    where branch_id=workflow_row.branch_id and active
    order by (location_type='main') desc,created_at limit 1;
  if tawana_location_id is null or bigc_location_id is null then
    raise exception 'ไม่พบจุดเก็บสต็อกทาวน่าหรือ BigC';
  end if;

  for entry in
    with policy as (
      select config.value menu_item
      from boy_central.bigc_workflow_settings s
      cross join lateral jsonb_array_elements(s.menu_config) config(value)
      where s.branch_id=workflow_row.branch_id
    ), wanted as (
      select l.line_key,l.item_id,l.unit_name,l.quantity,l.received,
        exists(select 1 from policy p where p.menu_item->>'itemId'=l.item_id::text
          and p.menu_item->>'stockAtBigc'='true') enabled,
        exists(select 1 from policy p where p.menu_item->>'itemId'=l.item_id::text
          and p.menu_item->>'stockAtBigc'='true'
          and p.menu_item->>'deductTawanaStock'='true') deduct_source
      from boy_central.bigc_workflow_lines l
      where l.workflow_id=target_workflow_id and l.item_id is not null
    )
    select coalesce(w.line_key,p.line_key) line_key,
      coalesce(w.item_id,p.item_id) item_id,w.unit_name,w.quantity,w.received,
      coalesce(w.enabled,false) enabled,coalesce(w.deduct_source,false) deduct_source,
      p.quantity posted_quantity,p.unit_cost posted_cost,p.source_deducted posted_source
    from wanted w full join boy_central.bigc_shared_stock_postings p
      on p.workflow_id=target_workflow_id and p.line_key=w.line_key and p.item_id=w.item_id
    where p.workflow_id=target_workflow_id or w.enabled
  loop
    if entry.posted_quantity is null and not entry.enabled then continue; end if;
    source_enabled:=coalesce(entry.posted_source,entry.deduct_source);
    wanted_quantity:=0;
    if entry.received and entry.quantity>0 then
      select iu.conversion_to_base into conversion
      from boy_central.item_units iu join boy_central.units u on u.id=iu.unit_id
      where iu.item_id=entry.item_id and iu.active
        and lower(trim(u.name))=lower(trim(coalesce(entry.unit_name,'')))
      limit 1;
      if conversion is null then
        raise exception 'ยังไม่กำหนดอัตราแปลงหน่วย % ของสินค้า %',
          coalesce(entry.unit_name,'(ไม่ระบุ)'),entry.item_id;
      end if;
      wanted_quantity:=round(entry.quantity*conversion,6);
    end if;
    delta:=wanted_quantity-coalesce(entry.posted_quantity,0);
    if delta=0 then continue; end if;

    -- A return reduces BigC stock and restores Tawana stock only for lines
    -- which were explicitly configured to deduct Tawana.
    if workflow_row.workflow_type='return' then delta:=-delta; end if;
    -- Inventory valuation is independent of the month's evolving expense
    -- allocation. For an untracked Tawana source, this remains quantity-only.
    if entry.posted_cost is not null then
      unit_cost:=entry.posted_cost;
    else
      select coalesce(b.average_unit_cost,0) into unit_cost
      from boy_central.inventory_balances b
      where b.location_id=case
        when source_enabled and workflow_row.workflow_type='receive' then tawana_location_id
        else bigc_location_id end and b.item_id=entry.item_id;
      unit_cost:=coalesce(unit_cost,0);
    end if;

    for direction,branch_id_value,location_id_value,movement_delta in
      select 'bigc'::text,workflow_row.branch_id,bigc_location_id,delta
      union all
      select 'tawana',tawana_branch_id,tawana_location_id,-delta
      where source_enabled
    loop
      insert into boy_central.inventory_balances
        (company_id,branch_id,location_id,item_id,quantity_on_hand,average_unit_cost,inventory_value)
      values(workflow_row.company_id,branch_id_value,location_id_value,entry.item_id,0,0,0)
      on conflict(location_id,item_id) do nothing;
      select * into balance_row from boy_central.inventory_balances
        where location_id=location_id_value and item_id=entry.item_id for update;
      next_quantity:=balance_row.quantity_on_hand+movement_delta;
      if next_quantity<0 then
        raise exception 'สต็อก % ไม่พอสำหรับ % กรุณานับยอดจริงก่อน',
          case when direction='bigc' then 'BigC' else 'ทาวน่า' end,entry.item_id;
      end if;
      next_value:=round(balance_row.inventory_value+movement_delta*unit_cost,2);
      insert into boy_central.stock_movements
        (company_id,branch_id,location_id,item_id,movement_type,quantity_before,
         quantity_delta,quantity_after,unit_cost_base,movement_value,source_system,
         external_id,occurred_at,created_by,reason)
      values(workflow_row.company_id,branch_id_value,location_id_value,entry.item_id,
        case when movement_delta>0 then 'transfer_in' else 'transfer_out' end,
        balance_row.quantity_on_hand,movement_delta,next_quantity,unit_cost,
        round(movement_delta*unit_cost,2),'bigc_selective_stock',
        target_workflow_id::text||':'||entry.line_key||':'||entry.item_id::text||':'||workflow_row.revision||':'||direction,
        now(),workflow_row.submitted_by,'BigC รับ/คืนตามรายการที่เปิดนับสต็อก');
      update boy_central.inventory_balances b set
        quantity_on_hand=next_quantity,inventory_value=next_value,
        average_unit_cost=case when next_quantity>0 then greatest(next_value/next_quantity,0)
          else b.average_unit_cost end,updated_at=now()
      where b.id=balance_row.id;
    end loop;

    -- Keep positive posted quantity even for returns. The workflow type
    -- determines the physical sign, and the posting makes retries idempotent.
    if wanted_quantity>0 then
      insert into boy_central.bigc_shared_stock_postings
        (workflow_id,line_key,item_id,quantity,unit_cost,source_deducted)
      values(target_workflow_id,entry.line_key,entry.item_id,wanted_quantity,unit_cost,source_enabled)
      on conflict(workflow_id,line_key,item_id) do update set
        quantity=excluded.quantity,unit_cost=excluded.unit_cost,
        source_deducted=excluded.source_deducted,updated_at=now();
    else
      delete from boy_central.bigc_shared_stock_postings p
      where p.workflow_id=target_workflow_id and p.line_key=entry.line_key and p.item_id=entry.item_id;
    end if;
  end loop;
end
$function$;

revoke all on function boy_central_private.reconcile_bigc_shared_stock(uuid)
  from public,anon,authenticated;

-- The old writer handles validation, costs and receive reconciliation.
-- Wrap it only to also reconcile returned stock after the cost reversal.
alter function boy_central.save_bigc_v2_workflow(jsonb)
  rename to save_bigc_v2_workflow_before_selective_stock;
revoke all on function boy_central.save_bigc_v2_workflow_before_selective_stock(jsonb)
  from public,anon,authenticated;
create function boy_central.save_bigc_v2_workflow(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare result jsonb;
begin
  result:=boy_central.save_bigc_v2_workflow_before_selective_stock(payload);
  if payload->>'workflow_type'='return' then
    perform boy_central_private.reconcile_bigc_shared_stock((result->>'workflow_id')::uuid);
  end if;
  return result;
end
$function$;
revoke all on function boy_central.save_bigc_v2_workflow(jsonb) from public,anon;
grant execute on function boy_central.save_bigc_v2_workflow(jsonb) to authenticated;

-- Manager settings must not enable inventory for an unmapped item or a
-- BigC unit without an explicit conversion to that central item's base unit.
alter function boy_central.save_bigc_v2_settings(jsonb)
  rename to save_bigc_v2_settings_before_selective_stock;
revoke all on function boy_central.save_bigc_v2_settings_before_selective_stock(jsonb)
  from public,anon,authenticated;
create function boy_central.save_bigc_v2_settings(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  menu_item jsonb;
  central_item boy_central.items%rowtype;
  item_uuid uuid;
  unit_label text;
  branch_id_value uuid;
  result jsonb;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select id into branch_id_value from boy_central.branches
    where code='BIGC-CENTRAL-PATTAYA' and active;
  if branch_id_value is null or not boy_central_private.has_branch_access(
    branch_id_value,array['admin','manager']) then
    raise exception 'manager access required';
  end if;
  if jsonb_typeof(payload->'menu_config') is distinct from 'array' then
    raise exception 'menu_config must be an array';
  end if;
  for menu_item in select value from jsonb_array_elements(payload->'menu_config') loop
    if coalesce((menu_item->>'deductTawanaStock')::boolean,false)
      and not coalesce((menu_item->>'stockAtBigc')::boolean,false) then
      raise exception 'ต้องเปิดนับสต็อก BigC ก่อนเลือกตัดสต็อกทาวน่า';
    end if;
    if not coalesce((menu_item->>'stockAtBigc')::boolean,false) then continue; end if;
    if coalesce(menu_item->>'itemId','') !~
      '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then
      raise exception 'รายการ % ยังไม่ได้จับคู่สินค้ากลาง',menu_item->>'name';
    end if;
    item_uuid:=(menu_item->>'itemId')::uuid;
    select * into central_item from boy_central.items where id=item_uuid and active;
    if central_item.id is null or not central_item.track_stock then
      raise exception 'สินค้า % ยังไม่เปิดนับสต็อกในข้อมูลกลาง',menu_item->>'name';
    end if;
    unit_label:=trim(coalesce(menu_item->>'unit',''));
    if not exists (
      select 1 from boy_central.item_units iu join boy_central.units u on u.id=iu.unit_id
      where iu.item_id=item_uuid and iu.active
        and lower(trim(u.name))=lower(unit_label)
    ) then
      raise exception 'ยังไม่มีอัตราแปลงหน่วย % ของ % ในข้อมูลกลาง',
        coalesce(nullif(unit_label,''),'(ไม่ระบุ)'),central_item.name;
    end if;
    if coalesce((menu_item->>'deductTawanaStock')::boolean,false)
      and central_item.code not in ('ITEM-0142','ITEM-0143','ITEM-0144') then
      raise exception 'ตอนนี้ตัดสต็อกทาวน่าอัตโนมัติได้เฉพาะแก้ว 3 แบบ';
    end if;
  end loop;
  if exists (
    select 1 from jsonb_array_elements(payload->'menu_config') x
    where x->>'itemId' is not null
    group by x->>'itemId'
    having count(distinct coalesce(x->>'stockAtBigc','false')||':'||
      coalesce(x->>'deductTawanaStock','false'))>1
  ) then
    raise exception 'สินค้ากลางเดียวกันตั้งค่าสต็อกไม่ตรงกัน';
  end if;
  result:=boy_central.save_bigc_v2_settings_before_selective_stock(payload);
  return result;
end
$function$;
revoke all on function boy_central.save_bigc_v2_settings(jsonb) from public,anon;
grant execute on function boy_central.save_bigc_v2_settings(jsonb) to authenticated;

-- A BigC return is an expense transfer back to Tawana. The existing cost
-- engine links to a particular receipt; the daily BigC return UI does not
-- select one. For such unlinked returns, use that month's average instead.
create or replace function boy_central_private.price_unlinked_bigc_returns(target_workflow_id uuid)
returns void language plpgsql security definer set search_path='' as $function$
declare
  workflow_row boy_central.bigc_workflows%rowtype;
  tawana_branch_id uuid;
  line_row boy_central.bigc_workflow_lines%rowtype;
  rule_row boy_central.bigc_interbranch_cost_rules%rowtype;
  target_month date;
  price record;
  conversion numeric(18,6);
  raw_quantity numeric(18,6);
  piece_weight numeric;
  usable_ratio numeric;
  amount numeric(18,4);
begin
  select * into workflow_row from boy_central.bigc_workflows where id=target_workflow_id;
  if workflow_row.id is null or workflow_row.workflow_type<>'return' then return; end if;
  select id into tawana_branch_id from boy_central.branches
    where company_id=workflow_row.company_id and code='TAWANA' and active;
  target_month:=date_trunc('month',workflow_row.business_date)::date;
  for line_row in select l.* from boy_central.bigc_workflow_lines l
    join boy_central.branch_cost_allocations a
      on a.workflow_id=l.workflow_id and a.line_key=l.line_key
    where l.workflow_id=target_workflow_id and l.received and l.quantity>0
      and l.item_id is not null and l.handling_type<>'consignment'
      and (a.cost_status='pending' or
        (a.cost_status='reversed' and
         a.provenance->>'price_method'='tawana_monthly_average_unlinked_return'))
  loop
    raw_quantity:=null; amount:=null; rule_row:=null; price:=null;
    if line_row.handling_type='standard' then
      select iu.conversion_to_base into conversion
      from boy_central.item_units iu join boy_central.units u on u.id=iu.unit_id
      where iu.item_id=line_row.item_id and iu.active
        and lower(trim(u.name))=lower(trim(coalesce(line_row.unit_name,''))) limit 1;
      if conversion is null then continue; end if;
      raw_quantity:=round(line_row.quantity*conversion,6);
      select month_start,total_quantity,total_value,line_count,line_ids into price from (
        select date_trunc('month',t.transaction_date)::date month_start,
          sum(coalesce(nullif(tl.base_quantity,0),tl.quantity*tl.conversion_to_base)) total_quantity,
          sum(tl.line_total) total_value,count(*)::integer line_count,
          array_agg(tl.id order by tl.id) line_ids
        from boy_central.transactions t
        join boy_central.transaction_lines tl on tl.transaction_id=t.id
        left join boy_central.expense_items e on e.id=tl.expense_item_id
        join boy_central.items purchased on purchased.id=coalesce(tl.item_id,e.item_id)
        where t.company_id=workflow_row.company_id and t.branch_id=tawana_branch_id
          and t.status='confirmed' and t.transaction_type in ('expense','purchase')
          and t.transaction_date>=target_month-interval '12 months'
          and t.transaction_date<target_month+interval '1 month'
          and coalesce(purchased.stock_target_item_id,purchased.id)=line_row.item_id
          and tl.line_total>0
          and coalesce(nullif(tl.base_quantity,0),tl.quantity*tl.conversion_to_base)>0
        group by 1
      ) monthly where total_quantity>0 order by month_start desc limit 1;
      if price.total_quantity is null then continue; end if;
      amount:=round(raw_quantity*price.total_value/price.total_quantity,4);
    else
      select * into rule_row from boy_central.bigc_interbranch_cost_rules r
      where r.company_id=workflow_row.company_id
        and r.receiving_branch_id=workflow_row.branch_id
        and r.received_item_id=line_row.item_id and r.active
        and r.effective_month<=target_month
      order by r.effective_month desc,r.created_at desc limit 1;
      if rule_row.id is null then continue; end if;
      if line_row.measurement_basis='estimated_raw' then
        select kg_per_piece into piece_weight from boy_central_private.resolve_bigc_piece_weight(
          workflow_row.company_id,rule_row.raw_item_id,workflow_row.business_date);
        raw_quantity:=line_row.quantity*piece_weight;
      elsif line_row.measurement_basis='raw' then
        raw_quantity:=line_row.actual_weight_kg;
      elsif line_row.measurement_basis='finished' then
        select yield_ratio into usable_ratio from boy_central_private.resolve_bigc_yield(
          rule_row.id,target_month,12);
        raw_quantity:=line_row.actual_weight_kg/nullif(usable_ratio,0);
      end if;
      if raw_quantity is null or raw_quantity<=0 then continue; end if;
      select p.unit_cost,p.source_month as month_start,
        p.source_quantity as total_quantity,p.source_value as total_value,
        p.source_line_count as line_count,p.source_line_ids as line_ids
      into price from boy_central_private.resolve_tawana_monthly_raw_price(
        workflow_row.company_id,rule_row.raw_item_id,target_month,12) p;
      if price.unit_cost is null then continue; end if;
      amount:=round(raw_quantity*price.unit_cost,4);
    end if;
    if amount is null or amount<=0 then continue; end if;
    update boy_central.branch_cost_allocations a set
      cost_status='reversed',pending_reason=null,
      raw_item_id=coalesce(rule_row.raw_item_id,line_row.item_id),
      raw_equivalent_kg=case when line_row.handling_type='standard' then null else raw_quantity end,
      price_source_month=price.month_start,
      price_source_quantity=price.total_quantity,
      price_source_value=price.total_value,
      price_source_line_count=price.line_count,
      price_source_line_ids=price.line_ids,
      source_branch_cost_delta=amount,target_branch_cost_delta=-amount,
      provenance=a.provenance||jsonb_build_object(
        'price_method','tawana_monthly_average_unlinked_return',
        'price_is_provisional',true,'quantity_is_operational_only',true),
      updated_at=now()
    where a.workflow_id=target_workflow_id and a.line_key=line_row.line_key
      and (a.cost_status='pending' or
        (a.cost_status='reversed' and
         a.provenance->>'price_method'='tawana_monthly_average_unlinked_return'));
    update boy_central.bigc_workflow_lines set estimated_value=-amount
      where id=line_row.id;
  end loop;
end
$function$;
revoke all on function boy_central_private.price_unlinked_bigc_returns(uuid)
  from public,anon,authenticated;

-- Unlike the earlier implementation, provisional standard costs must be
-- revalued whenever this month's purchase average changes.
create or replace function boy_central_private.refresh_bigc_standard_costs(target_workflow_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare
  workflow_row boy_central.bigc_workflows%rowtype;
  tawana_branch_id uuid;
  line_row boy_central.bigc_workflow_lines%rowtype;
  price record;
  target_month date;
  conversion numeric(18,6);
  amount numeric(18,4);
  posted integer:=0;
begin
  select * into workflow_row from boy_central.bigc_workflows where id=target_workflow_id;
  if workflow_row.id is null or workflow_row.workflow_type<>'receive' then
    return jsonb_build_object('posted',0);
  end if;
  select id into tawana_branch_id from boy_central.branches
    where company_id=workflow_row.company_id and code='TAWANA' and active;
  target_month:=date_trunc('month',workflow_row.business_date)::date;
  for line_row in select l.* from boy_central.bigc_workflow_lines l
    where l.workflow_id=target_workflow_id and l.received and l.quantity>0
      and l.handling_type='standard' and l.item_id is not null
  loop
    select iu.conversion_to_base into conversion from boy_central.item_units iu
      join boy_central.units u on u.id=iu.unit_id
      where iu.item_id=line_row.item_id and iu.active
        and lower(trim(u.name))=lower(trim(coalesce(line_row.unit_name,''))) limit 1;
    if conversion is null then continue; end if;
    select month_start,total_quantity,total_value,line_count,line_ids into price from (
      select date_trunc('month',t.transaction_date)::date month_start,
        sum(coalesce(nullif(tl.base_quantity,0),tl.quantity*tl.conversion_to_base)) total_quantity,
        sum(tl.line_total) total_value,count(*)::integer line_count,
        array_agg(tl.id order by tl.id) line_ids
      from boy_central.transactions t join boy_central.transaction_lines tl on tl.transaction_id=t.id
      left join boy_central.expense_items e on e.id=tl.expense_item_id
      join boy_central.items purchased on purchased.id=coalesce(tl.item_id,e.item_id)
      where t.company_id=workflow_row.company_id and t.branch_id=tawana_branch_id
        and t.status='confirmed' and t.transaction_type in ('expense','purchase')
        and t.transaction_date>=target_month-interval '12 months'
        and t.transaction_date<target_month+interval '1 month'
        and coalesce(purchased.stock_target_item_id,purchased.id)=line_row.item_id
        and tl.line_total>0
        and coalesce(nullif(tl.base_quantity,0),tl.quantity*tl.conversion_to_base)>0
      group by 1
    ) monthly where total_quantity>0 order by month_start desc limit 1;
    if price.total_quantity is null then continue; end if;
    amount:=round(line_row.quantity*conversion*price.total_value/price.total_quantity,4);
    update boy_central.branch_cost_allocations a set
      cost_status='provisional',pending_reason=null,
      raw_item_id=line_row.item_id,price_source_month=price.month_start,
      price_fallback_months=((extract(year from age(target_month,price.month_start))*12)
        +extract(month from age(target_month,price.month_start)))::integer,
      price_source_quantity=price.total_quantity,price_source_value=price.total_value,
      price_source_line_count=price.line_count,price_source_line_ids=price.line_ids,
      source_branch_cost_delta=-amount,target_branch_cost_delta=amount,
      provenance=a.provenance||jsonb_build_object(
        'price_method','tawana_weighted_monthly_purchase_base_unit',
        'price_is_provisional',true,'receipt_conversion_to_base',conversion,
        'unit_cost_per_base_unit',price.total_value/price.total_quantity,
        'price_source_line_ids',to_jsonb(price.line_ids)),updated_at=now()
    where a.workflow_id=target_workflow_id and a.line_key=line_row.line_key
      and a.cost_status in ('pending','provisional')
      and not exists(select 1 from boy_central.branch_cost_allocations reversal
        where reversal.reversal_of_allocation_id=a.id and reversal.cost_status='reversed');
    if found then posted:=posted+1; end if;
  end loop;
  return jsonb_build_object('posted',posted);
end
$function$;
revoke all on function boy_central_private.refresh_bigc_standard_costs(uuid)
  from public,anon,authenticated;

create or replace function boy_central_private.revalue_bigc_standard_costs_for_purchase(
  target_company_id uuid,target_purchase_date date,target_item_id uuid default null
) returns void language plpgsql security definer set search_path='' as $function$
declare
  target_pool_id uuid;
  workflow_record record;
  purchase_month date:=date_trunc('month',target_purchase_date)::date;
begin
  if target_company_id is null or target_purchase_date is null then return; end if;
  if target_item_id is not null then
    select coalesce(i.stock_target_item_id,i.id) into target_pool_id
    from boy_central.items i where i.id=target_item_id;
  end if;
  for workflow_record in
    select distinct a.workflow_id from boy_central.branch_cost_allocations a
    join boy_central.bigc_workflow_lines l
      on l.workflow_id=a.workflow_id and l.line_key=a.line_key
    where a.company_id=target_company_id and a.allocation_type='receive'
      and a.cost_status in ('pending','provisional')
      and l.handling_type='standard' and l.received and l.item_id is not null
      and (target_pool_id is null or l.item_id=target_pool_id)
      and a.valuation_month>=purchase_month
      and a.valuation_month<=(purchase_month+interval '12 months')::date
      and not exists(select 1 from boy_central.branch_cost_allocations reversal
        where reversal.reversal_of_allocation_id=a.id and reversal.cost_status='reversed')
  loop
    begin
      perform boy_central_private.refresh_bigc_interbranch_costs(workflow_record.workflow_id);
    exception when others then
      raise warning 'BigC receive revaluation failed for workflow %: %',workflow_record.workflow_id,sqlerrm;
    end;
  end loop;
  for workflow_record in
    select distinct a.workflow_id from boy_central.branch_cost_allocations a
    join boy_central.bigc_workflow_lines l
      on l.workflow_id=a.workflow_id and l.line_key=a.line_key
    where a.company_id=target_company_id and a.allocation_type='return'
      and (a.cost_status='pending' or
        (a.cost_status='reversed' and
         a.provenance->>'price_method'='tawana_monthly_average_unlinked_return'))
      and a.valuation_month>=purchase_month
      and a.valuation_month<=(purchase_month+interval '12 months')::date
      and (target_pool_id is null or l.item_id=target_pool_id
        or a.raw_item_id=target_pool_id or a.cost_status='pending')
  loop
    begin
      perform boy_central_private.price_unlinked_bigc_returns(workflow_record.workflow_id);
    exception when others then
      raise warning 'BigC return revaluation failed for workflow %: %',workflow_record.workflow_id,sqlerrm;
    end;
  end loop;
end
$function$;
revoke all on function boy_central_private.revalue_bigc_standard_costs_for_purchase(uuid,date,uuid)
  from public,anon,authenticated;

-- Replace the wrapper with the same public signature after adding return pricing.
create or replace function boy_central.save_bigc_v2_workflow(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $function$
declare result jsonb;
begin
  result:=boy_central.save_bigc_v2_workflow_before_selective_stock(payload);
  if payload->>'workflow_type'='return' then
    perform boy_central_private.price_unlinked_bigc_returns((result->>'workflow_id')::uuid);
    perform boy_central_private.reconcile_bigc_shared_stock((result->>'workflow_id')::uuid);
  end if;
  return result;
end
$function$;
notify pgrst,'reload schema';
