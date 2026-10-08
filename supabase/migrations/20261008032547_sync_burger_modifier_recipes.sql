-- Share Burger POS modifier recipes with BOY Central using canonical stock items.

create table if not exists boy_central.pos_modifier_recipes (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  modifier_key text not null,
  item_id uuid not null references boy_central.items(id),
  quantity_base numeric not null check (quantity_base <> 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(branch_id,modifier_key,item_id)
);

create index if not exists pos_modifier_recipes_company_id_idx on boy_central.pos_modifier_recipes(company_id);
create index if not exists pos_modifier_recipes_branch_id_idx on boy_central.pos_modifier_recipes(branch_id);
create index if not exists pos_modifier_recipes_item_id_idx on boy_central.pos_modifier_recipes(item_id);

drop trigger if exists pos_modifier_recipes_set_updated_at on boy_central.pos_modifier_recipes;
create trigger pos_modifier_recipes_set_updated_at before update on boy_central.pos_modifier_recipes
for each row execute function boy_central_private.set_updated_at();

alter table boy_central.pos_modifier_recipes enable row level security;
drop policy if exists pos_modifier_recipes_branch_select on boy_central.pos_modifier_recipes;
create policy pos_modifier_recipes_branch_select on boy_central.pos_modifier_recipes
for select to authenticated using ((select boy_central_private.has_branch_access(branch_id,null)));
drop policy if exists pos_modifier_recipes_branch_write on boy_central.pos_modifier_recipes;
create policy pos_modifier_recipes_branch_write on boy_central.pos_modifier_recipes
for all to authenticated
using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])))
with check ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));

revoke all on boy_central.pos_modifier_recipes from public,anon;
grant select,insert,update,delete on boy_central.pos_modifier_recipes to authenticated;

-- Import the current tablet modifier master without changing the local POS records.
with burger as (
  select id,company_id from boy_central.branches where code='BURGER' and active limit 1
), source_modifiers as (
  select value as entry from public.pos_app_state s,
    lateral jsonb_array_elements(s.payload) value
  where s.store_id='boy-burger-main' and s.key='modifiers'
)
insert into boy_central.pos_master_mappings(
  company_id,branch_id,source_system,entity_type,legacy_key,source_name,match_status,source_payload
)
select b.company_id,b.id,'burger_pos_app_state','modifier',m.entry->>'id',
  coalesce(nullif(m.entry->>'label',''),m.entry->>'id'),'matched',m.entry
from burger b cross join source_modifiers m
where nullif(m.entry->>'id','') is not null
on conflict(branch_id,source_system,entity_type,legacy_key) do update set
  source_name=excluded.source_name,match_status='matched',source_payload=excluded.source_payload,updated_at=now();

with burger as (
  select id,company_id from boy_central.branches where code='BURGER' and active limit 1
), source_recipes as (
  select value as entry from public.pos_app_state s,
    lateral jsonb_array_elements(s.payload) value
  where s.store_id='boy-burger-main' and s.key='modifierRecipes'
), resolved as (
  select b.company_id,b.id branch_id,r.entry->>'modifierId' modifier_key,
    coalesce(i.stock_target_item_id,i.id) item_id,(r.entry->>'quantity')::numeric quantity_base
  from burger b cross join source_recipes r
  join boy_central.pos_master_mappings mm on mm.branch_id=b.id and mm.entity_type='modifier'
    and mm.legacy_key=r.entry->>'modifierId' and mm.match_status='matched'
  join boy_central.pos_master_mappings im on im.branch_id=b.id and im.entity_type='ingredient'
    and im.legacy_key=r.entry->>'ingredientId' and im.match_status='matched'
  join boy_central.items i on i.id=im.item_id
  where im.item_id is not null and coalesce((r.entry->>'quantity')::numeric,0)<>0
)
insert into boy_central.pos_modifier_recipes(company_id,branch_id,modifier_key,item_id,quantity_base,active)
select company_id,branch_id,modifier_key,item_id,quantity_base,true from resolved
on conflict(branch_id,modifier_key,item_id) do update set
  quantity_base=excluded.quantity_base,active=true,updated_at=now();

