-- Bridge the Burger POS JSON app-state IDs to BOY Central UUID master data.
-- This coexists with the older normalized-table bridge; it does not mutate legacy POS state.
create table boy_central.pos_master_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  source_system text not null default 'burger_pos_app_state',
  entity_type text not null check (entity_type in ('ingredient','product','modifier')),
  legacy_key text not null,
  source_name text not null,
  item_id uuid references boy_central.items(id),
  menu_id uuid references boy_central.menus(id),
  match_status text not null default 'review' check (match_status in ('matched','review','ignored')),
  source_payload jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, source_system, entity_type, legacy_key),
  check (
    (entity_type = 'ingredient' and menu_id is null)
    or (entity_type = 'product' and item_id is null)
    or (entity_type = 'modifier')
  )
);

create index pos_master_mappings_company_id_idx on boy_central.pos_master_mappings(company_id);
create index pos_master_mappings_branch_status_idx on boy_central.pos_master_mappings(branch_id, match_status);
create index pos_master_mappings_item_id_idx on boy_central.pos_master_mappings(item_id) where item_id is not null;
create index pos_master_mappings_menu_id_idx on boy_central.pos_master_mappings(menu_id) where menu_id is not null;

create trigger pos_master_mappings_set_updated_at before update on boy_central.pos_master_mappings
for each row execute function boy_central_private.set_updated_at();

alter table boy_central.pos_master_mappings enable row level security;
create policy pos_master_mappings_branch_select on boy_central.pos_master_mappings
for select to authenticated
using ((select boy_central_private.has_branch_access(branch_id, null)));
create policy pos_master_mappings_branch_write on boy_central.pos_master_mappings
for all to authenticated
using ((select boy_central_private.has_branch_access(branch_id, array['admin','manager'])))
with check ((select boy_central_private.has_branch_access(branch_id, array['admin','manager'])));

revoke all on boy_central.pos_master_mappings from public, anon;
grant select, insert, update on boy_central.pos_master_mappings to authenticated;

create or replace function boy_central.stage_pos_master_snapshot(payload jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_branch boy_central.branches%rowtype;
  source_name text := coalesce(nullif(payload->>'source_system',''), 'burger_pos_app_state');
  entry jsonb;
  matched_item_id uuid;
  matched_menu_id uuid;
  ingredient_count integer := 0;
  product_count integer := 0;
begin
  select * into target_branch
  from boy_central.branches
  where id = nullif(payload->>'branch_id','')::uuid and active;

  if target_branch.id is null then raise exception 'active branch not found'; end if;
  if (select auth.uid()) is null
    or not boy_central_private.has_branch_access(target_branch.id, array['admin','manager']) then
    raise exception 'branch access denied';
  end if;

  for entry in select value from jsonb_array_elements(coalesce(payload->'ingredients','[]'::jsonb))
  loop
    matched_item_id := null;
    select i.id into matched_item_id
    from boy_central.items i
    join boy_central.branch_items bi on bi.item_id=i.id and bi.branch_id=target_branch.id and bi.active
    where i.company_id=target_branch.company_id and i.active
      and lower(regexp_replace(trim(i.name),'\\s+','','g')) = lower(regexp_replace(trim(entry->>'name'),'\\s+','','g'))
    order by i.code limit 1;

    insert into boy_central.pos_master_mappings (
      company_id,branch_id,source_system,entity_type,legacy_key,source_name,item_id,match_status,source_payload
    ) values (
      target_branch.company_id,target_branch.id,source_name,'ingredient',entry->>'id',
      coalesce(nullif(entry->>'name',''),entry->>'id'),matched_item_id,
      case when matched_item_id is null then 'review' else 'matched' end,entry
    ) on conflict (branch_id,source_system,entity_type,legacy_key) do update set
      source_name=excluded.source_name,
      item_id=coalesce(boy_central.pos_master_mappings.item_id,excluded.item_id),
      match_status=case when boy_central.pos_master_mappings.match_status='ignored' then 'ignored'
                        when coalesce(boy_central.pos_master_mappings.item_id,excluded.item_id) is null then 'review'
                        else 'matched' end,
      source_payload=excluded.source_payload,
      updated_at=now();
    ingredient_count := ingredient_count + 1;
  end loop;

  for entry in select value from jsonb_array_elements(coalesce(payload->'products','[]'::jsonb))
  loop
    matched_menu_id := null;
    select m.id into matched_menu_id from boy_central.menus m
    where m.company_id=target_branch.company_id and m.active
      and lower(regexp_replace(trim(m.name),'\\s+','','g')) = lower(regexp_replace(trim(entry->>'name'),'\\s+','','g'))
    order by m.code limit 1;

    insert into boy_central.pos_master_mappings (
      company_id,branch_id,source_system,entity_type,legacy_key,source_name,menu_id,match_status,source_payload
    ) values (
      target_branch.company_id,target_branch.id,source_name,'product',entry->>'id',
      coalesce(nullif(entry->>'name',''),entry->>'id'),matched_menu_id,
      case when matched_menu_id is null then 'review' else 'matched' end,entry
    ) on conflict (branch_id,source_system,entity_type,legacy_key) do update set
      source_name=excluded.source_name,
      menu_id=coalesce(boy_central.pos_master_mappings.menu_id,excluded.menu_id),
      match_status=case when boy_central.pos_master_mappings.match_status='ignored' then 'ignored'
                        when coalesce(boy_central.pos_master_mappings.menu_id,excluded.menu_id) is null then 'review'
                        else 'matched' end,
      source_payload=excluded.source_payload,
      updated_at=now();
    product_count := product_count + 1;
  end loop;

  return jsonb_build_object('status','success','ingredients',ingredient_count,'products',product_count);
end;
$$;

revoke all on function boy_central.stage_pos_master_snapshot(jsonb) from public, anon;
grant execute on function boy_central.stage_pos_master_snapshot(jsonb) to authenticated;

create or replace function boy_central.get_pos_sync_bootstrap(target_branch_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if (select auth.uid()) is null
    or not boy_central_private.has_branch_access(target_branch_id, null) then
    raise exception 'branch access denied';
  end if;

  select jsonb_build_object(
    'branch_id', b.id,
    'branch_code', b.code,
    'mappings', coalesce((
      select jsonb_agg(jsonb_build_object(
        'entity_type',m.entity_type,'legacy_key',m.legacy_key,'source_name',m.source_name,
        'item_id',m.item_id,'menu_id',m.menu_id,'match_status',m.match_status
      ) order by m.entity_type,m.source_name)
      from boy_central.pos_master_mappings m where m.branch_id=b.id
    ), '[]'::jsonb),
    'summary', (select jsonb_build_object(
      'matched',count(*) filter (where match_status='matched'),
      'review',count(*) filter (where match_status='review'),
      'ignored',count(*) filter (where match_status='ignored')
    ) from boy_central.pos_master_mappings where branch_id=b.id)
  ) into result
  from boy_central.branches b where b.id=target_branch_id and b.active;

  if result is null then raise exception 'active branch not found'; end if;
  return result;
end;
$$;

revoke all on function boy_central.get_pos_sync_bootstrap(uuid) from public, anon;
grant execute on function boy_central.get_pos_sync_bootstrap(uuid) to authenticated;

notify pgrst, 'reload schema';
