-- Initial, non-destructive import from the current Burger POS JSON snapshot.
-- Stock and historical orders are intentionally not imported by this migration.
with burger as (
  select id,company_id from boy_central.branches where code='BURGER' and active limit 1
), source_rows as (
  select value as entry from public.pos_app_state s,
    lateral jsonb_array_elements(s.payload) value
  where s.store_id='boy-burger-main' and s.key='ingredients'
), candidates as (
  select b.id branch_id,b.company_id,s.entry,
    (select i.id from boy_central.items i
     join boy_central.branch_items bi on bi.item_id=i.id and bi.branch_id=b.id and bi.active
     where i.company_id=b.company_id and i.active
       and lower(regexp_replace(trim(i.name),'\s+','','g'))=lower(regexp_replace(trim(s.entry->>'name'),'\s+','','g'))
     order by i.code limit 1) item_id
  from burger b cross join source_rows s
)
insert into boy_central.pos_master_mappings(
  company_id,branch_id,source_system,entity_type,legacy_key,source_name,item_id,match_status,source_payload
)
select company_id,branch_id,'burger_pos_app_state','ingredient',entry->>'id',entry->>'name',item_id,
  case when item_id is null then 'review' else 'matched' end,entry
from candidates
on conflict (branch_id,source_system,entity_type,legacy_key) do update set
  source_name=excluded.source_name,item_id=coalesce(boy_central.pos_master_mappings.item_id,excluded.item_id),
  match_status=case when coalesce(boy_central.pos_master_mappings.item_id,excluded.item_id) is null then 'review' else 'matched' end,
  source_payload=excluded.source_payload,updated_at=now();

with burger as (
  select id,company_id from boy_central.branches where code='BURGER' and active limit 1
), products as (
  select value as entry from public.pos_app_state s,
    lateral jsonb_array_elements(s.payload) value
  where s.store_id='boy-burger-main' and s.key='products'
)
insert into boy_central.menus(company_id,code,name,base_price,active)
select b.company_id,'POS-' || left(regexp_replace(p.entry->>'id','[^A-Za-z0-9_-]','','g'),90),
  p.entry->>'name',coalesce((p.entry->>'price')::numeric,0),coalesce((p.entry->>'active')::boolean,true)
from burger b cross join products p
on conflict (company_id,code) do update set
  name=excluded.name,base_price=excluded.base_price,active=excluded.active,updated_at=now();

with burger as (
  select id,company_id from boy_central.branches where code='BURGER' and active limit 1
), products as (
  select value as entry from public.pos_app_state s,
    lateral jsonb_array_elements(s.payload) value
  where s.store_id='boy-burger-main' and s.key='products'
)
insert into boy_central.pos_master_mappings(
  company_id,branch_id,source_system,entity_type,legacy_key,source_name,menu_id,match_status,source_payload
)
select b.company_id,b.id,'burger_pos_app_state','product',p.entry->>'id',p.entry->>'name',m.id,'matched',p.entry
from burger b cross join products p
join boy_central.menus m on m.company_id=b.company_id
  and m.code='POS-' || left(regexp_replace(p.entry->>'id','[^A-Za-z0-9_-]','','g'),90)
on conflict (branch_id,source_system,entity_type,legacy_key) do update set
  source_name=excluded.source_name,menu_id=excluded.menu_id,match_status='matched',
  source_payload=excluded.source_payload,updated_at=now();

with burger as (
  select id,company_id from boy_central.branches where code='BURGER' and active limit 1
), source_recipes as (
  select value as entry from public.pos_app_state s,
    lateral jsonb_array_elements(s.payload) value
  where s.store_id='boy-burger-main' and s.key='recipes'
), resolved as (
  select b.company_id,pm.menu_id,im.item_id,(r.entry->>'quantity')::numeric quantity_base
  from burger b cross join source_recipes r
  join boy_central.pos_master_mappings pm on pm.branch_id=b.id and pm.entity_type='product'
    and pm.legacy_key=r.entry->>'productId' and pm.match_status='matched'
  join boy_central.pos_master_mappings im on im.branch_id=b.id and im.entity_type='ingredient'
    and im.legacy_key=r.entry->>'ingredientId' and im.match_status='matched'
  where pm.menu_id is not null and im.item_id is not null and (r.entry->>'quantity')::numeric >= 0
)
insert into boy_central.recipes(company_id,menu_id,item_id,quantity_base,active)
select company_id,menu_id,item_id,quantity_base,true from resolved
on conflict (menu_id,item_id) do update set quantity_base=excluded.quantity_base,active=true,updated_at=now();
