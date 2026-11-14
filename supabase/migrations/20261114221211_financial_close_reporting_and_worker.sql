create function boy_central.record_pos_shift_close(device_token text,payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
 declare d boy_central.pos_devices%rowtype; date_value date; key text; fp text; previous boy_central.financial_closes%rowtype;
 cash numeric;transfer numeric;government numeric;other numeric;expected numeric;result_id uuid;source_name text;shift_uuid uuid;
begin
 select * into d from boy_central_private.pos_device_for_token(device_token);
 if d.id is null then raise exception 'device access denied';end if;
 key:=nullif(payload->>'shift_id','');
 if key is null or nullif(payload->>'closed_at','') is null or nullif(payload->>'opened_at','') is null then raise exception 'closed shift ID and times required';end if;
 if (payload->>'closed_at')::timestamptz<(payload->>'opened_at')::timestamptz then raise exception 'invalid shift times';end if;
 date_value:=((payload->>'opened_at')::timestamptz at time zone 'Asia/Bangkok')::date;
 cash:=coalesce((payload->>'cash')::numeric,0);transfer:=coalesce((payload->>'transfer')::numeric,0);
 government:=coalesce((payload->>'government')::numeric,0);other:=coalesce((payload->>'other')::numeric,0);
 expected:=coalesce((payload->>'total')::numeric,cash+transfer+government+other);
 if abs(expected-cash-transfer-government-other)>0.01 then raise exception 'shift payment totals do not match revenue';end if;
 fp:=md5(jsonb_build_array(date_value,cash,transfer,government,other,payload->'order_count')::text);
 perform pg_advisory_xact_lock(hashtextextended('close:'||d.branch_id||':'||key,0));
 select * into previous from boy_central.financial_closes where branch_id=d.branch_id and source_type='pos_shift' and source_key=key;
 if previous.id is not null then
   if previous.fingerprint<>fp then raise exception 'shift close conflict: use an authorized correction';end if;
   return jsonb_build_object('status','saved','duplicate',true,'close_id',previous.id);
 end if;
 insert into boy_central.financial_closes(company_id,branch_id,business_date,source_type,source_key,cash,transfer,government,other,order_count,fingerprint)
 values(d.company_id,d.branch_id,date_value,'pos_shift',key,cash,transfer,government,other,(payload->>'order_count')::integer,fp) returning id into result_id;
 select case b.code when 'BURGER' then 'burger_pos' when 'GRILL' then 'grill_pos' else 'water_pos' end into source_name from boy_central.branches b where id=d.branch_id;
 insert into boy_central.pos_shifts(company_id,branch_id,source_system,external_id,opened_at,closed_at,opening_cash,closing_cash,expected_cash,status)
 values(d.company_id,d.branch_id,source_name,key,(payload->>'opened_at')::timestamptz,(payload->>'closed_at')::timestamptz,
 coalesce((payload->>'opening_cash')::numeric,0),(payload->>'counted_cash')::numeric,(payload->>'expected_cash')::numeric,'closed')
 on conflict(company_id,source_system,external_id) do update set opened_at=excluded.opened_at,closed_at=excluded.closed_at,closing_cash=excluded.closing_cash,expected_cash=excluded.expected_cash,status='closed',updated_at=now()
 where pos_shifts.branch_id=excluded.branch_id returning id into shift_uuid;
 if shift_uuid is null then raise exception 'shift ID belongs to another branch';end if;
 -- Do not change a branch's live revenue source until an updated device has
 -- actually delivered its first confirmed close. Tawana stays manual.
 update boy_central.branch_revenue_policies set effective_date=least(effective_date,date_value),updated_at=now()
 where branch_id=d.branch_id and mode='pos_shift';
 return jsonb_build_object('status','saved','close_id',result_id,'mirror_pending',true);
end $$;
revoke all on function boy_central.record_pos_shift_close(text,jsonb) from public;
grant execute on function boy_central.record_pos_shift_close(text,jsonb) to anon,authenticated;
create function public.pos_record_shift_close(device_token text,payload jsonb)
returns jsonb language sql security invoker set search_path='' as $$ select boy_central.record_pos_shift_close(device_token,payload) $$;
revoke all on function public.pos_record_shift_close(text,jsonb) from public;
grant execute on function public.pos_record_shift_close(text,jsonb) to anon,authenticated;

create function boy_central_private.bigc_close_queue() returns trigger language plpgsql security definer set search_path='' as $$
declare mode text;
begin
 if new.status<>'submitted' then return new;end if;
 perform boy_central_private.queue_mirror(new.company_id,new.branch_id,'bigc_workflow',new.id,new.revision::text);
 select p.mode into mode from boy_central.branch_revenue_policies p where branch_id=new.branch_id;
 if new.workflow_type='return' and mode='manual' then
 insert into boy_central.financial_closes(company_id,branch_id,business_date,source_type,source_key,cash,transfer,government,fingerprint)
 values(new.company_id,new.branch_id,new.business_date,'manual',new.business_date::text,new.cash_amount,new.transfer_amount,new.thai_chuay_thai_amount,
 md5(jsonb_build_array(new.cash_amount,new.transfer_amount,new.thai_chuay_thai_amount)::text))
 on conflict(branch_id,source_type,source_key) do update set cash=excluded.cash,transfer=excluded.transfer,government=excluded.government,
 fingerprint=excluded.fingerprint,revision=financial_closes.revision+1,updated_at=now();
 end if;return new;
end $$;
create trigger bigc_central_queue after insert or update of revision on boy_central.bigc_workflows for each row execute function boy_central_private.bigc_close_queue();
revoke all on function boy_central_private.bigc_close_queue() from public,anon,authenticated;

alter function boy_central.get_bigc_v2_context(date) rename to get_bigc_v2_context_before_central_queue;
revoke all on function boy_central.get_bigc_v2_context_before_central_queue(date) from public,anon,authenticated;
create function boy_central.get_bigc_v2_context(target_date date)
returns jsonb language sql security definer set search_path='' as $$
 select boy_central.get_bigc_v2_context_before_central_queue(target_date)||jsonb_build_object('server_mirror',true)
$$;
revoke all on function boy_central.get_bigc_v2_context(date) from public,anon;
grant execute on function boy_central.get_bigc_v2_context(date) to authenticated;

create function boy_central.claim_mirror_jobs(batch_size integer default 20)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j boy_central.mirror_jobs%rowtype; body jsonb; output jsonb:='[]'; name text;code text;
begin
 for j in select * from boy_central.mirror_jobs where available_at<=now() and
 (status in ('pending','error') or (status='processing' and lease_until<now())) order by available_at,id
 limit least(greatest(batch_size,1),30) for update skip locked loop
 select b.name,b.code into name,code from boy_central.branches b where id=j.branch_id;
 body:='{}';
 if j.entity_type='daily_document' then
  select jsonb_build_object('business_date',business_date,'data',data,'revision',revision,
   'revisions',(select coalesce(jsonb_agg(r.data order by r.revision),'[]') from boy_central.financial_revisions r where r.entity_type='daily_documents' and r.entity_id=j.entity_id)) into body from boy_central.daily_documents where id=j.entity_id;
 elsif j.entity_type='transaction' then
  select jsonb_build_object('header',to_jsonb(t),'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by line_no),'[]') from boy_central.transaction_lines l where transaction_id=t.id),
  'payments',(select coalesce(jsonb_agg(to_jsonb(p)),'[]') from boy_central.payments p where transaction_id=t.id)) into body from boy_central.transactions t where id=j.entity_id;
 elsif j.entity_type='financial_close' then select to_jsonb(c)||jsonb_build_object('revisions',(select coalesce(jsonb_agg(r.data order by r.revision),'[]') from boy_central.financial_revisions r where r.entity_type='financial_closes' and r.entity_id=j.entity_id)) into body from boy_central.financial_closes c where id=j.entity_id;
 elsif j.entity_type='stock_movement' then select to_jsonb(m) into body from boy_central.stock_movements m where id=j.entity_id;
 elsif j.entity_type='pos_order' then
  select jsonb_build_object('header',to_jsonb(o),'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]') from boy_central.pos_order_lines l where pos_order_id=o.id)) into body from boy_central.pos_orders o where id=j.entity_id;
 elsif j.entity_type='bigc_workflow' then
  select to_jsonb(w)||jsonb_build_object('workflow_id',w.id,'lines',(select coalesce(jsonb_agg(to_jsonb(l) order by sort_order),'[]') from boy_central.bigc_workflow_lines l where workflow_id=w.id)) into body from boy_central.bigc_workflows w where id=j.entity_id;
 end if;
 -- Fetch the current entity only. Older queued revisions must never overwrite
 -- a newer mirror; the receiver also compares revision before applying it.
 body:=coalesce(body,'{}')||jsonb_build_object('entity_id',j.entity_id,'branch_code',code,'branch_name',name,'entity_type',j.entity_type,'job_id',j.id,'job_revision',j.revision);
 update boy_central.mirror_jobs set status='processing',lease_until=now()+interval '5 minutes',attempts=attempts+1 where id=j.id;
 output:=output||jsonb_build_array(jsonb_build_object('id',j.id,'payload',body));
 end loop;return output;
