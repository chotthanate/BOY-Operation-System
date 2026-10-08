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
      where m.branch_id=d.branch_id and m.entity_type='product'),'[]'::jsonb)
  );
end $$;

create or replace function boy_central.save_pos_device_recipe(device_token text, payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare d boy_central.pos_devices%rowtype; target_menu_id uuid; recipe_line jsonb;
  source_item_id uuid; canonical_item_id uuid; saved_count integer:=0;
begin
  select * into d from boy_central_private.pos_device_for_token(device_token);
  if d.id is null then raise exception 'device access denied'; end if;
  select m.menu_id into target_menu_id from boy_central.pos_master_mappings m
  where m.branch_id=d.branch_id and m.entity_type='product' and m.legacy_key=payload->>'product_id' limit 1;
  if target_menu_id is null then raise exception 'unknown POS product mapping'; end if;
  if jsonb_typeof(coalesce(payload->'lines','[]'::jsonb))<>'array' then raise exception 'recipe lines must be an array'; end if;
  delete from boy_central.recipes where company_id=d.company_id and menu_id=target_menu_id;
  for recipe_line in select value from jsonb_array_elements(coalesce(payload->'lines','[]'::jsonb)) loop
    select m.item_id into source_item_id from boy_central.pos_master_mappings m
    where m.branch_id=d.branch_id and m.entity_type='ingredient' and m.legacy_key=recipe_line->>'ingredient_id' limit 1;
    select coalesce(i.stock_target_item_id,i.id) into canonical_item_id from boy_central.items i where i.id=source_item_id;
    if canonical_item_id is null or not exists(
      select 1 from boy_central.items i join boy_central.branch_items bi on bi.item_id=i.id
      where i.id=canonical_item_id and i.track_stock and i.stock_target_item_id is null
        and bi.branch_id=d.branch_id and bi.active
    ) then raise exception 'recipe ingredient must map to canonical stock'; end if;
    if coalesce((recipe_line->>'quantity')::numeric,0)<=0 then raise exception 'recipe quantity must be greater than zero'; end if;
    insert into boy_central.recipes(company_id,menu_id,item_id,quantity_base,active)
    values(d.company_id,target_menu_id,canonical_item_id,(recipe_line->>'quantity')::numeric,true)
    on conflict(menu_id,item_id) do update set quantity_base=excluded.quantity_base,active=true,updated_at=now();
    saved_count:=saved_count+1;
  end loop;
  insert into boy_central.pos_branch_configs(company_id,branch_id,config,version)
  values(d.company_id,d.branch_id,'{}'::jsonb,1)
  on conflict(branch_id) do update set version=boy_central.pos_branch_configs.version+1,updated_at=now();
  update boy_central.pos_devices set last_seen_at=now(),last_sync_at=now() where id=d.id;
  return jsonb_build_object('status','saved','product_id',payload->>'product_id','line_count',saved_count);
end $$;

create or replace function public.pos_device_bootstrap(device_token text)
returns jsonb language sql security definer set search_path=''
as $$ select boy_central.get_pos_device_bootstrap_v2(device_token); $$;

create or replace function public.pos_save_recipe(device_token text,payload jsonb)
returns jsonb language sql security definer set search_path=''
as $$ select boy_central.save_pos_device_recipe(device_token,payload); $$;

revoke all on function boy_central.get_pos_device_bootstrap_v2(text) from public,anon,authenticated;
revoke all on function boy_central.save_pos_device_recipe(text,jsonb) from public,anon,authenticated;
revoke all on function public.pos_device_bootstrap(text) from public;
revoke all on function public.pos_save_recipe(text,jsonb) from public;
grant execute on function public.pos_device_bootstrap(text) to anon,authenticated;
grant execute on function public.pos_save_recipe(text,jsonb) to anon,authenticated;

notify pgrst,'reload schema';
