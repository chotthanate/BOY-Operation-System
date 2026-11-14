create table boy_central.branch_revenue_policies(
 branch_id uuid primary key references boy_central.branches(id),
 mode text not null check(mode in ('manual','pos_shift')),effective_date date not null,
 updated_at timestamptz not null default now());
insert into boy_central.branch_revenue_policies(branch_id,mode,effective_date)
select id,case when code in ('TAWANA','BIGC-CENTRAL-PATTAYA') then 'manual' else 'pos_shift' end,
 case when code in ('TAWANA','BIGC-CENTRAL-PATTAYA') then (now() at time zone 'Asia/Bangkok')::date else '2099-12-31'::date end from boy_central.branches where active;

create table boy_central.daily_documents(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references boy_central.companies(id),
 branch_id uuid not null references boy_central.branches(id),business_date date not null,
 revision integer not null default 0, data jsonb not null default '{}',fingerprint text,
 transaction_ids uuid[] not null default '{}',submitted boolean not null default false,
 updated_by uuid references auth.users(id),updated_at timestamptz not null default now(),
 unique(branch_id,business_date),check(pg_column_size(data)<250000));
create table boy_central.daily_drafts(
 company_id uuid not null references boy_central.companies(id),branch_id uuid not null references boy_central.branches(id),
 business_date date not null,user_id uuid not null references auth.users(id),data jsonb not null,
 revision integer not null default 1,updated_at timestamptz not null default now(),
 primary key(branch_id,business_date,user_id),check(pg_column_size(data)<250000));
create table boy_central.financial_closes(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references boy_central.companies(id),
 branch_id uuid not null references boy_central.branches(id),business_date date not null,
 source_type text not null check(source_type in ('manual','pos_shift')),source_key text not null,
 cash numeric(18,2) not null default 0,transfer numeric(18,2) not null default 0,
 government numeric(18,2) not null default 0,other numeric(18,2) not null default 0,
 order_count integer,revision integer not null default 1,fingerprint text not null,
 updated_at timestamptz not null default now(),unique(branch_id,source_type,source_key),
 check(cash>=0 and transfer>=0 and government>=0 and other>=0));
create index financial_closes_branch_date on boy_central.financial_closes(branch_id,business_date);
create table boy_central.mirror_jobs(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references boy_central.companies(id),
 branch_id uuid not null references boy_central.branches(id),entity_type text not null,
 entity_id uuid not null,revision text not null,status text not null default 'pending'
 check(status in ('pending','processing','synced','error')),attempts integer not null default 0,
 available_at timestamptz not null default now(),lease_until timestamptz,last_error text,
 created_at timestamptz not null default now(),synced_at timestamptz,
 unique(entity_type,entity_id,revision));
create index mirror_jobs_due on boy_central.mirror_jobs(available_at) where status in ('pending','error','processing');
create table boy_central.daily_requests(
 request_id uuid primary key,company_id uuid not null references boy_central.companies(id),
 document_id uuid not null references boy_central.daily_documents(id),fingerprint text not null,
 result jsonb not null,created_at timestamptz not null default now());
create table boy_central.financial_revisions(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references boy_central.companies(id),
 branch_id uuid not null references boy_central.branches(id),entity_type text not null,entity_id uuid not null,
 revision integer not null,data jsonb not null,changed_by uuid references auth.users(id),changed_at timestamptz not null default now(),
 unique(entity_type,entity_id,revision));

do $$declare t text;begin
 foreach t in array array['branch_revenue_policies','daily_documents','daily_drafts','financial_closes','mirror_jobs','daily_requests','financial_revisions'] loop
 execute format('alter table boy_central.%I enable row level security',t);
 execute format('revoke all on boy_central.%I from public,anon,authenticated',t);
 end loop;end $$;
create policy revenue_policy_read on boy_central.branch_revenue_policies for select to authenticated using(boy_central_private.has_branch_access(branch_id,null));
grant select on boy_central.branch_revenue_policies to authenticated;

