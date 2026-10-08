-- Fix PL/pgSQL variable/column ambiguity in the legacy-only lookup path.
-- Positional parameters keep the already-published function signature stable.
create or replace function boy_central_private.resolve_pos_stock_item(
  target_branch_id uuid,
  requested_item_id text,
  legacy_key text default null,
  legacy_name text default null
)
returns table(item_id uuid, location_id uuid)
language plpgsql
stable
security definer
set search_path=''
as $$
declare requested_uuid uuid;
begin
  if nullif(trim(coalesce(requested_item_id,'')),'') is not null then
    if requested_item_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      return;
    end if;
    requested_uuid := requested_item_id::uuid;
    return query
      select coalesce(source_item.stock_target_item_id,source_item.id), target_link.default_location_id
      from boy_central.items source_item
      join boy_central.branch_items source_link
        on source_link.branch_id=target_branch_id and source_link.item_id=source_item.id and source_link.active
      join boy_central.items target_item on target_item.id=coalesce(source_item.stock_target_item_id,source_item.id)
      join boy_central.branch_items target_link
        on target_link.branch_id=target_branch_id and target_link.item_id=target_item.id and target_link.active
      where source_item.id=requested_uuid and target_item.track_stock
      limit 1;
    return;
  end if;

  return query
    with candidate as (
      select i.*
      from boy_central.pos_master_mappings m
      join boy_central.items i on i.id=m.item_id
      where m.branch_id=target_branch_id and m.entity_type='ingredient'
        and nullif(trim(coalesce($3,'')),'') is not null and m.legacy_key=$3
      union all
      select i.*
      from boy_central.items i
      join boy_central.branch_items bi on bi.branch_id=target_branch_id and bi.item_id=i.id and bi.active
      where nullif(trim(coalesce($4,'')),'') is not null and i.name=$4
        and not exists (
          select 1 from boy_central.pos_master_mappings m
          where m.branch_id=target_branch_id and m.entity_type='ingredient' and m.legacy_key=$3
        )
      limit 1
    )
    select coalesce(source_item.stock_target_item_id,source_item.id), target_link.default_location_id
    from candidate source_item
    join boy_central.items target_item on target_item.id=coalesce(source_item.stock_target_item_id,source_item.id)
    join boy_central.branch_items target_link
      on target_link.branch_id=target_branch_id and target_link.item_id=target_item.id and target_link.active
    where target_item.track_stock
    limit 1;
end $$;

revoke all on function boy_central_private.resolve_pos_stock_item(uuid,text,text,text) from public,anon,authenticated;
