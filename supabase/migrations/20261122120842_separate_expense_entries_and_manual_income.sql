-- Applied migration version: 20261122120842.
-- One active entry workspace per branch; the selected posting date is part of
-- the draft, not its identity. Business transactions remain the source of truth.
create table boy_central.expense_entry_drafts(
 branch_id uuid primary key references boy_central.branches(id),
 company_id uuid not null references boy_central.companies(id),
 revision integer not null default 0,payload jsonb not null default '{}',
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now(),
 check(pg_column_size(payload)<240000));
create table boy_central.finance_entry_requests(
 request_id uuid primary key,company_id uuid not null references boy_central.companies(id),
 branch_id uuid not null references boy_central.branches(id),business_date date not null,
 kind text not null check(kind in('expense','income')),fingerprint text not null,result jsonb not null,
 created_by uuid not null references auth.users(id),created_at timestamptz not null default now());
create index finance_entry_requests_branch_date on boy_central.finance_entry_requests(branch_id,business_date,kind);
alter table boy_central.expense_entry_drafts enable row level security;
alter table boy_central.finance_entry_requests enable row level security;
-- Both tables are RPC-only, including defense in depth if grants change later.
create policy rpc_only on boy_central.expense_entry_drafts for all to authenticated using(false) with check(false);
create policy rpc_only on boy_central.finance_entry_requests for all to authenticated using(false) with check(false);
revoke all on boy_central.expense_entry_drafts,boy_central.finance_entry_requests from public,anon,authenticated;

create function boy_central_private.finance_entry_branch(code text) returns boy_central.branches
language plpgsql stable security definer set search_path='' as $$
declare b boy_central.branches%rowtype;
begin
 select * into b from boy_central.branches where branches.code=finance_entry_branch.code and active;
 if auth.uid() is null or b.id is null or not boy_central_private.has_branch_access(b.id,array['admin','manager','staff']) then raise exception 'ไม่มีสิทธิ์ใช้งานสาขานี้';end if;
 return b;
end $$;
revoke all on function boy_central_private.finance_entry_branch(text) from public,anon,authenticated;