create function boy_central_private.financial_revision_audit() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.revision>0 and old.revision is distinct from new.revision then
 insert into boy_central.financial_revisions(company_id,branch_id,entity_type,entity_id,revision,data,changed_by)
 values(old.company_id,old.branch_id,TG_TABLE_NAME,old.id,old.revision,to_jsonb(old),auth.uid()) on conflict do nothing;
 end if;return new;
end $$;
create trigger daily_document_audit before update on boy_central.daily_documents for each row execute function boy_central_private.financial_revision_audit();
create trigger financial_close_audit before update on boy_central.financial_closes for each row execute function boy_central_private.financial_revision_audit();
revoke all on function boy_central_private.financial_revision_audit() from public,anon,authenticated;

create function boy_central_private.queue_mirror(company uuid,branch uuid,kind text,entity uuid,version text)
returns void language sql security definer set search_path='' as $$
 insert into boy_central.mirror_jobs(company_id,branch_id,entity_type,entity_id,revision)
 values(company,branch,kind,entity,version) on conflict do nothing
$$;
revoke all on function boy_central_private.queue_mirror(uuid,uuid,text,uuid,text) from public,anon,authenticated;

create function boy_central.get_daily_document(target_branch_code text,target_date date)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype; d boy_central.daily_documents%rowtype; draft boy_central.daily_drafts%rowtype;
begin
 select * into b from boy_central.branches where code=target_branch_code and active;
 if auth.uid() is null or not boy_central_private.has_branch_access(b.id,null) then raise exception 'branch access denied';end if;
 select * into d from boy_central.daily_documents where branch_id=b.id and business_date=target_date;
 select * into draft from boy_central.daily_drafts where branch_id=b.id and business_date=target_date and user_id=auth.uid();
 return jsonb_build_object('status','success','document_id',d.id,'revision',coalesce(d.revision,0),
 'draft_revision',coalesce(draft.revision,0),'draft',coalesce(case when d.id is null or draft.updated_at>d.updated_at then draft.data end,d.data,'{}')::text,
 'submitted',coalesce(d.submitted,false),'revenue_mode',(select mode from boy_central.branch_revenue_policies where branch_id=b.id),
 'mirror_pending',(select count(*) from boy_central.mirror_jobs where entity_id=d.id and status<>'synced'));