create or replace function boy_central.admin_save_branch_modifier_recipe(payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare target_branch boy_central.branches%rowtype; target_modifier boy_central.pos_master_mappings%rowtype;
  recipe_line jsonb; requested_item boy_central.items%rowtype; canonical_item_id uuid; saved_count integer:=0;
begin
  select * into target_branch from boy_central.branches
  where code=upper(trim(payload->>'branch_code')) and active limit 1;
  if target_branch.id is null or not boy_central_private.has_branch_access(target_branch.id,array['manager']) then
    raise exception 'branch access denied';
  end if;
  select * into target_modifier from boy_central.pos_master_mappings
  where branch_id=target_branch.id and entity_type='modifier'
    and legacy_key=payload->>'modifier_key' and match_status='matched' limit 1;
  if target_modifier.id is null then raise exception 'modifier is not available for this branch'; end if;
  if jsonb_typeof(coalesce(payload->'lines','[]'::jsonb))<>'array' then
    raise exception 'modifier recipe lines must be an array';
  end if;
  delete from boy_central.pos_modifier_recipes
  where branch_id=target_branch.id and modifier_key=target_modifier.legacy_key;
  for recipe_line in select value from jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)) loop
    select * into requested_item from boy_central.items
    where id=nullif(recipe_line->>'item_id','')::uuid and company_id=target_branch.company_id and active;
    canonical_item_id:=coalesce(requested_item.stock_target_item_id,requested_item.id);
    if canonical_item_id is null or not exists(
      select 1 from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id
      where i.id=canonical_item_id and i.track_stock and i.stock_target_item_id is null
        and bi.branch_id=target_branch.id and bi.active
    ) then raise exception 'modifier recipe item must be canonical stock'; end if;
    if coalesce((recipe_line->>'quantity')::numeric,0)=0 then raise exception 'modifier recipe quantity cannot be zero'; end if;
    insert into boy_central.pos_modifier_recipes(company_id,branch_id,modifier_key,item_id,quantity_base,active)
    values(target_branch.company_id,target_branch.id,target_modifier.legacy_key,canonical_item_id,
      (recipe_line->>'quantity')::numeric,true)
    on conflict(branch_id,modifier_key,item_id) do update set
      quantity_base=excluded.quantity_base,active=true,updated_at=now();
    saved_count:=saved_count+1;
  end loop;
  insert into boy_central.pos_branch_configs(company_id,branch_id,config,version)
  values(target_branch.company_id,target_branch.id,'{}'::jsonb,1)
  on conflict(branch_id) do update set version=boy_central.pos_branch_configs.version+1,updated_at=now();
  return jsonb_build_object('status','saved','modifier_key',target_modifier.legacy_key,'line_count',saved_count);
end $$;

revoke all on function boy_central.admin_save_branch_modifier_recipe(jsonb) from public,anon;
grant execute on function boy_central.admin_save_branch_modifier_recipe(jsonb) to authenticated;

