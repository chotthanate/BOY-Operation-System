create table if not exists boy_central.purchase_receipts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id),
  transaction_id uuid not null unique references boy_central.transactions(id),
  status text not null default 'pending' check (status in ('pending','received','cancelled')),
  created_by uuid references auth.users(id),
  received_by uuid references auth.users(id),
  received_device_id uuid references boy_central.pos_devices(id),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists boy_central.purchase_receipt_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id),
  receipt_id uuid not null references boy_central.purchase_receipts(id) on delete cascade,
  transaction_line_id uuid not null unique references boy_central.transaction_lines(id),
  item_id uuid not null references boy_central.items(id),
  unit_id uuid references boy_central.units(id),
  quantity_expected numeric(18,6) not null check (quantity_expected > 0),
  quantity_received numeric(18,6) not null default 0 check (quantity_received >= 0),
  unit_cost_base numeric(18,6) not null default 0 check (unit_cost_base >= 0),
  line_value numeric(18,2) not null default 0 check (line_value >= 0),
  status text not null default 'pending' check (status in ('pending','received','cancelled')),
  received_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists purchase_receipts_branch_status_idx
  on boy_central.purchase_receipts(branch_id,status,created_at desc);
create index if not exists purchase_receipt_lines_receipt_status_idx
  on boy_central.purchase_receipt_lines(receipt_id,status);
create index if not exists purchase_receipt_lines_item_idx
  on boy_central.purchase_receipt_lines(item_id);

alter table boy_central.purchase_receipts enable row level security;
alter table boy_central.purchase_receipt_lines enable row level security;

drop policy if exists purchase_receipts_branch_read on boy_central.purchase_receipts;
create policy purchase_receipts_branch_read on boy_central.purchase_receipts
for select to authenticated
using (boy_central_private.has_branch_access(branch_id,null));

drop policy if exists purchase_receipt_lines_branch_read on boy_central.purchase_receipt_lines;
create policy purchase_receipt_lines_branch_read on boy_central.purchase_receipt_lines
for select to authenticated
using (boy_central_private.has_branch_access(branch_id,null));

revoke all on boy_central.purchase_receipts from public,anon;
revoke all on boy_central.purchase_receipt_lines from public,anon;
grant select on boy_central.purchase_receipts to authenticated;
grant select on boy_central.purchase_receipt_lines to authenticated;