end $$;
create function boy_central.save_daily_draft(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype; r integer;
begin
 select * into b from boy_central.branches where code=payload->>'branch_code' and active;
 if auth.uid() is null or not boy_central_private.has_branch_access(b.id,array['admin','manager','staff']) then raise exception 'branch access denied';end if;
 if pg_column_size(payload->'data')>240000 then raise exception 'document too large';end if;
 if coalesce((select revision from boy_central.daily_documents where branch_id=b.id and business_date=(payload->>'business_date')::date),0)<>coalesce((payload->>'expected_document_revision')::integer,0) then raise exception 'document conflict: reload before saving a draft';end if;
 insert into boy_central.daily_drafts(company_id,branch_id,business_date,user_id,data)
 values(b.company_id,b.id,(payload->>'business_date')::date,auth.uid(),payload->'data')
 on conflict(branch_id,business_date,user_id) do update set data=excluded.data,revision=daily_drafts.revision+1,updated_at=now()
 where daily_drafts.revision=coalesce((payload->>'expected_revision')::integer,0)
 returning revision into r;
 if r is null then raise exception 'draft conflict: another device has changed this draft';end if;
 return jsonb_build_object('status','saved','revision',r);
end $$;

create function boy_central.post_daily_document(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype; d boy_central.daily_documents%rowtype; previous boy_central.daily_requests%rowtype;
 body jsonb:=payload->'data'; fp text; request uuid:=(payload->>'request_id')::uuid; result jsonb;
 entry jsonb; line jsonb; lines jsonb; payment text; target_date date:=(payload->>'business_date')::date;
 ids uuid[]:='{}'; group_result jsonb; category uuid; item uuid; unit uuid; conversion numeric; total numeric;
 cash numeric; transfer numeric; other numeric; mode text; role_name text;
begin
 select * into b from boy_central.branches where code=payload->>'branch_code' and active;
 if auth.uid() is null or not boy_central_private.has_branch_access(b.id,array['admin','manager','staff']) then raise exception 'branch access denied';end if;
 if b.code not in ('TAWANA','BIGC-CENTRAL-PATTAYA') then raise exception 'unsupported legacy daily branch';end if;
 if b.code='TAWANA' and not boy_central_private.has_branch_access(b.id,array['admin','manager']) then raise exception 'owner or manager required for Tawana daily close';end if;
 if target_date is null or body is null or jsonb_typeof(body)<>'object' or pg_column_size(body)>240000 then raise exception 'invalid daily document';end if;
 fp:=md5(body::text);
 perform pg_advisory_xact_lock(hashtextextended('daily:'||b.id||':'||target_date,0));
 select * into previous from boy_central.daily_requests where request_id=request;
 if previous.request_id is not null then
   if previous.company_id<>b.company_id or previous.fingerprint<>fp or not exists(select 1 from boy_central.daily_documents where id=previous.document_id and branch_id=b.id and business_date=target_date) then raise exception 'request ID reused with different data';end if;
   return previous.result||jsonb_build_object('duplicate',true);
 end if;
 insert into boy_central.daily_documents(company_id,branch_id,business_date) values(b.company_id,b.id,target_date) on conflict do nothing;
 select * into d from boy_central.daily_documents where branch_id=b.id and business_date=target_date for update;
 if d.revision<>coalesce((payload->>'expected_revision')::integer,0) then raise exception 'document conflict: reload and compare before saving';end if;
 if d.fingerprint=fp and d.submitted then
  result:=jsonb_build_object('status','Success','document_id',d.id,'revision',d.revision,'duplicate',true,'mirror_pending',true);
  insert into boy_central.daily_requests values(request,b.company_id,d.id,fp,result,now()); return result;
 end if;
 if exists(select 1 from boy_central.purchase_receipts where transaction_id=any(d.transaction_ids) and status='received') then
   raise exception 'received purchase cannot be replaced; use a stock/cost adjustment';end if;
 update boy_central.transactions set status='voided',void_reason='แก้ไขเอกสารรายวัน',updated_by=auth.uid(),updated_at=now() where id=any(d.transaction_ids) and status='confirmed';
 update boy_central.purchase_receipts set status='cancelled',updated_at=now() where transaction_id=any(d.transaction_ids) and status='pending';
 update boy_central.purchase_receipt_lines set status='cancelled' where receipt_id in(select id from boy_central.purchase_receipts where transaction_id=any(d.transaction_ids) and status='cancelled');
 for payment in select distinct coalesce(nullif(x->>'pay',''),'cash') from jsonb_array_elements(coalesce(body->'exp','[]'))x loop
   if payment not in ('cash','transfer','credit_card','reimbursement_pending') then raise exception 'invalid payment method';end if;
   lines:='[]'; total:=0;
   for entry in select value from jsonb_array_elements(body->'exp') where coalesce(nullif(value->>'pay',''),'cash')=payment loop
     if trim(coalesce(entry->>'i',''))='' or coalesce(nullif(entry->>'p','')::numeric,0)<=0 then raise exception 'expense name and positive amount required';end if;
     item:=nullif(entry->>'item_id','')::uuid; category:=nullif(entry->>'category_id','')::uuid; unit:=nullif(entry->>'unit_id','')::uuid;
     if category is null then
      select id into category from boy_central.categories where company_id=b.company_id and active and parent_id is null and category_type='item' and name=entry->>'m' and code~'^CAT-[0-9]+$';
     end if;
     if category is null then raise exception 'เลือกหมวดหลักให้ครบ: %',entry->>'i';end if;
     if nullif(entry->>'master_code','') is not null and item is null then raise exception 'สินค้ายังไม่เชื่อมรหัสกลาง: %',entry->>'i';end if;
     if item is not null then
       if not exists(select 1 from boy_central.items where id=item and company_id=b.company_id and active) then raise exception 'item identity not found';end if;
       if coalesce(nullif(entry->>'q','')::numeric,0)<=0 then raise exception 'กรอกจำนวนที่ซื้อ: %',entry->>'i';end if;
       if unit is null then raise exception 'เลือกหน่วยซื้อให้ครบ: %',entry->>'i';end if;
       select conversion_to_base into conversion from boy_central.item_units where item_id=item and unit_id=unit and active;
       if conversion is null then raise exception 'หน่วยนี้ยังไม่มีอัตราแปลง: %',entry->>'i';end if;
     else conversion:=1;end if;
     line:=jsonb_build_object('item_id',item,'category_id',category,'unit_id',unit,'conversion_to_base',conversion,
       'description',entry->>'i','quantity',coalesce(nullif(entry->>'q','')::numeric,0),'line_total',(entry->>'p')::numeric,
       'supplier_name',nullif(entry->>'s',''),'note',nullif(entry->>'n',''));
     lines:=lines||jsonb_build_array(line); total:=total+(entry->>'p')::numeric;
   end loop;
   group_result:=boy_central.record_expense_v3(jsonb_build_object('branch_id',b.id,'transaction_date',target_date,
    'source_system','boy_daily_web','transaction_no','DLY-'||d.id||'-'||(d.revision+1)||'-'||payment,
    'idempotency_key',request||':'||payment,'payment',jsonb_build_object('method',payment,'amount',total),'lines',lines));
   ids:=array_append(ids,(group_result->>'transaction_id')::uuid);
 end loop;
 select p.mode into mode from boy_central.branch_revenue_policies p where branch_id=b.id;
 if b.code='TAWANA' and mode='manual' then
   cash:=coalesce(nullif(body#>>'{cash,v}','')::numeric,0);transfer:=coalesce(nullif(body#>>'{transfer,v}','')::numeric,0);other:=coalesce(nullif(body#>>'{other,v}','')::numeric,0);
   insert into boy_central.financial_closes(company_id,branch_id,business_date,source_type,source_key,cash,transfer,other,fingerprint)
   values(b.company_id,b.id,target_date,'manual',target_date::text,cash,transfer,other,md5(jsonb_build_array(cash,transfer,other)::text))
   on conflict(branch_id,source_type,source_key) do update set cash=excluded.cash,transfer=excluded.transfer,other=excluded.other,fingerprint=excluded.fingerprint,revision=financial_closes.revision+1,updated_at=now();
 end if;
 update boy_central.daily_documents set data=body,revision=revision+1,fingerprint=fp,transaction_ids=ids,submitted=true,updated_by=auth.uid(),updated_at=now() where id=d.id returning * into d;
 delete from boy_central.daily_drafts where branch_id=b.id and business_date=target_date and user_id=auth.uid();
 perform boy_central_private.queue_mirror(b.company_id,b.id,'daily_document',d.id,d.revision::text);
 result:=jsonb_build_object('status','Success','document_id',d.id,'revision',d.revision,'mirror_pending',true,'stockWarnings','[]'::jsonb);
 insert into boy_central.daily_requests values(request,b.company_id,d.id,fp,result,now());
 return result;
end $$;

create function boy_central.get_daily_catalog(target_branch_code text,known_version text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype; version text; result jsonb;
begin
 select * into b from boy_central.branches where code=target_branch_code and active;
 if auth.uid() is null or not boy_central_private.has_branch_access(b.id,null) then raise exception 'branch access denied';end if;
 select md5(concat((select max(updated_at) from boy_central.items where company_id=b.company_id),(select max(updated_at) from boy_central.categories where company_id=b.company_id),(select max(updated_at) from boy_central.item_units where company_id=b.company_id),(select max(updated_at) from boy_central.units where company_id=b.company_id),(select max(updated_at) from boy_central.suppliers where company_id=b.company_id),(select max(updated_at) from boy_central.item_suppliers where company_id=b.company_id))) into version;
 if version=known_version then return jsonb_build_object('version',version,'not_modified',true);end if;
 select jsonb_build_object('version',version,
 'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'code',i.code,'name',i.name,'category_id',coalesce(c.parent_id,c.id),'main',coalesce(parent.name,c.name),'sub',case when c.parent_id is not null then c.name else '' end,'base_unit_id',i.base_unit_id,'track_stock',i.track_stock)),'[]') from boy_central.items i left join boy_central.categories c on c.id=i.category_id left join boy_central.categories parent on parent.id=c.parent_id where i.company_id=b.company_id and i.active),
 'units',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from boy_central.units where company_id=b.company_id and active),
 'item_units',(select coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'unit_id',unit_id,'conversion',conversion_to_base,'purchase',allow_purchase)),'[]') from boy_central.item_units where company_id=b.company_id and active),
 'categories',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'parent_id',parent_id)),'[]') from boy_central.categories where company_id=b.company_id and category_type='item' and active),
 'suppliers',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name)),'[]') from boy_central.suppliers where company_id=b.company_id and active),
 'item_suppliers',(select coalesce(jsonb_agg(jsonb_build_object('item_id',item_id,'supplier_id',supplier_id)),'[]') from boy_central.item_suppliers where company_id=b.company_id and active)) into result;
 return result;