create or replace function boy_central.save_pos_device_modifier_recipe(device_token text,payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; target_modifier_key text; modifier_label text;
  recipe_line jsonb; source_item_id uuid; canonical_item_id uuid; saved_count integer:=0;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  target_modifier_key:=nullif(trim(payload->>'modifier_id'),'');
  modifier_label:=coalesce(nullif(trim(payload->>'modifier_label'),''),target_modifier_key);
  if target_modifier_key is null then raise exception 'modifier id is required'; end if;
  insert into boy_central.pos_master_mappings(
    company_id,branch_id,source_system,entity_type,legacy_key,source_name,match_status,source_payload
  ) values(
    d.company_id,d.branch_id,'burger_pos_app_state','modifier',target_modifier_key,modifier_label,'matched',
    coalesce(payload->'modifier','{}'::jsonb)
  ) on conflict(branch_id,source_system,entity_type,legacy_key) do update set
    source_name=excluded.source_name,match_status='matched',source_payload=excluded.source_payload,updated_at=now();
  if jsonb_typeof(coalesce(payload->'lines','[]'::jsonb))<>'array' then
    raise exception 'modifier recipe lines must be an array';
  end if;
  delete from boy_central.pos_modifier_recipes mr
  where mr.branch_id=d.branch_id and mr.modifier_key=target_modifier_key;
  for recipe_line in select value from jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)) loop
    select m.item_id into source_item_id from boy_central.pos_master_mappings m
    where m.branch_id=d.branch_id and m.entity_type='ingredient'
      and m.legacy_key=recipe_line->>'ingredient_id' limit 1;
    select coalesce(i.stock_target_item_id,i.id) into canonical_item_id
    from boy_central.items i where i.id=source_item_id;
    if canonical_item_id is null or not exists(
      select 1 from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id
      where i.id=canonical_item_id and i.track_stock and i.stock_target_item_id is null
        and bi.branch_id=d.branch_id and bi.active
    ) then raise exception 'modifier recipe ingredient must map to canonical stock'; end if;
    if coalesce((recipe_line->>'quantity')::numeric,0)=0 then raise exception 'modifier recipe quantity cannot be zero'; end if;
    insert into boy_central.pos_modifier_recipes(company_id,branch_id,modifier_key,item_id,quantity_base,active)
    values(d.company_id,d.branch_id,target_modifier_key,canonical_item_id,(recipe_line->>'quantity')::numeric,true)
    on conflict(branch_id,modifier_key,item_id) do update set
      quantity_base=excluded.quantity_base,active=true,updated_at=now();
    saved_count:=saved_count+1;
  end loop;
  insert into boy_central.pos_branch_configs(company_id,branch_id,config,version)
  values(d.company_id,d.branch_id,'{}'::jsonb,1)
  on conflict(branch_id) do update set version=boy_central.pos_branch_configs.version+1,updated_at=now();
  update boy_central.pos_devices set last_seen_at=now(),last_sync_at=now() where id=d.id;
  return jsonb_build_object('status','saved','modifier_id',target_modifier_key,'line_count',saved_count);
end $$;

create or replace function boy_central.get_pos_device_bootstrap_v2(device_token text)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; result jsonb;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  result:=boy_central.get_pos_device_bootstrap(device_token);
  return result || jsonb_build_object(
    'product_mappings',coalesce((select jsonb_agg(jsonb_build_object(
      'legacy_key',m.legacy_key,'source_name',m.source_name,'menu_id',m.menu_id,'menu_name',menu.name
    ) order by m.legacy_key)
      from boy_central.pos_master_mappings m
      join boy_central.menus menu on menu.id=m.menu_id and menu.active
      where m.branch_id=d.branch_id and m.entity_type='product'),'[]'::jsonb),
    'modifier_mappings',coalesce((select jsonb_agg(jsonb_build_object(
      'legacy_key',m.legacy_key,'source_name',m.source_name,'source_payload',m.source_payload
    ) order by m.source_name)
      from boy_central.pos_master_mappings m
      where m.branch_id=d.branch_id and m.entity_type='modifier' and m.match_status='matched'),'[]'::jsonb),
    'modifier_recipes',coalesce((select jsonb_agg(jsonb_build_object(
      'modifier_id',mr.modifier_key,'modifier_name',mm.source_name,'ingredient_id',im.legacy_key,
      'central_item_id',target.id,'central_item_name',target.name,'quantity',mr.quantity_base
    ) order by mm.source_name,target.name)
      from boy_central.pos_modifier_recipes mr
      join boy_central.pos_master_mappings mm on mm.branch_id=mr.branch_id
        and mm.entity_type='modifier' and mm.legacy_key=mr.modifier_key
      join boy_central.items target on target.id=mr.item_id
      join lateral (
        select m.legacy_key from boy_central.pos_master_mappings m
        join boy_central.items mapped on mapped.id=m.item_id
        where m.branch_id=mr.branch_id and m.entity_type='ingredient'
          and coalesce(mapped.stock_target_item_id,mapped.id)=target.id
        order by (mapped.id=target.id) desc,m.updated_at desc limit 1
      ) im on true
      where mr.branch_id=d.branch_id and mr.active and target.track_stock),'[]'::jsonb)
  );
end $$;

create or replace function public.pos_save_modifier_recipe(device_token text,payload jsonb)
returns jsonb language sql security definer set search_path=''
as $$ select boy_central.save_pos_device_modifier_recipe(device_token,payload); $$;

revoke all on function boy_central.save_pos_device_modifier_recipe(text,jsonb) from public,anon,authenticated;
revoke all on function public.pos_save_modifier_recipe(text,jsonb) from public;
grant execute on function public.pos_save_modifier_recipe(text,jsonb) to anon,authenticated;

notify pgrst,'reload schema';