-- The existing expense writer remains the single source of validation. This flag
-- lets v3 save the accounting transaction without pretending goods already arrived.
do $migration$
declare definition text;
begin
  select pg_get_functiondef(p.oid) into definition
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='boy_central' and p.proname='record_expense'
    and pg_get_function_identity_arguments(p.oid)='payload jsonb';
  if definition is null then raise exception 'record_expense(jsonb) not found'; end if;
  if position('defer_stock_value boolean' in definition)=0 then
    definition:=replace(definition,
      'affects_stock_value boolean := false;',
      'affects_stock_value boolean := false;'||chr(10)||'  defer_stock_value boolean := coalesce(nullif(payload->>''defer_stock'','''')::boolean,false);');
    definition:=replace(definition,
      'if target_item.id is not null and target_item.track_stock then',
      'if target_item.id is not null and target_item.track_stock and not defer_stock_value then');
    if position('and not defer_stock_value' in definition)=0 then
      raise exception 'record_expense stock clause was not updated';
    end if;
    execute definition;
  end if;
end $migration$;

create or replace function boy_central_private.pending_receipts_json(target_branch_id uuid)
returns jsonb language sql stable security definer set search_path=''
as $function$
  select coalesce(jsonb_agg(row_data order by created_at desc),'[]'::jsonb)
  from (
    select r.created_at,jsonb_build_object(
      'receipt_id',r.id,'transaction_id',t.id,'transaction_no',t.transaction_no,
      'transaction_date',t.transaction_date,'created_at',r.created_at,
      'total_amount',coalesce(sum(l.line_value),0),'item_count',count(l.id),
      'lines',coalesce(jsonb_agg(jsonb_build_object(
        'line_id',l.id,'item_id',l.item_id,'item_name',i.name,
        'quantity',l.quantity_expected,'unit',u.name,'line_value',l.line_value
      ) order by i.name) filter (where l.id is not null),'[]'::jsonb)
    ) as row_data
    from boy_central.purchase_receipts r
    join boy_central.transactions t on t.id=r.transaction_id
    join boy_central.purchase_receipt_lines l on l.receipt_id=r.id and l.status='pending'
    join boy_central.items i on i.id=l.item_id
    left join boy_central.units u on u.id=i.base_unit_id
    where r.branch_id=target_branch_id and r.status='pending'
    group by r.id,t.id,t.transaction_no,t.transaction_date,r.created_at
  ) rows
$function$;

create or replace function boy_central_private.complete_purchase_receipt(
  target_receipt_id uuid,target_company_id uuid,target_branch_id uuid,
  actor_user_id uuid,actor_device_id uuid,source_name text
) returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  receipt_row boy_central.purchase_receipts%rowtype;
  receipt_line boy_central.purchase_receipt_lines%rowtype;
  current_balance boy_central.inventory_balances%rowtype;
  target_location_id uuid;
  next_quantity numeric(18,6);
  next_value numeric(18,2);
  next_average numeric(18,6);
  completed_count integer:=0;
begin
  select * into receipt_row from boy_central.purchase_receipts
  where id=target_receipt_id and company_id=target_company_id and branch_id=target_branch_id
  for update;
  if receipt_row.id is null then raise exception 'pending receipt not found'; end if;
  if receipt_row.status='received' then
    return jsonb_build_object('status','duplicate','receipt_id',receipt_row.id,'line_count',0);
  end if;
  if receipt_row.status<>'pending' then raise exception 'receipt is not pending'; end if;

  for receipt_line in select * from boy_central.purchase_receipt_lines
    where receipt_id=receipt_row.id and status='pending' order by created_at,id for update
  loop
    select coalesce(bi.default_location_id,(
      select il.id from boy_central.inventory_locations il
      where il.branch_id=target_branch_id and il.active order by il.created_at,il.id limit 1
    )) into target_location_id
    from boy_central.branch_items bi
    where bi.branch_id=target_branch_id and bi.item_id=receipt_line.item_id and bi.active;
    if target_location_id is null then
      select il.id into target_location_id from boy_central.inventory_locations il
      where il.branch_id=target_branch_id and il.active order by il.created_at,il.id limit 1;
    end if;
    if target_location_id is null then raise exception 'inventory location not configured for branch'; end if;

    insert into boy_central.inventory_balances(company_id,branch_id,location_id,item_id)
    values(target_company_id,target_branch_id,target_location_id,receipt_line.item_id)
    on conflict(location_id,item_id) do nothing;
    select * into current_balance from boy_central.inventory_balances
    where location_id=target_location_id and item_id=receipt_line.item_id for update;
    next_quantity:=current_balance.quantity_on_hand+receipt_line.quantity_expected;
    next_value:=round((current_balance.inventory_value+receipt_line.line_value)::numeric,2);
    next_average:=case when next_quantity=0 then 0 else next_value/next_quantity end;
    update boy_central.inventory_balances set quantity_on_hand=next_quantity,
      average_unit_cost=next_average,inventory_value=next_value,updated_at=now()
    where id=current_balance.id;
    insert into boy_central.stock_movements(
      company_id,branch_id,location_id,item_id,transaction_id,transaction_line_id,
      movement_type,quantity_before,quantity_delta,quantity_after,unit_cost_base,
      movement_value,source_system,external_id,occurred_at,created_by,reason
    ) values(
      target_company_id,target_branch_id,target_location_id,receipt_line.item_id,
      receipt_row.transaction_id,receipt_line.transaction_line_id,'purchase',
      current_balance.quantity_on_hand,receipt_line.quantity_expected,next_quantity,
      receipt_line.unit_cost_base,receipt_line.line_value,source_name,
      'receipt:'||receipt_row.id::text||':'||receipt_line.id::text,now(),actor_user_id,'รับสินค้าเข้าสต็อก'
    );
    update boy_central.purchase_receipt_lines set status='received',
      quantity_received=quantity_expected,received_at=now(),updated_at=now()
    where id=receipt_line.id;
    completed_count:=completed_count+1;
  end loop;
  if completed_count=0 then raise exception 'receipt has no pending lines'; end if;
  update boy_central.purchase_receipts set status='received',received_by=actor_user_id,
    received_device_id=actor_device_id,received_at=now(),updated_at=now()
  where id=receipt_row.id;
  update boy_central.transactions set affects_stock=true,updated_by=actor_user_id,updated_at=now()
  where id=receipt_row.transaction_id;
  insert into boy_central.pos_branch_configs(company_id,branch_id,config,version)
  values(target_company_id,target_branch_id,'{}'::jsonb,1)
  on conflict(branch_id) do update set version=boy_central.pos_branch_configs.version+1,updated_at=now();
  insert into boy_central.audit_log(company_id,branch_id,actor_user_id,action,entity_type,
    entity_id,source_system,after_data)
  values(target_company_id,target_branch_id,actor_user_id,'receive_purchase','purchase_receipt',
    receipt_row.id::text,source_name,jsonb_build_object('line_count',completed_count,'device_id',actor_device_id));
  return jsonb_build_object('status','received','receipt_id',receipt_row.id,'line_count',completed_count);
end $function$;

create or replace function boy_central.get_branch_pending_receipts(branch_code text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare target_branch boy_central.branches%rowtype;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  select * into target_branch from boy_central.branches where code=branch_code and active;
  if target_branch.id is null or not boy_central_private.has_branch_access(target_branch.id,null)
    then raise exception 'branch access denied'; end if;
  return boy_central_private.pending_receipts_json(target_branch.id);
end $function$;

create or replace function boy_central.receive_purchase_receipt(receipt_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare actor_id uuid:=auth.uid(); receipt_row boy_central.purchase_receipts%rowtype;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  select * into receipt_row from boy_central.purchase_receipts where id=receipt_id;
  if receipt_row.id is null or not boy_central_private.has_branch_access(receipt_row.branch_id,array['admin','manager','staff'])
    then raise exception 'branch access denied'; end if;
  return boy_central_private.complete_purchase_receipt(receipt_id,receipt_row.company_id,
    receipt_row.branch_id,actor_id,null,'boy_web');
end $function$;

create or replace function boy_central.get_pos_device_pending_receipts(device_token text)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare d boy_central.pos_devices%rowtype;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  update boy_central.pos_devices set last_seen_at=now() where id=d.id;
  return boy_central_private.pending_receipts_json(d.branch_id);
end $function$;

create or replace function boy_central.receive_pos_device_purchase_receipt(device_token text,receipt_id uuid)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare d boy_central.pos_devices%rowtype;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  return boy_central_private.complete_purchase_receipt(receipt_id,d.company_id,d.branch_id,null,d.id,'burger_pos_android');
end $function$;

create or replace function public.pos_pending_receipts(device_token text)
returns jsonb language sql security definer set search_path=''
as $function$ select boy_central.get_pos_device_pending_receipts(device_token); $function$;
create or replace function public.pos_receive_purchase_receipt(device_token text,receipt_id uuid)
returns jsonb language sql security definer set search_path=''
as $function$ select boy_central.receive_pos_device_purchase_receipt(device_token,receipt_id); $function$;

create or replace function boy_central.record_expense_v3(payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $function$
declare
  actor_id uuid:=auth.uid(); actor_company uuid; line jsonb; resolved_line jsonb;
  resolved_lines jsonb:='[]'::jsonb; resolved_payload jsonb;
  expense_row boy_central.expense_items%rowtype; source_item boy_central.items%rowtype;
  stock_item boy_central.items%rowtype; resolved_unit_id uuid;
  resolved_conversion numeric(18,6); result jsonb; target_transaction_id uuid;
  target_receipt_id uuid; pending_count integer:=0;
begin
  if actor_id is null then raise exception 'authentication required'; end if;
  select p.company_id into actor_company from boy_central.profiles p where p.user_id=actor_id and p.active;
  if actor_company is null then raise exception 'active profile required'; end if;
  for line in select value from jsonb_array_elements(payload->'lines') loop
    resolved_line:=line; expense_row.id:=null;
    if nullif(line->>'expense_item_id','') is not null then
      select * into expense_row from boy_central.expense_items ei
      where ei.id=(line->>'expense_item_id')::uuid and ei.company_id=actor_company and ei.active;
      if expense_row.id is null then raise exception 'active expense item not found'; end if;
      if expense_row.affects_stock then
        if expense_row.item_id is null then raise exception 'stock target is not configured for expense item %',expense_row.name; end if;
        select * into source_item from boy_central.items i where i.id=expense_row.item_id and i.company_id=actor_company and i.active;
        if source_item.id is null then raise exception 'active purchased item not found for %',expense_row.name; end if;
        select * into stock_item from boy_central.items i where i.id=coalesce(source_item.stock_target_item_id,source_item.id)
          and i.company_id=actor_company and i.active and i.track_stock;
        if stock_item.id is null then raise exception 'active stock target not found for %',expense_row.name; end if;
        resolved_unit_id:=coalesce(expense_row.purchase_unit_id,source_item.base_unit_id);
        resolved_conversion:=coalesce(expense_row.stock_conversion_to_base,1);
        if resolved_unit_id is null or resolved_conversion<=0 then raise exception 'stock mapping is incomplete for %',expense_row.name; end if;
        if not exists(select 1 from boy_central.item_units iu where iu.item_id=stock_item.id and iu.unit_id=resolved_unit_id and iu.active)
          then raise exception 'purchase unit is not configured for stock target %',stock_item.name; end if;
        resolved_line:=resolved_line||jsonb_build_object('item_id',stock_item.id,'unit_id',resolved_unit_id,'conversion_to_base',resolved_conversion);
      else resolved_line:=resolved_line-'item_id'-'unit_id'-'conversion_to_base'; end if;
    end if;
    resolved_lines:=resolved_lines||jsonb_build_array(resolved_line);
  end loop;
  resolved_payload:=jsonb_set(payload,'{lines}',resolved_lines,true)||jsonb_build_object('defer_stock',true);
  result:=boy_central.record_expense_v2(resolved_payload);
  target_transaction_id:=(result->>'transaction_id')::uuid;
  if result->>'status'<>'duplicate' then
    insert into boy_central.purchase_receipts(company_id,branch_id,transaction_id,created_by)
    select t.company_id,t.branch_id,t.id,actor_id from boy_central.transactions t
    where t.id=target_transaction_id and exists(select 1 from boy_central.transaction_lines tl
      join boy_central.items i on i.id=tl.item_id and i.track_stock where tl.transaction_id=t.id and tl.base_quantity>0)
    returning id into target_receipt_id;
    if target_receipt_id is not null then
      insert into boy_central.purchase_receipt_lines(company_id,branch_id,receipt_id,transaction_line_id,
        item_id,unit_id,quantity_expected,unit_cost_base,line_value)
      select t.company_id,t.branch_id,target_receipt_id,tl.id,tl.item_id,tl.unit_id,
        tl.base_quantity,coalesce(tl.unit_cost_base,0),tl.line_total
      from boy_central.transaction_lines tl join boy_central.transactions t on t.id=tl.transaction_id
      join boy_central.items i on i.id=tl.item_id and i.track_stock
      where tl.transaction_id=target_transaction_id and tl.base_quantity>0;
      get diagnostics pending_count=row_count;
    end if;
    if coalesce(payload->'payment'->>'method','')='reimbursement_pending' then
      update boy_central.payments set status='pending',paid_at=null,
        note=coalesce(note||' · ','')||'รอเบิกค่าใช้จ่าย'
      where transaction_id=target_transaction_id and method='reimbursement_pending';
    end if;
  end if;
  return result||jsonb_build_object('pending_receipt_id',target_receipt_id,'pending_item_count',pending_count);
end $function$;

revoke all on function boy_central_private.pending_receipts_json(uuid) from public,anon,authenticated;
revoke all on function boy_central_private.complete_purchase_receipt(uuid,uuid,uuid,uuid,uuid,text) from public,anon,authenticated;
revoke all on function boy_central.get_branch_pending_receipts(text) from public,anon;
revoke all on function boy_central.receive_purchase_receipt(uuid) from public,anon;
grant execute on function boy_central.get_branch_pending_receipts(text) to authenticated;
grant execute on function boy_central.receive_purchase_receipt(uuid) to authenticated;
revoke all on function boy_central.get_pos_device_pending_receipts(text) from public,anon,authenticated;
revoke all on function boy_central.receive_pos_device_purchase_receipt(text,uuid) from public,anon,authenticated;
revoke all on function public.pos_pending_receipts(text) from public;
revoke all on function public.pos_receive_purchase_receipt(text,uuid) from public;
grant execute on function public.pos_pending_receipts(text) to anon,authenticated;
grant execute on function public.pos_receive_purchase_receipt(text,uuid) to anon,authenticated;

notify pgrst,'reload schema';