end $$;
create function boy_central.finish_mirror_job(job_id uuid,success boolean,error_message text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare j boy_central.mirror_jobs%rowtype;
begin
 select * into j from boy_central.mirror_jobs where id=job_id for update;
 if j.id is null then raise exception 'job not found';end if;
 if j.status='synced' then return jsonb_build_object('status','synced');end if;
 update boy_central.mirror_jobs set status=case when success then 'synced' else 'error' end,
 synced_at=case when success then now() end,lease_until=null,last_error=case when success then null else left(error_message,500) end,
 available_at=case when success then now() else now()+make_interval(secs=>least(3600,power(2,least(attempts,10))::integer*30)) end where id=j.id;
 if j.entity_type='bigc_workflow' then
  update boy_central.bigc_workflows set sheet_sync_status=case when success then 'synced' else 'error' end,
   sheet_sync_error=case when success then null else left(error_message,400) end where id=j.entity_id and revision::text=j.revision;
 end if;
 return jsonb_build_object('status',case when success then 'synced' else 'error' end);
end $$;
revoke all on function boy_central.claim_mirror_jobs(integer),boy_central.finish_mirror_job(uuid,boolean,text) from public,anon,authenticated;
grant execute on function boy_central.claim_mirror_jobs(integer),boy_central.finish_mirror_job(uuid,boolean,text) to service_role;

create function boy_central_private.revenue_for_day(target_branch uuid,target_date date)
returns table(cash numeric,transfer numeric,government numeric,other numeric,orders bigint)
language sql stable security definer set search_path='' as $$
 select coalesce(sum(c.cash),0),coalesce(sum(c.transfer),0),coalesce(sum(c.government),0),coalesce(sum(c.other),0),coalesce(sum(c.order_count),0)::bigint
 from boy_central.financial_closes c join boy_central.branch_revenue_policies p on p.branch_id=c.branch_id and p.mode=c.source_type
 where c.branch_id=target_branch and c.business_date=target_date
$$;
revoke all on function boy_central_private.revenue_for_day(uuid,date) from public,anon,authenticated;

alter function boy_central.get_dashboard_daily(date) rename to get_dashboard_daily_before_close_policy;
revoke all on function boy_central.get_dashboard_daily_before_close_policy(date) from public,anon,authenticated;
create function boy_central.get_dashboard_daily(target_date date default current_date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; branch jsonb; r record; output jsonb:='[]';income numeric:=0;expense numeric:=0;
begin
 result:=boy_central.get_dashboard_daily_before_close_policy(target_date);
 for branch in select value from jsonb_array_elements(result->'branches') loop
 if exists(select 1 from boy_central.branch_revenue_policies where branch_id=(branch->>'id')::uuid and target_date>=effective_date) then
 select * into r from boy_central_private.revenue_for_day((branch->>'id')::uuid,target_date);
 branch:=branch||jsonb_build_object('cash',r.cash,'transfer',r.transfer,'government',r.government,'other',r.other,'income',r.cash+r.transfer+r.government+r.other,'income_source','confirmed_close',
 'details',jsonb_build_array(jsonb_build_object('label','เงินสด','amount',r.cash),jsonb_build_object('label','เงินโอน','amount',r.transfer),jsonb_build_object('label','ไทยช่วยไทย','amount',r.government),jsonb_build_object('label','อื่นๆ','amount',r.other)));
 branch:=branch||jsonb_build_object('net',(branch->>'income')::numeric-(branch->>'expense')::numeric);
 end if;income:=income+(branch->>'income')::numeric;expense:=expense+(branch->>'expense')::numeric;output:=output||jsonb_build_array(branch);
 end loop;
 return result||jsonb_build_object('branches',output,'totals',(result->'totals')||jsonb_build_object('income',income,'expense',expense,'net',income-expense));
end $$;
revoke all on function boy_central.get_dashboard_daily(date) from public,anon;
grant execute on function boy_central.get_dashboard_daily(date) to authenticated;

alter function boy_central.get_dashboard_monthly(integer,integer) rename to get_dashboard_monthly_before_close_policy;
revoke all on function boy_central.get_dashboard_monthly_before_close_policy(integer,integer) from public,anon,authenticated;
create function boy_central.get_dashboard_monthly(target_year integer,target_month integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; d date; last_day date; old_income numeric; new_income numeric:=0; amount numeric; rows jsonb:='[]';
begin
 result:=boy_central.get_dashboard_monthly_before_close_policy(target_year,target_month);
 old_income:=(result#>>'{summary,income}')::numeric;d:=make_date(target_year,target_month,1);last_day:=(d+interval '1 month')::date;
 while d<last_day loop
  amount:=(boy_central.get_dashboard_daily(d)#>>'{totals,income}')::numeric;
  if amount<>0 then rows:=rows||jsonb_build_array(jsonb_build_object('day',extract(day from d)::integer,'label','วันที่ '||extract(day from d)::integer,'total',amount));end if;
  new_income:=new_income+amount;d:=d+1;
 end loop;
 return result||jsonb_build_object('dailyIncome',rows,'summary',(result->'summary')||jsonb_build_object('income',new_income,'profit',new_income-(result#>>'{summary,expense}')::numeric));
end $$;
revoke all on function boy_central.get_dashboard_monthly(integer,integer) from public,anon;
grant execute on function boy_central.get_dashboard_monthly(integer,integer) to authenticated;

alter function boy_central.get_branch_dashboard(text,date,date) rename to get_branch_dashboard_before_close_policy;
revoke all on function boy_central.get_branch_dashboard_before_close_policy(text,date,date) from public,anon,authenticated;
create function boy_central.get_branch_dashboard(target_branch_code text,date_from date,date_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; b uuid; day jsonb; r record; daily jsonb:='[]';revenue numeric:=0;orders bigint:=0; payments jsonb;cutover date;pre_cutover jsonb;
begin
 result:=boy_central.get_branch_dashboard_before_close_policy(target_branch_code,date_from,date_to);b:=(result#>>'{branch,id}')::uuid;
 for day in select value from jsonb_array_elements(result->'daily') loop
 if exists(select 1 from boy_central.branch_revenue_policies where branch_id=b and (day->>'date')::date>=effective_date) then
 select * into r from boy_central_private.revenue_for_day(b,(day->>'date')::date);
 day:=day||jsonb_build_object('revenue',r.cash+r.transfer+r.government+r.other,'orders',r.orders,'net',r.cash+r.transfer+r.government+r.other-(day->>'expenses')::numeric);
 end if;revenue:=revenue+(day->>'revenue')::numeric;orders:=orders+(day->>'orders')::bigint;daily:=daily||jsonb_build_array(day);
 end loop;
 result:=result||jsonb_build_object('daily',daily,'incomeSource','branch_close_policy','totals',(result->'totals')||jsonb_build_object('revenue',revenue,'orders',orders,'averageOrder',case when orders>0 then revenue/orders else 0 end,'net',revenue-(result#>>'{totals,expenses}')::numeric));
 if exists(select 1 from boy_central.financial_closes where branch_id=b) then
 result:=jsonb_set(result,'{available}',jsonb_build_object('from',least((result#>>'{available,from}')::date,(select min(business_date) from boy_central.financial_closes where branch_id=b)),
 'to',greatest((result#>>'{available,to}')::date,(select max(business_date) from boy_central.financial_closes where branch_id=b))));end if;
 select effective_date into cutover from boy_central.branch_revenue_policies where branch_id=b;
 if date_to>=cutover then
 if date_from<cutover then pre_cutover:=boy_central.get_branch_dashboard_before_close_policy(target_branch_code,date_from,cutover-1);else pre_cutover:='{}';end if;
 with values_ as(select v.method,v.amount,c.order_count from boy_central.financial_closes c join boy_central.branch_revenue_policies p on p.branch_id=c.branch_id and p.mode=c.source_type
 cross join lateral(values('cash',c.cash),('transfer',c.transfer),('government',c.government),('other',c.other))v(method,amount)
 where c.branch_id=b and c.business_date between greatest(date_from,cutover) and date_to
 union all select p->>'method',(p->>'amount')::numeric,(p->>'order_count')::integer from jsonb_array_elements(coalesce(pre_cutover->'payments','[]'))p),
 grouped as(select method,sum(amount) amount,coalesce(sum(order_count),0) order_count from values_ group by method having sum(amount)<>0)
 select coalesce(jsonb_agg(to_jsonb(grouped)),'[]') into payments from grouped;
 result:=jsonb_set(result,'{payments}',payments);
 -- Detail charts remain POS order analytics, not the financial close ledger.
 -- Keep that distinction explicit rather than presenting them as reconciled.
 result:=result||jsonb_build_object('detailSource','pos_orders','detailReconciled',false);
 end if;
 return result;
end $$;
revoke all on function boy_central.get_branch_dashboard(text,date,date) from public,anon;
grant execute on function boy_central.get_branch_dashboard(text,date,date) to authenticated;

create function boy_central_private.pos_order_mirror() returns trigger language plpgsql security definer set search_path='' as $$
begin perform boy_central_private.queue_mirror(new.company_id,new.branch_id,'pos_order',new.id,extract(epoch from new.updated_at)::text);return new;end $$;
create trigger canonical_pos_order_mirror after insert or update of payment_status,total_amount,voided_at on boy_central.pos_orders for each row execute function boy_central_private.pos_order_mirror();
create function boy_central_private.stock_movement_mirror() returns trigger language plpgsql security definer set search_path='' as $$
begin perform boy_central_private.queue_mirror(new.company_id,new.branch_id,'stock_movement',new.id,extract(epoch from new.created_at)::text);return new;end $$;
create trigger canonical_stock_movement_mirror after insert on boy_central.stock_movements for each row execute function boy_central_private.stock_movement_mirror();
revoke all on function boy_central_private.pos_order_mirror(),boy_central_private.stock_movement_mirror() from public,anon,authenticated;
notify pgrst,'reload schema';
