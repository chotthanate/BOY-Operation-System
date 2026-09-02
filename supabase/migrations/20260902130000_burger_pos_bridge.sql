-- Read-only POS bridge plus an opt-in item mapping for purchase stock updates.
-- No legacy POS row is changed until an admin explicitly creates a mapping.
create table boy_central.pos_ingredient_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  item_id uuid not null references boy_central.items(id) on delete cascade,
  legacy_ingredient_id uuid not null references public.ingredients(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id,item_id),
  unique (legacy_ingredient_id)
);
create index pos_ingredient_mappings_item_idx on boy_central.pos_ingredient_mappings(item_id);
create trigger pos_ingredient_mappings_set_updated_at before update on boy_central.pos_ingredient_mappings
for each row execute function boy_central_private.set_updated_at();
alter table boy_central.pos_ingredient_mappings enable row level security;
create policy pos_ingredient_mappings_branch_select on boy_central.pos_ingredient_mappings
for select to authenticated using ((select boy_central_private.has_branch_access(branch_id,null)));
revoke all on boy_central.pos_ingredient_mappings from anon;
grant select on boy_central.pos_ingredient_mappings to authenticated;

create or replace function boy_central.get_burger_pos_stock()
returns table(legacy_ingredient_id uuid,item_name text,quantity_on_hand numeric,unit_name text,minimum_stock numeric,updated_at timestamptz)
language plpgsql security definer set search_path=''
as $$
declare burger uuid;
begin
  select id into burger from boy_central.branches where code='BURGER' and active limit 1;
  if (select auth.uid()) is null or not boy_central_private.has_branch_access(burger,null) then raise exception 'branch access denied'; end if;
  return query select i.id,i.name,i.quantity_in_stock,i.unit,i.minimum_stock,i.updated_at
    from public.ingredients i where i.active order by i.name;
end $$;

create or replace function boy_central.get_burger_pos_monthly_sales(month_start date)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare burger uuid; result jsonb;
begin
  select id into burger from boy_central.branches where code='BURGER' and active limit 1;
  if (select auth.uid()) is null or not boy_central_private.has_branch_access(burger,null) then raise exception 'branch access denied'; end if;
  select jsonb_build_object('sales',coalesce(sum(o.total_amount),0),'orders',count(*)) into result
  from public.orders o where o.created_at >= month_start::timestamptz
    and o.created_at < (month_start + interval '1 month')::timestamptz and o.voided_at is null;
  return result;
end $$;

create or replace function boy_central_private.mirror_burger_purchase_to_pos()
returns trigger language plpgsql security definer set search_path=''
as $$
declare legacy_id uuid;
begin
  if new.movement_type <> 'purchase' or new.source_system <> 'boy_burger_web' then return new; end if;
  select m.legacy_ingredient_id into legacy_id from boy_central.pos_ingredient_mappings m
  join boy_central.branches b on b.id=m.branch_id
  where m.branch_id=new.branch_id and m.item_id=new.item_id and m.active and b.code='BURGER';
  if legacy_id is not null then
    update public.ingredients set quantity_in_stock=quantity_in_stock+new.quantity_delta,updated_at=now() where id=legacy_id;
    insert into public.stock_movements(ingredient_id,movement_type,quantity_before,quantity_delta,quantity_after,source_table,source_id,reason)
    select legacy_id,'purchase_sync',i.quantity_in_stock-new.quantity_delta,new.quantity_delta,i.quantity_in_stock,
      'boy_central.stock_movements',new.id::text,'ซื้อของผ่าน BOY Operation'
    from public.ingredients i where i.id=legacy_id;
  end if;
  return new;
end $$;

create trigger mirror_burger_purchase_to_pos_after_insert
after insert on boy_central.stock_movements
for each row execute function boy_central_private.mirror_burger_purchase_to_pos();

revoke all on function boy_central.get_burger_pos_stock() from public,anon;
revoke all on function boy_central.get_burger_pos_monthly_sales(date) from public,anon;
grant execute on function boy_central.get_burger_pos_stock() to authenticated;
grant execute on function boy_central.get_burger_pos_monthly_sales(date) to authenticated;
