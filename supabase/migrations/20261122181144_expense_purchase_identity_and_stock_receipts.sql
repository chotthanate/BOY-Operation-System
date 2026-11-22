-- Applied migration version: 20261122181144.
-- Current purchased SKU and stock destination are different identities.
-- Keep both. No prior purchase, draft or inventory balance is rewritten.
alter table boy_central.transaction_lines add column purchased_item_id uuid references boy_central.items(id);
create index transaction_lines_purchased_item_id_idx on boy_central.transaction_lines(purchased_item_id) where purchased_item_id is not null;
create function boy_central_private.check_purchased_item_company() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.purchased_item_id is not null and not exists(select 1 from boy_central.items i where i.id=new.purchased_item_id and i.company_id=new.company_id) then
  raise exception 'Purchased item belongs to another company';
 end if;
 return new;
end $$;
revoke all on function boy_central_private.check_purchased_item_company() from public,anon,authenticated;
create trigger check_purchased_item_company before insert or update of purchased_item_id,company_id on boy_central.transaction_lines
 for each row execute function boy_central_private.check_purchased_item_company();

-- Called only by the already authorized expense writer, never directly by clients.
create function boy_central_private.resolve_direct_purchase_line(entry jsonb,company uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare source boy_central.items%rowtype;target boy_central.items%rowtype;chosen_unit uuid;
 source_rate numeric;stock_rate numeric;ratio numeric;ratio_count integer;
begin
 select * into source from boy_central.items where id=(entry->>'item_id')::uuid and company_id=company and active;
 if source.id is null then raise exception 'Active purchased item not found';end if;
 if source.item_type in('EXPENSE_ITEM','SERVICE') and not source.track_stock and source.stock_target_item_id is null then return entry;end if;
 if coalesce((entry->>'quantity')::numeric,0)<=0 then raise exception 'กรอกจำนวนสินค้า: %',source.name;end if;
 chosen_unit:=nullif(entry->>'unit_id','')::uuid;
 select conversion_to_base into source_rate from boy_central.item_units
  where item_id=source.id and unit_id=chosen_unit and company_id=company and active;
 if chosen_unit is null or source_rate is null or source_rate<=0 then raise exception 'เลือกหน่วยซื้อที่ตั้งค่าไว้: %',source.name;end if;
 select * into target from boy_central.items where id=coalesce(source.stock_target_item_id,source.id) and company_id=company and active;
 if target.id is null or (source.stock_target_item_id is not null and (not target.track_stock or target.stock_target_item_id is not null)) then
  raise exception 'ตรวจการผูกสต็อกรวม: %',source.name;
 end if;
 stock_rate:=source_rate;
 if target.id<>source.id and chosen_unit=target.base_unit_id then
  -- Receiving in the pool's own base unit is already a base-unit count.
  stock_rate:=1;
 elsif target.id<>source.id and target.base_unit_id is distinct from source.base_unit_id then
  -- Existing explicit purchase-to-pool mappings define cross-base conversion.
  -- A shared unit means a true 1:1 base; do not reuse stale pack multipliers.
  select count(distinct e.stock_conversion_to_base/iu.conversion_to_base),min(e.stock_conversion_to_base/iu.conversion_to_base)
   into ratio_count,ratio from boy_central.expense_items e join boy_central.item_units iu
    on iu.item_id=source.id and iu.company_id=company and iu.unit_id=e.purchase_unit_id and iu.active and iu.conversion_to_base>0
   where e.company_id=company and e.item_id=source.id and e.active and e.affects_stock and e.stock_conversion_to_base>0;
  if ratio_count<>1 or ratio is null then raise exception 'ยังไม่มีอัตราแปลงเข้าสต็อกรวมที่ชัดเจน: %',source.name;end if;
  stock_rate:=source_rate*ratio;
 end if;
 return entry||jsonb_build_object('item_id',target.id,'purchased_item_id',source.id,'unit_id',chosen_unit,'conversion_to_base',stock_rate);
end $$;
revoke all on function boy_central_private.resolve_direct_purchase_line(jsonb,uuid) from public,anon,authenticated;

do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('boy_central.record_expense(jsonb)'::regprocedure);
 needle:='line_no, item_id, expense_item_id, supplier_id';
 if strpos(d,needle)=0 then raise exception 'Expense line columns changed';end if;
 d:=replace(d,needle,'line_no, item_id, purchased_item_id, expense_item_id, supplier_id');
 needle:='target_item.id,'||chr(10)||'      nullif(line->>''expense_item_id'', '''')::uuid,';
 if strpos(d,needle)=0 then raise exception 'Expense line values changed';end if;
 d:=replace(d,needle,'target_item.id,'||chr(10)||'      nullif(line->>''purchased_item_id'', '''')::uuid,'||chr(10)||'      nullif(line->>''expense_item_id'', '''')::uuid,');
 execute d;
 d:=pg_get_functiondef('boy_central.record_expense_v3(jsonb)'::regprocedure);
 needle:='if expense_row.affects_stock then';
 if strpos(d,needle)=0 then raise exception 'Mapped stock validation changed';end if;
 d:=replace(d,needle,needle||chr(10)||'        if coalesce((line->>''quantity'')::numeric,0)<=0 then raise exception ''กรอกจำนวนสินค้า: %'',expense_row.name;end if;');
 needle:='resolved_lines:=resolved_lines||jsonb_build_array(resolved_line);';
 if strpos(d,needle)=0 then raise exception 'Expense resolver changed';end if;
 d:=replace(d,needle,$new$
 if nullif(line->>'expense_item_id','') is null and nullif(line->>'item_id','') is not null then
  resolved_line:=boy_central_private.resolve_direct_purchase_line(line,actor_company);
 elsif expense_row.id is not null and expense_row.affects_stock then
  resolved_line:=resolved_line||jsonb_build_object('purchased_item_id',source_item.id);
 end if;
 resolved_lines:=resolved_lines||jsonb_build_array(resolved_line);$new$);
 execute d;
end $patch$;

-- New common-form requests must explicitly distinguish a generic cost from a
-- linked product. Known successful requests still deduplicate before this loop.
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('boy_central_private.record_finance_expenses(jsonb)'::regprocedure);
 needle:='for line in select value from jsonb_array_elements(group_.entries) loop';
 if strpos(d,needle)=0 then raise exception 'Common expense validation changed';end if;
 d:=replace(d,needle,needle||$new$
   if group_.kind<>'capital' and nullif(line->>'item_id','') is null and nullif(line->>'expense_item_id','') is null
    and not coalesce((line->>'custom_expense')::boolean,false) then
    raise exception 'เลือกสินค้า หรือยืนยันใช้เป็นรายจ่ายทั่วไป: %',line->>'description';
   end if;
 $new$);
 execute d;
end $patch$;

-- Enrich only the already-authorized/UUID-ready catalog, without adding another
-- request or exposing quarantined aliases. Source stock flags stay unchanged.
do $patch$ declare d text;needle text;begin
 d:=pg_get_functiondef('boy_central.get_daily_catalog(text,text)'::regprocedure);
 needle:=' return result;';
 if strpos(d,needle)=0 then raise exception 'Daily catalog return changed';end if;
 d:=replace(d,needle,$new$
 result:=jsonb_set(result,'{items}',coalesce((select jsonb_agg(x||jsonb_build_object(
  'is_physical',case when i.id is not null then i.item_type not in('EXPENSE_ITEM','SERVICE') or i.track_stock or i.stock_target_item_id is not null else coalesce(e.affects_stock,false) end,
  'purchased_item_id',coalesce(i.id,e.item_id),
  'purchase_unit_id',coalesce(
    (select bi.default_purchase_unit_id from boy_central.branch_items bi join boy_central.item_units iu on iu.item_id=bi.item_id and iu.unit_id=bi.default_purchase_unit_id and iu.active and iu.allow_purchase where bi.branch_id=b.id and bi.item_id=i.id and bi.active limit 1),
    e.purchase_unit_id,
    (select iu.unit_id from boy_central.item_units iu where iu.item_id=i.id and iu.active and iu.allow_purchase order by iu.is_base_unit,iu.created_at,iu.id limit 1)),
  'stock_target_item_id',case when target.track_stock and target.active then target.id else null end,
  'stock_target_name',case when target.track_stock and target.active then target.name else null end,
  'stock_base_unit_id',target.base_unit_id
 ) order by x->>'name') from jsonb_array_elements(result->'items')x
  left join boy_central.items i on i.id=(x->>'id')::uuid and nullif(x->>'expense_item_id','') is null
  left join boy_central.expense_items e on e.id=nullif(x->>'expense_item_id','')::uuid
  left join boy_central.items source on source.id=coalesce(i.id,e.item_id) and source.company_id=b.company_id
  left join boy_central.items target on target.id=coalesce(source.stock_target_item_id,source.id) and target.company_id=b.company_id),'[]'));
 return result;$new$);
 d:=replace(d,'concat(''daily-catalog-v4'',','concat(''daily-catalog-v5-purchases'',b.id,(select max(updated_at) from boy_central.branch_items where branch_id=b.id),');
 execute d;
end $patch$;
