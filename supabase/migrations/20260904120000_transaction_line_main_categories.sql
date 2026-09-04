alter table boy_central.transaction_lines
  add column if not exists category_id uuid references boy_central.categories(id);

create index if not exists transaction_lines_category_id_idx
  on boy_central.transaction_lines (category_id);

-- Normalize existing lines to the main CAT-* categories used by BOY_Master.
update boy_central.transaction_lines tl
set category_id = coalesce(
  case when assigned.parent_id is not null then assigned.parent_id end,
  canonical.id,
  assigned.id
)
from boy_central.expense_items ei
join boy_central.categories assigned on assigned.id = ei.category_id
left join boy_central.categories canonical
  on canonical.company_id = assigned.company_id
 and canonical.category_type = 'item'
 and canonical.parent_id is null
 and canonical.code = case
   when assigned.code like 'EXP-CAT-%' then replace(assigned.code, 'EXP-', '')
   else null
 end
where tl.expense_item_id = ei.id
  and tl.category_id is null;

create or replace function boy_central.record_expense_v2(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := (select auth.uid());
  result jsonb;
  target_transaction_id uuid;
  target_company_id uuid;
  category_value uuid;
  line jsonb;
  line_number integer := 0;
begin
  if actor_id is null then
    raise exception 'authentication required';
  end if;

  result := boy_central.record_expense(payload);
  if result->>'status' = 'duplicate' then
    return result;
  end if;

  target_transaction_id := nullif(result->>'transaction_id', '')::uuid;
  select t.company_id into target_company_id
  from boy_central.transactions t
  where t.id = target_transaction_id
    and t.created_by = actor_id;

  if target_company_id is null then
    raise exception 'created expense transaction not found';
  end if;

  for line in
    select value
    from jsonb_array_elements(payload->'lines')
    order by coalesce(value->>'item_id', ''), coalesce(value->>'description', '')
  loop
    line_number := line_number + 1;
    category_value := nullif(line->>'category_id', '')::uuid;

    if category_value is null or not exists (
      select 1
      from boy_central.categories c
      where c.id = category_value
        and c.company_id = target_company_id
        and c.category_type = 'item'
        and c.parent_id is null
        and c.code ~ '^CAT-[0-9]+$'
        and c.active
    ) then
      raise exception 'active main expense category is required at line %', line_number;
    end if;

    update boy_central.transaction_lines
    set category_id = category_value
    where transaction_id = target_transaction_id
      and line_no = line_number;

    if not found then
      raise exception 'expense line not found at line %', line_number;
    end if;
  end loop;

  return result;
end;
$$;

revoke all on function boy_central.record_expense_v2(jsonb) from public, anon;
grant execute on function boy_central.record_expense_v2(jsonb) to authenticated;

notify pgrst, 'reload schema';
