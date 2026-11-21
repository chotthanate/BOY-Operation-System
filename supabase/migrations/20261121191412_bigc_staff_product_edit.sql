create or replace function boy_central.edit_bigc_v2_product(payload jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  target_branch uuid;
  settings boy_central.bigc_workflow_settings%rowtype;
  original jsonb;
  changes jsonb;
  expected jsonb;
  item_key text:=payload->>'key';
  item_name text:=trim(payload->>'name');
  category text:=trim(payload->>'category');
  unit text:=trim(payload->>'unit');
  display_name text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if jsonb_typeof(payload) is distinct from 'object' or
    payload - array['key','name','category','unit','active','expected'] <> '{}'::jsonb then
    raise exception 'only product name, category, unit and visibility may be changed';
  end if;
  if coalesce(item_key,'')='' or coalesce(item_name,'')='' or coalesce(category,'')='' or unit is null
    or length(item_name)>200 or length(category)>100 or length(unit)>50
    or jsonb_typeof(payload->'active') is distinct from 'boolean'
    or jsonb_typeof(payload->'expected') is distinct from 'object' then
    raise exception 'invalid product fields';
  end if;
  select id into target_branch from boy_central.branches
    where code=boy_central_private.current_bigc_branch_code() and active;
  if target_branch is null or not boy_central_private.has_branch_access(target_branch,array['admin','manager','staff']) then
    raise exception 'BigC branch access required';
  end if;
  select * into settings from boy_central.bigc_workflow_settings where branch_id=target_branch for update;
  select item into original from jsonb_array_elements(settings.menu_config) item where item->>'key'=item_key;
  if original is null then raise exception 'product not found'; end if;
  expected:=jsonb_build_object('name',coalesce(original->>'name',original->>'displayName'),
    'category',original->>'category','unit',coalesce(original->>'unit',''),
    'active',coalesce((original->>'active')::boolean,true));
  if payload->'expected' is distinct from expected then
    raise exception 'รายการนี้เปลี่ยนจากเครื่องอื่นแล้ว กรุณาอัปเดตข้อมูลและลองใหม่';
  end if;
  display_name:=case when unit='' then item_name else item_name||' ('||unit||')' end;
  if exists(select 1 from jsonb_array_elements(settings.menu_config) item
    where item->>'key'<>item_key and item->>'displayName'=display_name) then
    raise exception 'มีรายการชื่อนี้แล้ว';
  end if;
  changes:=jsonb_build_object('name',item_name,'category',category,'unit',unit,
    'displayName',display_name,'active',payload->'active');
  update boy_central.bigc_workflow_settings s set
    menu_config=(select jsonb_agg(case when item->>'key'=item_key then item||changes else item end order by ord)
      from jsonb_array_elements(s.menu_config) with ordinality row(item,ord)),
    version=s.version+1,updated_by=auth.uid(),updated_at=now()
    where branch_id=target_branch returning * into settings;
  return jsonb_build_object('menu_config',settings.menu_config,
    'default_return_keys',settings.default_return_keys,'version',settings.version);
end $$;
revoke all on function boy_central.edit_bigc_v2_product(jsonb) from public,anon;
grant execute on function boy_central.edit_bigc_v2_product(jsonb) to authenticated;

CREATE OR REPLACE FUNCTION boy_central.bigc_branch_request(target_branch_code text, operation text, arguments jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare branch boy_central.branches%rowtype; result jsonb; previous_scope text;
begin
  if auth.uid() is null then raise exception 'authentication required'; end if;
  if target_branch_code not in ('BIGC-CENTRAL-PATTAYA','BIGC-SOUTH-PATTAYA') then raise exception 'unsupported BigC branch'; end if;
  select * into branch from boy_central.branches where code=target_branch_code and active;
  if branch.id is null or not boy_central_private.has_branch_access(branch.id,array['admin','manager','staff'])
    then raise exception 'branch access denied'; end if;
  if nullif(arguments#>>'{payload,source_workflow_id}','') is not null and not exists(
    select 1 from boy_central.bigc_workflows w where w.id=(arguments#>>'{payload,source_workflow_id}')::uuid and w.branch_id=branch.id)
    then raise exception 'source workflow belongs to another branch'; end if;
  previous_scope:=current_setting('boy.bigc_branch_code',true);
  perform set_config('boy.bigc_branch_code',target_branch_code,true);
  case operation
    when 'get_bigc_v2_context' then result:=boy_central.get_bigc_v2_context((arguments->>'target_date')::date);
    when 'get_bigc_v2_receive_history' then result:=boy_central.get_bigc_v2_receive_history((arguments->>'target_date')::date);
    when 'get_bigc_v2_receive_order_rounds' then result:=boy_central.get_bigc_v2_receive_order_rounds((arguments->>'target_date')::date);
    when 'get_bigc_v2_order_history' then result:=boy_central.get_bigc_v2_order_history(coalesce((arguments->>'max_rows')::integer,30));
    when 'save_bigc_v2_draft' then result:=boy_central.save_bigc_v2_draft(arguments->'payload');
    when 'edit_bigc_v2_product' then result:=boy_central.edit_bigc_v2_product(arguments->'payload');
    when 'save_bigc_v2_settings' then result:=boy_central.save_bigc_v2_settings(arguments->'payload');
    when 'save_bigc_v2_default_returns' then result:=boy_central.save_bigc_v2_default_returns(arguments->'payload');
    when 'save_bigc_v2_workflow' then result:=boy_central.save_bigc_v2_workflow(arguments->'payload');
    when 'append_bigc_v2_order' then result:=boy_central.append_bigc_v2_order(arguments->'payload');
    when 'append_bigc_v2_receive' then result:=boy_central.append_bigc_v2_receive(arguments->'payload');
    when 'ensure_bigc_catalog_items' then result:=boy_central.ensure_bigc_catalog_items(array(select jsonb_array_elements_text(arguments->'target_codes')));
    when 'get_bigc_fruit_cost_settings' then result:=boy_central.get_bigc_fruit_cost_settings();
    when 'admin_save_bigc_piece_weight' then result:=boy_central.admin_save_bigc_piece_weight(arguments->'payload');
    when 'mark_bigc_v2_sheet_sync' then
      if not exists(select 1 from boy_central.bigc_workflows w where w.id=(arguments->>'target_workflow_id')::uuid and w.branch_id=branch.id)
        then raise exception 'workflow belongs to another branch'; end if;
      result:=boy_central.mark_bigc_v2_sheet_sync((arguments->>'target_workflow_id')::uuid,arguments->>'sync_status',arguments->>'sync_error');
    else raise exception 'unsupported BigC operation';
  end case;
  if result ? 'mirror_payload' then result:=jsonb_set(result,'{mirror_payload}',(result->'mirror_payload')||jsonb_build_object('branch_code',target_branch_code)); end if;
  perform set_config('boy.bigc_branch_code',coalesce(previous_scope,''),true);
  return result;
exception when others then
  perform set_config('boy.bigc_branch_code',coalesce(previous_scope,''),true);
  raise;
end $function$
;