end $$;

create function boy_central.get_daily_history(target_branch_code text,before_date date default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype; result jsonb;
begin
 select * into b from boy_central.branches where code=target_branch_code and active;
 if auth.uid() is null or not boy_central_private.has_branch_access(b.id,null) then raise exception 'branch access denied';end if;
 select jsonb_build_object('rows',coalesce(jsonb_agg(to_jsonb(t)),'[]')) into result from(
 select * from(
 select transaction_date date,transaction_type type,total_amount amount,status from boy_central.transactions
 where branch_id=b.id and (before_date is null or transaction_date<before_date)
 union all select business_date,'income',cash+transfer+government+other,'confirmed' from boy_central.financial_closes
 where branch_id=b.id and (before_date is null or business_date<before_date)
 ) history_rows order by date desc limit 50)t;
 return result;
end $$;

create function boy_central_private.financial_close_mirror() returns trigger language plpgsql security definer set search_path='' as $$
begin perform boy_central_private.queue_mirror(new.company_id,new.branch_id,'financial_close',new.id,new.revision::text);return new;end $$;
create trigger financial_close_mirror after insert or update on boy_central.financial_closes for each row execute function boy_central_private.financial_close_mirror();
create function boy_central_private.transaction_mirror() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.transaction_type in ('expense','income') then
 perform boy_central_private.queue_mirror(new.company_id,new.branch_id,'transaction',new.id,extract(epoch from new.updated_at)::text);end if;return new;
end $$;
create trigger canonical_transaction_mirror after insert or update of status,total_amount on boy_central.transactions for each row execute function boy_central_private.transaction_mirror();

do $$declare signature text;begin
 foreach signature in array array['get_daily_document(text,date)','save_daily_draft(jsonb)','post_daily_document(jsonb)','get_daily_catalog(text,text)','get_daily_history(text,date)'] loop
 execute 'revoke all on function boy_central.'||signature||' from public,anon';execute 'grant execute on function boy_central.'||signature||' to authenticated';end loop;end $$;
revoke all on function boy_central_private.financial_close_mirror(),boy_central_private.transaction_mirror() from public,anon,authenticated;
notify pgrst,'reload schema';