create function boy_central_private.get_finance_entry_workspace(branch_code text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype;d boy_central.expense_entry_drafts%rowtype;
begin
 b:=boy_central_private.finance_entry_branch(branch_code);
 select * into d from boy_central.expense_entry_drafts where branch_id=b.id;
 return jsonb_build_object('branch_id',b.id,'revision',coalesce(d.revision,0),'data',coalesce(d.payload,'{}'),
  'revenue_mode',(select mode from boy_central.branch_revenue_policies where branch_id=b.id),
  'can_record_income',b.code<>'TAWANA' or boy_central_private.has_branch_access(b.id,array['admin','manager']));
end $$;

create function boy_central_private.save_finance_entry_draft(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype;d boy_central.expense_entry_drafts%rowtype;
begin
 b:=boy_central_private.finance_entry_branch(payload->>'branch_code');
 if jsonb_typeof(payload->'data') is distinct from 'object' or pg_column_size(payload->'data')>230000 then raise exception 'ร่างมีขนาดใหญ่เกินไป';end if;
 perform pg_advisory_xact_lock(hashtextextended('entry:'||b.id,0));
 insert into boy_central.expense_entry_drafts(branch_id,company_id) values(b.id,b.company_id) on conflict do nothing;
 select * into d from boy_central.expense_entry_drafts where branch_id=b.id for update;
 if d.revision<>coalesce((payload->>'expected_revision')::integer,0) then raise exception 'ร่างถูกแก้จากอีกเครื่อง กรุณาตรวจเทียบก่อนส่ง';end if;
 if d.payload is not distinct from payload->'data' then return jsonb_build_object('revision',d.revision);end if;
 update boy_central.expense_entry_drafts set payload=save_finance_entry_draft.payload->'data',revision=revision+1,updated_by=auth.uid(),updated_at=now() where branch_id=b.id returning * into d;
 return jsonb_build_object('revision',d.revision);
end $$;

create function boy_central_private.record_finance_expenses(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype;d boy_central.expense_entry_drafts%rowtype;r boy_central.finance_entry_requests%rowtype;
 request uuid:=(payload->>'request_id')::uuid;day date:=(payload->>'date')::date;fp text;result jsonb;
 group_ record;lines jsonb;line jsonb;ids jsonb:='[]';response jsonb;total numeric;unit_rate numeric;
begin
 b:=boy_central_private.finance_entry_branch(payload->>'branch_code');
 if request is null or day is null or jsonb_typeof(payload->'lines') is distinct from 'array' or jsonb_array_length(payload->'lines')=0 or pg_column_size(payload)>240000 then raise exception 'ระบุวันที่และรายการรายจ่าย';end if;
 fp:=md5(jsonb_build_object('date',day,'lines',payload->'lines')::text);
 perform pg_advisory_xact_lock(hashtextextended('entry:'||b.id,0));
 select * into r from boy_central.finance_entry_requests where request_id=request;
 if r.request_id is not null then
  if r.branch_id<>b.id or r.kind<>'expense' or r.fingerprint<>fp then raise exception 'รหัสคำขอซ้ำแต่ข้อมูลต่างกัน';end if;
  return r.result||jsonb_build_object('duplicate',true);
 end if;
 insert into boy_central.expense_entry_drafts(branch_id,company_id) values(b.id,b.company_id) on conflict do nothing;
 select * into d from boy_central.expense_entry_drafts where branch_id=b.id for update;
 if d.revision<>coalesce((payload->>'expected_revision')::integer,0) then raise exception 'ร่างถูกแก้จากอีกเครื่อง กรุณาตรวจเทียบก่อนส่ง';end if;
 for group_ in select coalesce(x->>'payment_method','cash') payment,coalesce(x->>'receiving_mode','immediate') receiving,coalesce(x->>'expense_class','operating') kind,
  jsonb_agg(x order by n) entries from jsonb_array_elements(payload->'lines') with ordinality t(x,n) group by 1,2,3 order by 1,2,3
 loop
  if group_.payment not in('cash','transfer','credit_card','reimbursement_pending') or group_.receiving not in('immediate','delivery') then raise exception 'เลือกช่องทางชำระเงินและการรับสินค้า';end if;
  lines:='[]';total:=0;
  for line in select value from jsonb_array_elements(group_.entries) loop
   if group_.kind<>'capital' and nullif(line->>'item_id','') is not null then
    select conversion_to_base into unit_rate from boy_central.item_units where item_id=(line->>'item_id')::uuid and unit_id=(line->>'unit_id')::uuid and active;
    if unit_rate is null or coalesce((line->>'quantity')::numeric,0)<=0 then raise exception 'ตรวจจำนวน หน่วยซื้อ และอัตราแปลง: %',line->>'description';end if;
    line:=line||jsonb_build_object('conversion_to_base',unit_rate);
   end if;
   total:=total+coalesce((line->>'line_total')::numeric,0);lines:=lines||jsonb_build_array(line);
  end loop;
  response:=boy_central.record_expense_v4(jsonb_build_object('branch_id',b.id,'transaction_date',day,'source_system','boy_expense_entry',
   'idempotency_key',request||':'||group_.payment||':'||group_.receiving||':'||group_.kind,'receiving_mode',group_.receiving,
   'payment',jsonb_build_object('method',group_.payment,'amount',total),'lines',lines));
  if nullif(response->>'transaction_id','') is null then raise exception 'ฐานกลางยังไม่ยืนยันรายการรายจ่าย';end if;
  ids:=ids||jsonb_build_array(response->>'transaction_id');
 end loop;
 update boy_central.expense_entry_drafts set payload='{}',revision=revision+1,updated_by=auth.uid(),updated_at=now() where branch_id=b.id returning * into d;
 result:=jsonb_build_object('status','Success','transaction_ids',ids,'draft_revision',d.revision,'mirror_pending',true);
 insert into boy_central.finance_entry_requests values(request,b.company_id,b.id,day,'expense',fp,result,auth.uid(),now());
 return result;
end $$;

create function boy_central_private.get_branch_finance_day(branch_code text,target_date date) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype;result jsonb;
begin
 b:=boy_central_private.finance_entry_branch(branch_code);
 if target_date is null then raise exception 'เลือกวันที่';end if;
 select jsonb_build_object('date',target_date,'revenue_mode',(select mode from boy_central.branch_revenue_policies where branch_id=b.id),
  'can_record_income',b.code<>'TAWANA' or boy_central_private.has_branch_access(b.id,array['admin','manager']),
  'income',(select to_jsonb(c) from boy_central.financial_closes c where branch_id=b.id and business_date=target_date and source_type='manual'),
  'pos_income',(select coalesce(sum(cash+transfer+government+other),0) from boy_central.financial_closes where branch_id=b.id and business_date=target_date and source_type='pos_shift'),
  'expenses',coalesce((select jsonb_agg(x order by x.created_at desc) from(
   select t.id,t.total_amount,t.status,t.created_at,t.accounting_class,
    (select jsonb_agg(jsonb_build_object('description',l.description,'quantity',l.quantity,'unit',u.name,'amount',l.line_total,'supplier',coalesce(s.name,l.supplier_name_raw)) order by l.line_no)
     from boy_central.transaction_lines l left join boy_central.units u on u.id=l.unit_id left join boy_central.suppliers s on s.id=l.supplier_id where l.transaction_id=t.id) lines,
    (select string_agg(distinct p.method,',') from boy_central.payments p where p.transaction_id=t.id) payment_method,
    (select status from boy_central.purchase_receipts where transaction_id=t.id limit 1) receiving_status
   from boy_central.transactions t where t.branch_id=b.id and t.transaction_date=target_date and t.transaction_type='expense'
   order by t.created_at desc)x),'[]')) into result;
 return result;
end $$;

create function boy_central_private.save_branch_manual_income(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype;c boy_central.financial_closes%rowtype;r boy_central.finance_entry_requests%rowtype;
 day date:=(payload->>'date')::date;request uuid:=(payload->>'request_id')::uuid;v_cash numeric;v_transfer numeric;v_government numeric;v_other numeric;fp text;result jsonb;
begin
 b:=boy_central_private.finance_entry_branch(payload->>'branch_code');
 if (select mode from boy_central.branch_revenue_policies where branch_id=b.id) is distinct from 'manual' then raise exception 'สาขานี้ใช้รายรับจาก POS';end if;
 if b.code='TAWANA' and not boy_central_private.has_branch_access(b.id,array['admin','manager']) then raise exception 'เฉพาะเจ้าของหรือผู้จัดการที่บันทึกรายรับทาวน่า';end if;
 if day is null or request is null then raise exception 'เลือกวันที่';end if;
 v_cash:=coalesce((payload->>'cash')::numeric,0);v_transfer:=coalesce((payload->>'transfer')::numeric,0);v_government:=coalesce((payload->>'government')::numeric,0);v_other:=coalesce((payload->>'other')::numeric,0);
 if least(v_cash,v_transfer,v_government,v_other)<0 then raise exception 'รายรับต้องไม่ติดลบ';end if;
 v_cash:=round(v_cash,2);v_transfer:=round(v_transfer,2);v_government:=round(v_government,2);v_other:=round(v_other,2);
 fp:=md5(jsonb_build_array(day,v_cash,v_transfer,v_government,v_other)::text);
 perform pg_advisory_xact_lock(hashtextextended('daily:'||b.id||':'||day,0));
 select * into r from boy_central.finance_entry_requests where request_id=request;
 if r.request_id is not null then
  if r.branch_id<>b.id or r.kind<>'income' or r.fingerprint<>fp then raise exception 'รหัสคำขอซ้ำแต่ข้อมูลต่างกัน';end if;
  return r.result||jsonb_build_object('duplicate',true);
 end if;
 select * into c from boy_central.financial_closes where branch_id=b.id and business_date=day and source_type='manual' and source_key=day::text for update;
 if coalesce(c.revision,0)<>coalesce((payload->>'expected_revision')::integer,0) then raise exception 'รายรับถูกแก้จากอีกเครื่อง กรุณาโหลดใหม่ก่อนแก้ไข';end if;
 if c.id is null then
  insert into boy_central.financial_closes(company_id,branch_id,business_date,source_type,source_key,cash,transfer,government,other,fingerprint)
   values(b.company_id,b.id,day,'manual',day::text,v_cash,v_transfer,v_government,v_other,fp) returning * into c;
 elsif c.fingerprint<>fp then
  update boy_central.financial_closes set cash=v_cash,transfer=v_transfer,
   government=v_government,other=v_other,fingerprint=fp,revision=revision+1,updated_at=now() where id=c.id returning * into c;
 end if;
 result:=jsonb_build_object('status','Success','income',to_jsonb(c),'mirror_pending',true);
 insert into boy_central.finance_entry_requests values(request,b.company_id,b.id,day,'income',fp,result,auth.uid(),now());
 return result;
end $$;

-- The private implementations contain all authorization checks. No direct table
-- access, new anonymous endpoint, service key or Sheet fallback is introduced.
do $api$ declare name text;signature text;args text;begin
 foreach name in array array['get_finance_entry_workspace','save_finance_entry_draft','record_finance_expenses','get_branch_finance_day','save_branch_manual_income'] loop
  signature:=case name when 'get_finance_entry_workspace' then 'branch_code text' when 'get_branch_finance_day' then 'branch_code text,target_date date' else 'payload jsonb' end;
  args:=case name when 'get_finance_entry_workspace' then 'branch_code' when 'get_branch_finance_day' then 'branch_code,target_date' else 'payload' end;
  execute format('revoke all on function boy_central_private.%I(%s) from public,anon',name,signature);
  execute format('grant execute on function boy_central_private.%I(%s) to authenticated',name,signature);
  execute format('create function boy_central.%I(%s) returns jsonb language sql security invoker set search_path='''' as $fn$select boy_central_private.%I(%s)$fn$',name,signature,name,args);
  execute format('revoke all on function boy_central.%I(%s) from public,anon',name,signature);
  execute format('grant execute on function boy_central.%I(%s) to authenticated',name,signature);
 end loop;
end $api$;

-- A legacy queued daily purchase may finish, but must not overwrite income that
-- was explicitly saved via the independent income form afterwards.
do $patch$ declare definition text;needle text;begin
 definition:=pg_get_functiondef('boy_central.post_daily_document(jsonb)'::regprocedure);
 needle:='if b.code=''TAWANA'' and mode=''manual'' then';
 if strpos(definition,needle)=0 then raise exception 'Legacy daily income block changed';end if;
 definition:=replace(definition,needle,'if b.code=''TAWANA'' and mode=''manual'' and not exists(select 1 from boy_central.finance_entry_requests where branch_id=b.id and business_date=target_date and kind=''income'') then');
 execute definition;
end $patch$;
