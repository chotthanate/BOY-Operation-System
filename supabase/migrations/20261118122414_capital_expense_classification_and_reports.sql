-- Applied migration version returned by Supabase: 20261118122414.
-- Capital spending is separate from operating expenses, not a second payment.
alter table boy_central.transactions add column accounting_class text not null default 'operating'
  check(accounting_class in ('operating','capital'));
alter table boy_central.transaction_lines add column investment_details jsonb;
create function boy_central_private.guard_investment_fields() returns trigger language plpgsql security definer set search_path='' as $$
declare branch uuid;
begin
 if tg_table_name='transactions' then
  if new.accounting_class='operating' and (tg_op='INSERT' or old.accounting_class='operating') then return new;end if;
  branch:=new.branch_id;
 else
  if new.investment_details is null and (tg_op='INSERT' or old.investment_details is null) then return new;end if;
  select branch_id into branch from boy_central.transactions where id=new.transaction_id;
 end if;
 if auth.uid() is null or not boy_central_private.has_branch_access(branch,array['admin','manager']) then raise exception 'owner or manager required for investment fields';end if;
 return new;
end $$;
revoke all on function boy_central_private.guard_investment_fields() from public,anon,authenticated;
create trigger guard_investment_class before insert or update of accounting_class on boy_central.transactions for each row execute function boy_central_private.guard_investment_fields();
create trigger guard_investment_details before insert or update of investment_details on boy_central.transaction_lines for each row execute function boy_central_private.guard_investment_fields();
insert into boy_central.categories(company_id,code,name,category_type,active)
select distinct company_id,'CAT-900000','เงินลงทุนและสินทรัพย์','item',true from boy_central.branches b
where not exists(select 1 from boy_central.categories c where c.company_id=b.company_id and c.code='CAT-900000');
alter function boy_central.record_expense_v4(jsonb) rename to record_expense_v4_before_investments;
revoke all on function boy_central.record_expense_v4_before_investments(jsonb) from public,anon,authenticated;
create function boy_central.record_expense_v4(payload jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare result jsonb; entry jsonb; cleaned jsonb:='[]'; kind text;
 details jsonb; line_no_ integer:=0; tid uuid; branch uuid:=(payload->>'branch_id')::uuid;capital_category uuid;
begin
 if auth.uid() is null then raise exception 'authentication required';end if;
 if jsonb_typeof(payload->'lines')<>'array' or jsonb_array_length(payload->'lines')=0 then raise exception 'expense lines required';end if;
 kind:=coalesce(payload#>>'{lines,0,expense_class}','operating');
 if kind not in ('operating','capital') then raise exception 'invalid expense class';end if;
 if kind='capital' and not boy_central_private.has_branch_access(branch,array['admin','manager']) then raise exception 'owner or manager required for investments';end if;
 select c.id into capital_category from boy_central.categories c join boy_central.branches b on b.company_id=c.company_id where b.id=branch and c.code='CAT-900000';
 if kind='capital' and exists(select 1 from jsonb_array_elements(payload->'lines')x group by x->>'description' having count(*)>1) then raise exception 'รายการลงทุนชื่อซ้ำ กรุณาแยกชื่อให้ชัดเจน';end if;
 for entry in select value from jsonb_array_elements(payload->'lines') loop
  if coalesce(entry->>'expense_class','operating')<>kind then raise exception 'separate operating and capital payment groups';end if;
  if kind='capital' then
   if length(trim(coalesce(entry->>'project_name','')))=0 or length(entry->>'project_name')>160 then raise exception 'ระบุชื่อโครงการลงทุน (ไม่เกิน 160 ตัวอักษร)';end if;
   if coalesce(entry->>'investment_category','') not in ('construction','utilities','equipment','furniture','other') then raise exception 'เลือกหมวดลงทุน';end if;
   cleaned:=cleaned||jsonb_build_array((entry-'item_id'-'expense_item_id'-'unit_id'-'conversion_to_base')||jsonb_build_object('quantity',0,'category_id',capital_category));
  else cleaned:=cleaned||jsonb_build_array(entry);end if;
 end loop;
 result:=boy_central.record_expense_v4_before_investments(jsonb_set(payload,'{lines}',cleaned));
 tid:=(result->>'transaction_id')::uuid;
 if kind='capital' then
  if result->>'status'='duplicate' then
   if not exists(select 1 from boy_central.transactions where id=tid and accounting_class='capital') then raise exception 'request conflicts with existing operating expense';end if;
  else
   update boy_central.transactions set accounting_class='capital' where id=tid;
  end if;
  for entry in select value from jsonb_array_elements(payload->'lines') order by value->>'description' loop
   line_no_:=line_no_+1;
   details:=jsonb_build_object('project_name',trim(entry->>'project_name'),'category',entry->>'investment_category',
    'source_item_id',entry->>'item_id','source_expense_item_id',entry->>'expense_item_id');
   if result->>'status'='duplicate' then
    if not exists(select 1 from boy_central.transaction_lines where transaction_id=tid and line_no=line_no_ and investment_details=details) then raise exception 'request conflicts with investment details';end if;
   else update boy_central.transaction_lines set investment_details=details where transaction_id=tid and line_no=line_no_;end if;
  end loop;
 end if;
 return result||jsonb_build_object('expense_class',kind);
end $$;
revoke all on function boy_central.record_expense_v4(jsonb) from public,anon;
grant execute on function boy_central.record_expense_v4(jsonb) to authenticated;

-- Keep legacy daily documents per-line; split only the posting groups.
do $patch$
declare def text;
begin
 select pg_get_functiondef('boy_central.post_daily_document(jsonb)'::regprocedure) into def;
 def:=replace(def,'receiving text;','receiving text; expense_kind text;');
 def:=replace(def,'     if category is null then raise exception',
  '     if expense_kind=''capital'' then select id into category from boy_central.categories where company_id=b.company_id and code=''CAT-900000'';end if;'||chr(10)||'     if category is null then raise exception');
 def:=replace(def,' for receiving in select distinct',
  ' for expense_kind in select distinct coalesce(x->>''expense_class'',''operating'') from jsonb_array_elements(coalesce(body->''exp'',''[]''))x loop'||chr(10)||' for receiving in select distinct');
 def:=replace(def,'where coalesce(nullif(value->>''pay'',''''),''cash'')=payment and',
  'where coalesce(value->>''expense_class'',''operating'')=expense_kind and coalesce(nullif(value->>''pay'',''''),''cash'')=payment and');
 def:=replace(def,'''description'',entry->>''i'',''quantity''',
  '''expense_class'',expense_kind,''project_name'',entry->>''project_name'',''investment_category'',entry->>''investment_category'',''description'',entry->>''i'',''quantity''');
 def:=replace(def,'request||'':''||payment||'':''||receiving,','request||'':''||payment||'':''||receiving||'':''||expense_kind,');
 def:=replace(def,'''-''||payment||''-''||receiving,','''-''||payment||''-''||receiving||''-''||expense_kind,');
 def:=replace(def,'   group_result:=boy_central.record_expense_v4(', '   if total=0 then continue;end if;'||chr(10)||'   group_result:=boy_central.record_expense_v4(');
 def:=replace(def,' else ids:=d.transaction_ids;end if;', ' end loop;'||chr(10)||' else ids:=d.transaction_ids;end if;');
 if position('''expense_class'',expense_kind' in def)=0 then raise exception 'daily investment patch mismatch';end if;
 execute def;
end $patch$;

-- Existing operating dashboards and expense breakdowns exclude capital posts.
do $patch$
declare signature text;def text;patched text;
begin
 foreach signature in array array[
 'boy_central.get_dashboard_daily_before_bigc_revenue(date)',
 'boy_central.get_dashboard_monthly_before_bigc_revenue(integer,integer)',
 'boy_central_private.get_branch_dashboard_before_bigc_allocations(text,date,date)'] loop
 select pg_get_functiondef(signature::regprocedure) into def;
 patched:=regexp_replace(def,'t\.transaction_type\s*=\s*''expense''','t.transaction_type = ''expense'' and t.accounting_class = ''operating''','g');
 if patched=def then raise exception 'report patch mismatch: %',signature;end if;
 execute patched;
 end loop;
end $patch$;

create function boy_central.get_investment_report(target_branch_code text,date_from date,date_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare b boy_central.branches%rowtype;result jsonb;
begin
 select * into b from boy_central.branches where code=target_branch_code and active;
 if auth.uid() is null or not boy_central_private.has_branch_access(b.id,array['admin','manager']) then raise exception 'owner or manager required';end if;
 if date_from is null or date_to is null or date_to<date_from or date_to-date_from>366 then raise exception 'choose up to one year';end if;
 select jsonb_build_object('branch',jsonb_build_object('id',b.id,'name',b.name,'code',b.code),
 'total',coalesce(sum(l.line_total),0),'count',count(*),
 'projects',coalesce(jsonb_agg(distinct l.investment_details->>'project_name'),'[]')) into result
 from boy_central.transactions t join boy_central.transaction_lines l on l.transaction_id=t.id
 where t.branch_id=b.id and t.accounting_class='capital' and t.status='confirmed' and t.transaction_date between date_from and date_to;
 return result||jsonb_build_object('rows',(select coalesce(jsonb_agg(to_jsonb(r)),'[]') from (
 select t.id transaction_id,t.transaction_date,l.description,l.line_total,l.investment_details,l.supplier_name_raw
 from boy_central.transactions t join boy_central.transaction_lines l on l.transaction_id=t.id
 where t.branch_id=b.id and t.accounting_class='capital' and t.status='confirmed' and t.transaction_date between date_from and date_to
 order by t.transaction_date desc,t.created_at desc,l.line_no limit 100)r));
end $$;
revoke all on function boy_central.get_investment_report(text,date,date) from public,anon;
grant execute on function boy_central.get_investment_report(text,date,date) to authenticated;

alter function boy_central.get_branch_dashboard(text,date,date) rename to get_branch_dashboard_before_investments;
revoke all on function boy_central.get_branch_dashboard_before_investments(text,date,date) from public,anon,authenticated;
create function boy_central.get_branch_dashboard(target_branch_code text,date_from date,date_to date)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;capital numeric;paid numeric;
begin
 result:=boy_central.get_branch_dashboard_before_investments(target_branch_code,date_from,date_to);
 select coalesce(sum(t.total_amount),0) into capital from boy_central.transactions t
 where t.branch_id=(result#>>'{branch,id}')::uuid and t.accounting_class='capital' and t.status='confirmed' and t.transaction_date between date_from and date_to;
 select coalesce(sum(p.amount),0) into paid from boy_central.payments p join boy_central.transactions t on t.id=p.transaction_id
 where t.branch_id=(result#>>'{branch,id}')::uuid and t.transaction_type='expense' and t.status='confirmed' and p.status='completed' and t.transaction_date between date_from and date_to;
 return jsonb_set(result,'{totals}',(result->'totals')||jsonb_build_object('investment',capital,'totalSpending',capital+coalesce((result#>>'{totals,expenses}')::numeric,0),'paidExpenses',paid));
end $$;
revoke all on function boy_central.get_branch_dashboard(text,date,date) from public,anon;
grant execute on function boy_central.get_branch_dashboard(text,date,date) to authenticated;

alter function boy_central.get_dashboard_monthly(integer,integer) rename to get_dashboard_monthly_before_investments;
revoke all on function boy_central.get_dashboard_monthly_before_investments(integer,integer) from public,anon,authenticated;
create function boy_central.get_dashboard_monthly(target_year integer,target_month integer)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;capital numeric;start_ date:=make_date(target_year,target_month,1);
begin
 result:=boy_central.get_dashboard_monthly_before_investments(target_year,target_month);
 select coalesce(sum(t.total_amount),0) into capital from boy_central.transactions t join boy_central.profiles p on p.company_id=t.company_id and p.user_id=auth.uid() and p.active
 where t.accounting_class='capital' and t.status='confirmed' and t.transaction_date>=start_ and t.transaction_date<(start_+interval '1 month')::date;
 return jsonb_set(result,'{summary}',(result->'summary')||jsonb_build_object('investment',capital,'totalSpending',capital+coalesce((result#>>'{summary,expense}')::numeric,0)));
end $$;
revoke all on function boy_central.get_dashboard_monthly(integer,integer) from public,anon;
grant execute on function boy_central.get_dashboard_monthly(integer,integer) to authenticated;
notify pgrst,'reload schema';
