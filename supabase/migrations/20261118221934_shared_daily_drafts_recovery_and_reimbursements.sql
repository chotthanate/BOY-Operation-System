-- Shared branch/day drafts. Keep the old per-user rows as recovery history.
create table boy_central.daily_shared_drafts(
 company_id uuid not null,branch_id uuid not null,business_date date not null,data jsonb not null default '{}',
 revision integer not null default 1,updated_by uuid not null,updated_at timestamptz not null default now(),
 primary key(branch_id,business_date));
alter table boy_central.daily_shared_drafts enable row level security;
revoke all on boy_central.daily_shared_drafts from public,anon,authenticated;
insert into boy_central.daily_shared_drafts(company_id,branch_id,business_date,data,revision,updated_by,updated_at)
select distinct on(branch_id,business_date) company_id,branch_id,business_date,data,revision,user_id,updated_at
from boy_central.daily_drafts order by branch_id,business_date,updated_at desc,revision desc;
do $patch$
declare def text;
begin
 select pg_get_functiondef('boy_central.get_daily_document(text,date)'::regprocedure) into def;
 def:=replace(def,'draft boy_central.daily_drafts%rowtype','draft boy_central.daily_shared_drafts%rowtype');
 def:=replace(def,'select * into draft from boy_central.daily_drafts where branch_id=b.id and business_date=target_date and user_id=auth.uid()',
  'select * into draft from boy_central.daily_shared_drafts where branch_id=b.id and business_date=target_date');
 def:=replace(def,'''submitted'',coalesce(d.submitted,false)', '''submitted'',coalesce(d.submitted,false) and not coalesce(draft.updated_at>d.updated_at,false)');
 if position('draft boy_central.daily_shared_drafts%rowtype' in def)=0 then raise exception 'shared draft read patch mismatch';end if;
 execute def;
end $patch$;
create or replace function boy_central.save_daily_draft(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype;day date:=(payload->>'business_date')::date;r integer;
begin
 select * into b from boy_central.branches where code=payload->>'branch_code' and active;
 if auth.uid() is null or b.code not in ('TAWANA','BIGC-CENTRAL-PATTAYA') or not boy_central_private.has_branch_access(b.id,array['admin','manager','staff']) then raise exception 'branch access denied';end if;
 if b.code='TAWANA' and not boy_central_private.has_branch_access(b.id,array['admin','manager']) then raise exception 'owner or manager required';end if;
 if day is null or jsonb_typeof(payload->'data')<>'object' or pg_column_size(payload->'data')>240000 then raise exception 'invalid draft';end if;
 perform pg_advisory_xact_lock(hashtextextended('daily:'||b.id||':'||day,0));
 if coalesce((select revision from boy_central.daily_documents where branch_id=b.id and business_date=day),0)<>coalesce((payload->>'expected_document_revision')::integer,0) then raise exception 'document conflict: reload before saving a draft';end if;
 select revision into r from boy_central.daily_shared_drafts where branch_id=b.id and business_date=day;
 if coalesce(r,0)<>coalesce((payload->>'expected_revision')::integer,0) then raise exception 'draft conflict: another device has changed this draft';end if;
 insert into boy_central.daily_shared_drafts(company_id,branch_id,business_date,data,revision,updated_by,updated_at)
 values(b.company_id,b.id,day,payload->'data',coalesce(r,0)+1,auth.uid(),clock_timestamp())
 on conflict(branch_id,business_date) do update set data=excluded.data,revision=excluded.revision,updated_by=excluded.updated_by,updated_at=excluded.updated_at
 returning revision into r;
 return jsonb_build_object('status','saved','revision',r);
end $$;
create function boy_central.get_daily_sync_version(target_branch_code text,target_date date) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare b boy_central.branches%rowtype;
begin
 select * into b from boy_central.branches where code=target_branch_code and active;
 if auth.uid() is null or not boy_central_private.has_branch_access(b.id,null) then raise exception 'branch access denied';end if;
 return jsonb_build_object('revision',coalesce((select revision from boy_central.daily_documents where branch_id=b.id and business_date=target_date),0),
 'draft_revision',coalesce((select revision from boy_central.daily_shared_drafts where branch_id=b.id and business_date=target_date),0));
end $$;
revoke all on function boy_central.get_daily_sync_version(text,date) from public,anon;
grant execute on function boy_central.get_daily_sync_version(text,date) to authenticated;

create table boy_central.daily_superseded_requests(
 request_id uuid primary key,company_id uuid not null,branch_id uuid not null,business_date date not null,
 fingerprint text not null,created_by uuid not null,created_at timestamptz not null default now());
alter table boy_central.daily_superseded_requests enable row level security;
revoke all on boy_central.daily_superseded_requests from public,anon,authenticated;
create function boy_central.resolve_daily_request(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare b boy_central.branches%rowtype;d boy_central.daily_documents%rowtype;r boy_central.daily_requests%rowtype;
 request uuid:=(payload->>'request_id')::uuid;day date:=(payload->>'business_date')::date;fp text:=md5((payload->'expected_data')::text);
begin
 select * into b from boy_central.branches where code=payload->>'branch_code' and active;
 if auth.uid() is null or b.code not in ('TAWANA','BIGC-CENTRAL-PATTAYA') or not boy_central_private.has_branch_access(b.id,array['admin','manager','staff']) then raise exception 'branch access denied';end if;
 if b.code='TAWANA' and not boy_central_private.has_branch_access(b.id,array['admin','manager']) then raise exception 'owner or manager required';end if;
 if request is null or day is null or jsonb_typeof(payload->'expected_data')<>'object' or pg_column_size(payload->'expected_data')>240000 then raise exception 'invalid recovery request';end if;
 perform pg_advisory_xact_lock(hashtextextended('daily:'||b.id||':'||day,0));
 select * into d from boy_central.daily_documents where branch_id=b.id and business_date=day;
 select * into r from boy_central.daily_requests where request_id=request;
 if r.request_id is not null then
  if r.company_id<>b.company_id or r.document_id is distinct from d.id or r.fingerprint is distinct from fp then raise exception 'recovery identity conflict';end if;
  return jsonb_build_object('state','committed','result',r.result,'revision',d.revision,'document_data',d.data,'draft_revision',(select revision from boy_central.daily_shared_drafts where branch_id=b.id and business_date=day));
 end if;
 if coalesce((payload->>'supersede')::boolean,false) then
  if coalesce(d.revision,0)<>coalesce((payload->>'expected_revision')::integer,0) then raise exception 'document conflict: reload and compare before recovering';end if;
  insert into boy_central.daily_superseded_requests(request_id,company_id,branch_id,business_date,fingerprint,created_by)
  values(request,b.company_id,b.id,day,fp,auth.uid()) on conflict do nothing;
  if not exists(select 1 from boy_central.daily_superseded_requests where request_id=request and branch_id=b.id and business_date=day and fingerprint=fp) then raise exception 'recovery identity conflict';end if;
  return jsonb_build_object('state','superseded','revision',coalesce(d.revision,0),'draft_revision',coalesce((select revision from boy_central.daily_shared_drafts where branch_id=b.id and business_date=day),0));
 end if;
 return jsonb_build_object('state','not_found','revision',coalesce(d.revision,0),'draft_revision',coalesce((select revision from boy_central.daily_shared_drafts where branch_id=b.id and business_date=day),0));
end $$;
revoke all on function boy_central.resolve_daily_request(jsonb) from public,anon;
grant execute on function boy_central.resolve_daily_request(jsonb) to authenticated;
do $patch$
declare def text;
begin
 select pg_get_functiondef('boy_central.post_daily_document(jsonb)'::regprocedure) into def;
 def:=replace(def,' select * into previous from boy_central.daily_requests where request_id=request;',
 ' if exists(select 1 from boy_central.daily_superseded_requests where request_id=request) then raise exception ''request superseded: use the recovered request'';end if;'||chr(10)||' select * into previous from boy_central.daily_requests where request_id=request;');
 if position('request superseded' in def)=0 then raise exception 'daily recovery guard patch mismatch';end if;
 def:=replace(def,' if d.fingerprint=fp and d.submitted then',
 ' if coalesce((select revision from boy_central.daily_shared_drafts where branch_id=b.id and business_date=target_date),0)<>coalesce((payload->>''expected_draft_revision'')::integer,0) then raise exception ''draft conflict: another device has changed this draft; reload and compare'';end if;'||chr(10)||' if d.fingerprint=fp and d.submitted then');
 if position('expected_draft_revision' in def)=0 then raise exception 'draft submission guard patch mismatch';end if;
 def:=replace(def,' delete from boy_central.daily_drafts where branch_id=b.id and business_date=target_date and user_id=auth.uid();',
 ' delete from boy_central.daily_drafts where branch_id=b.id and business_date=target_date and user_id=auth.uid();'||chr(10)||' delete from boy_central.daily_shared_drafts where branch_id=b.id and business_date=target_date;');
 execute def;
end $patch$;

create function boy_central.get_reimbursements() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare company uuid;result jsonb;
begin
 select company_id into company from boy_central.profiles where user_id=auth.uid() and active;
 if company is null then raise exception 'active online account required';end if;
 with pending as(
 select p.id,t.id transaction_id,t.branch_id,b.name branch_name,b.code branch_code,t.transaction_date,p.amount total_amount,t.note,
 (select jsonb_agg(l.description order by l.line_no) from boy_central.transaction_lines l where l.transaction_id=t.id) descriptions,
 boy_central_private.has_branch_access(t.branch_id,array['admin','manager']) can_settle
 from boy_central.payments p join boy_central.transactions t on t.id=p.transaction_id join boy_central.branches b on b.id=t.branch_id
 where t.company_id=company and t.transaction_type='expense' and t.status='confirmed' and p.method='reimbursement_pending' and p.status='pending'
 and boy_central_private.has_branch_access(t.branch_id,array['admin','manager','staff']))
 select jsonb_build_object('status','success','total',coalesce((select sum(total_amount) from pending),0),'count',(select count(*) from pending),
 'rows',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from(select * from pending order by transaction_date desc,id limit 500)r)) into result;
 return result;
end $$;
revoke all on function boy_central.get_reimbursements() from public,anon;
grant execute on function boy_central.get_reimbursements() to authenticated;
create function boy_central.settle_reimbursements(payload jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare ids uuid[];r record;changed integer:=0;amount numeric:=0;
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 if jsonb_typeof(payload->'payment_ids')<>'array' or jsonb_array_length(payload->'payment_ids') not between 1 and 100 then raise exception 'เลือก 1-100 รายการ';end if;
 select array_agg(distinct value::uuid) into ids from jsonb_array_elements_text(payload->'payment_ids');
 perform 1 from boy_central.payments p join boy_central.transactions t on t.id=p.transaction_id where p.id=any(ids) for update of p,t;
 if (select count(*) from boy_central.payments p join boy_central.transactions t on t.id=p.transaction_id
 where p.id=any(ids) and p.method='reimbursement_pending' and p.status in ('pending','paid') and t.status='confirmed' and t.transaction_type='expense'
 and boy_central_private.has_branch_access(t.branch_id,array['admin','manager']))<>cardinality(ids) then raise exception 'รายการเปลี่ยนสถานะหรือคุณไม่มีสิทธิ์เคลียร์ กรุณาโหลดใหม่';end if;
 for r in select p.*,t.branch_id from boy_central.payments p join boy_central.transactions t on t.id=p.transaction_id where p.id=any(ids) and p.status='pending' loop
  update boy_central.payments set status='paid',paid_at=now(),note=coalesce(note||' · ','')||'รับเงินเบิกคืนแล้ว' where id=r.id;
  insert into boy_central.audit_log(company_id,branch_id,actor_user_id,action,entity_type,entity_id,source_system,after_data)
  values(r.company_id,r.branch_id,auth.uid(),'settle_reimbursement','payment',r.id::text,'boy_reimbursements_web',jsonb_build_object('status','paid','amount',r.amount));
  perform boy_central_private.queue_mirror(r.company_id,r.branch_id,'transaction',r.transaction_id,'reimbursement:'||extract(epoch from clock_timestamp())::text);
  changed:=changed+1;amount:=amount+r.amount;
 end loop;
 return jsonb_build_object('status','success','settled',changed,'total',amount,'duplicate',changed=0);
end $$;
revoke all on function boy_central.settle_reimbursements(jsonb) from public,anon;
grant execute on function boy_central.settle_reimbursements(jsonb) to authenticated;
notify pgrst,'reload schema';
