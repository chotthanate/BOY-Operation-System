-- Preserve payment-level settlement while returning each original expense line.
create or replace function boy_central.get_reimbursements() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare company uuid; result jsonb;
begin
 select company_id into company from boy_central.profiles where user_id=auth.uid() and active;
 if company is null then raise exception 'active online account required';end if;
 with pending as (
  select p.id,t.id transaction_id,t.branch_id,b.name branch_name,b.code branch_code,
   t.transaction_date,p.amount total_amount,t.note,detail.descriptions,detail.lines,detail.line_count,
   boy_central_private.has_branch_access(t.branch_id,array['admin','manager']) can_settle
  from boy_central.payments p
  join boy_central.transactions t on t.id=p.transaction_id
  join boy_central.branches b on b.id=t.branch_id
  cross join lateral (
   select coalesce(jsonb_agg(l.description order by l.line_no),'[]'::jsonb) descriptions,
    coalesce(jsonb_agg(jsonb_build_object('id',l.id,'line_no',l.line_no,'description',l.description,
     'amount',l.line_total,'quantity',l.quantity,'unit',u.name,
     'supplier',coalesce(nullif(l.supplier_name_raw,''),s.name),'note',l.note) order by l.line_no),'[]'::jsonb) lines,
    count(*) line_count
   from boy_central.transaction_lines l
   left join boy_central.units u on u.id=l.unit_id
   left join boy_central.suppliers s on s.id=l.supplier_id
   where l.transaction_id=t.id
  ) detail
  where t.company_id=company and t.transaction_type='expense' and t.status='confirmed'
   and p.method='reimbursement_pending' and p.status='pending'
   and boy_central_private.has_branch_access(t.branch_id,array['admin','manager','staff'])
 )
 select jsonb_build_object('status','success',
  'total',coalesce((select sum(total_amount) from pending),0),
  'count',(select count(*) from pending),
  'line_count',coalesce((select sum(line_count) from pending),0),
  'rows',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from (
    select * from pending order by transaction_date desc,id limit 500
  ) r)) into result;
 return result;
end;
$$;
revoke all on function boy_central.get_reimbursements() from public,anon;
grant execute on function boy_central.get_reimbursements() to authenticated;
notify pgrst,'reload schema';
