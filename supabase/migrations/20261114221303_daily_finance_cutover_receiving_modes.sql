-- New requests choose immediate receipt or delivery. Existing v3 clients keep
-- their original pending-receipt semantics, including their durable old queues.
create or replace function boy_central.record_expense_v4(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb; receipt uuid; row_ boy_central.purchase_receipts%rowtype;
 mode text:=payload->>'receiving_mode'; received jsonb;
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 if mode is null or mode not in ('immediate','delivery') then raise exception 'เลือกการรับสินค้า';end if;
 result:=boy_central.record_expense_v3(payload);
 if result->>'status'='duplicate' then return result;end if;
 receipt:=nullif(result->>'pending_receipt_id','')::uuid;
 if receipt is not null and mode='immediate' then
   select * into row_ from boy_central.purchase_receipts where id=receipt;
   if not boy_central_private.has_branch_access(row_.branch_id,array['admin','manager','staff']) then raise exception 'branch access denied';end if;
   received:=boy_central_private.complete_purchase_receipt(receipt,row_.company_id,row_.branch_id,auth.uid(),null,'boy_web_immediate');
   result:=result||jsonb_build_object('pending_receipt_id',null,'pending_item_count',0,'received_receipt_id',receipt);
 end if;
 return result||jsonb_build_object('receiving_mode',mode);
end $$;
revoke all on function boy_central.record_expense_v4(jsonb) from public,anon;
grant execute on function boy_central.record_expense_v4(jsonb) to authenticated;

-- Keep the prepared daily API, adding receiving mode per payment group and
-- preserving the expense UUID. No old transactions are rewritten by this patch.
do $patch$
declare definition text;
begin
 select pg_get_functiondef('boy_central.post_daily_document(jsonb)'::regprocedure) into definition;
 definition:=replace(definition,'cash numeric; transfer numeric; other numeric; mode text; role_name text;',
   'cash numeric; transfer numeric; other numeric; mode text; role_name text; receiving text;');
 definition:=replace(definition,
   'if exists(select 1 from boy_central.purchase_receipts where transaction_id=any(d.transaction_ids) and status=''received'') then',
   'if exists(select 1 from boy_central.purchase_receipts r join boy_central.purchase_receipt_lines l on l.receipt_id=r.id where r.transaction_id=any(d.transaction_ids) and l.quantity_received>0) and body->''exp'' is distinct from d.data->''exp'' then');
 -- Income-only corrections reuse already received expenses, without cancelling stock.
 definition:=replace(definition,' update boy_central.transactions set status=''voided''',
   ' if body->''exp'' is distinct from d.data->''exp'' or not d.submitted then'||chr(10)||' update boy_central.transactions set status=''voided''');
 definition:=replace(definition,
   ' for payment in select distinct coalesce(nullif(x->>''pay'',''''),''cash'') from jsonb_array_elements(coalesce(body->''exp'',''[]''))x loop',
   ' for receiving in select distinct coalesce(nullif(x->>''receiving_mode'',''''),''immediate'') from jsonb_array_elements(coalesce(body->''exp'',''[]''))x loop'||chr(10)||
   ' if receiving not in (''immediate'',''delivery'') then raise exception ''invalid receiving mode'';end if;'||chr(10)||
   ' for payment in select distinct coalesce(nullif(x->>''pay'',''''),''cash'') from jsonb_array_elements(coalesce(body->''exp'',''[]''))x where coalesce(nullif(x->>''receiving_mode'',''''),''immediate'')=receiving loop');
 definition:=replace(definition,
   'where coalesce(nullif(value->>''pay'',''''),''cash'')=payment loop',
   'where coalesce(nullif(value->>''pay'',''''),''cash'')=payment and coalesce(nullif(value->>''receiving_mode'',''''),''immediate'')=receiving loop');
 definition:=replace(definition,'''description'',entry->>''i'',''quantity''',
   '''expense_item_id'',nullif(entry->>''expense_item_id'','''')::uuid,''description'',entry->>''i'',''quantity''');
 definition:=replace(definition,'group_result:=boy_central.record_expense_v3(',
   'group_result:=boy_central.record_expense_v4(');
 definition:=replace(definition,'''idempotency_key'',request||'':''||payment,',
   '''receiving_mode'',receiving,''idempotency_key'',request||'':''||payment||'':''||receiving,');
 definition:=replace(definition,'''-''||payment,', '''-''||payment||''-''||receiving,');
 definition:=replace(definition,' end loop;'||chr(10)||' select p.mode into mode',
   ' end loop;'||chr(10)||' end loop;'||chr(10)||' else ids:=d.transaction_ids;end if;'||chr(10)||' select p.mode into mode');
 if position('record_expense_v4' in definition)=0 or position('else ids:=d.transaction_ids' in definition)=0 then raise exception 'daily receiving patch did not match';end if;
 execute definition;
end $patch$;

-- Ready links only: explicitly quarantined identities are not name-matched.
create or replace function boy_central.get_daily_catalog(target_branch_code text,known_version text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype; version text; result jsonb;
begin
 select * into b from boy_central.branches where code=target_branch_code and active;
 if auth.uid() is null or not boy_central_private.has_branch_access(b.id,null) then raise exception 'branch access denied';end if;
 select md5(concat((select max(updated_at) from boy_central.master_runtime_links where company_id=b.company_id),
  (select max(updated_at) from boy_central.items where company_id=b.company_id),
  (select max(updated_at) from boy_central.expense_items where company_id=b.company_id),
  (select max(updated_at) from boy_central.item_units where company_id=b.company_id),
  (select max(updated_at) from boy_central.categories where company_id=b.company_id),
  (select max(updated_at) from boy_central.suppliers where company_id=b.company_id),
  (select max(updated_at) from boy_central.item_suppliers where company_id=b.company_id))) into version;
 if version=known_version then return jsonb_build_object('version',version,'not_modified',true);end if;
 with ready as (
  select distinct i.id,i.code,i.name,i.category_id,i.base_unit_id,i.track_stock,null::uuid expense_item_id,
    true requires_quantity,true requires_unit from boy_central.items i
    where i.company_id=b.company_id and i.active and exists(select 1 from boy_central.master_runtime_links l where l.item_id=i.id and l.status='ready')
    and not exists(select 1 from boy_central.master_runtime_links l where l.item_id=i.id and l.status<>'ready')
  union all
  select distinct e.id,coalesce(l.source_data->>'item_id',e.code),e.name,e.category_id,null::uuid,false,e.id,e.requires_quantity,e.requires_unit
    from boy_central.expense_items e join boy_central.master_runtime_links l on l.expense_item_id=e.id and l.status='ready'
    where e.company_id=b.company_id and e.active
 )
 select jsonb_build_object('version',version,
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'code',i.code,'name',i.name,'expense_item_id',i.expense_item_id,
 'category_id',coalesce(c.parent_id,c.id),'main',coalesce(parent.name,c.name),'sub',case when c.parent_id is not null then c.name else '' end,
 'base_unit_id',i.base_unit_id,'track_stock',i.track_stock,'requires_quantity',i.requires_quantity,'requires_unit',i.requires_unit) order by i.name),'[]') from ready i left join boy_central.categories c on c.id=i.category_id left join boy_central.categories parent on parent.id=c.parent_id),
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from boy_central.units where company_id=b.company_id and active),
 'item_units',(select coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'unit_id',unit_id,'conversion',conversion_to_base,'purchase',allow_purchase)),'[]') from boy_central.item_units where company_id=b.company_id and active),
 'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'parent_id',parent_id)),'[]') from boy_central.categories where company_id=b.company_id and active),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from boy_central.suppliers where company_id=b.company_id and active),
 'item_suppliers',(select coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'supplier_id',supplier_id)),'[]') from boy_central.item_suppliers where company_id=b.company_id and active)) into result;
 return result;
end $$;
revoke all on function boy_central.get_daily_catalog(text,text) from public,anon;
grant execute on function boy_central.get_daily_catalog(text,text) to authenticated;

create table boy_central.daily_cutover_control(
 singleton boolean primary key default true check(singleton),active boolean not null default false,
 activated_at timestamptz,updated_at timestamptz not null default now());
alter table boy_central.daily_cutover_control enable row level security;
revoke all on boy_central.daily_cutover_control from public,anon,authenticated;
insert into boy_central.daily_cutover_control(singleton,active) values(true,false);
create function boy_central.daily_finance_active() returns boolean language sql stable security definer set search_path='' as $$
 select coalesce((select active from boy_central.daily_cutover_control where singleton),false)
$$;
revoke all on function boy_central.daily_finance_active() from public;
grant execute on function boy_central.daily_finance_active() to anon,authenticated;
create function public.daily_finance_active() returns boolean language sql stable security invoker set search_path='' as $$
 select boy_central.daily_finance_active()
$$;
revoke all on function public.daily_finance_active() from public;
grant execute on function public.daily_finance_active() to anon,authenticated;
notify pgrst,'reload schema';
