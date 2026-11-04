-- Existing clients retain the central branch. The scoped API selects a branch
-- only for the duration of its transaction and checks the caller's branch role.
create or replace function boy_central_private.current_bigc_branch_code()
returns text language sql stable set search_path='' as $$
  select coalesce(nullif(current_setting('boy.bigc_branch_code',true),''),'BIGC-CENTRAL-PATTAYA')
$$;
revoke all on function boy_central_private.current_bigc_branch_code() from public,anon,authenticated;

do $scope$
declare fn record; definition text;
begin
  for fn in select p.oid,p.proname from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='boy_central' and p.proname=any(array[
      'append_bigc_v2_order','ensure_bigc_catalog_items','get_bigc_fruit_cost_settings',
      'get_bigc_v2_context','get_bigc_v2_order_history','get_bigc_v2_receive_order_rounds',
      'save_bigc_v2_default_returns','save_bigc_v2_draft','save_bigc_v2_settings',
      'save_bigc_v2_settings_before_selective_stock','save_bigc_v2_workflow_before_selective_stock'])
  loop
    definition:=pg_get_functiondef(fn.oid);
    if position('''BIGC-CENTRAL-PATTAYA''' in definition)>0 then
      execute replace(definition,'''BIGC-CENTRAL-PATTAYA''','boy_central_private.current_bigc_branch_code()');
    elsif position('current_bigc_branch_code()' in definition)=0 then
      raise exception 'unexpected branch lookup in %',fn.proname;
    end if;
  end loop;
end $scope$;

create or replace function boy_central.bigc_branch_request(target_branch_code text,operation text,arguments jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
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
end $$;
revoke all on function boy_central.bigc_branch_request(text,text,jsonb) from public,anon;
grant execute on function boy_central.bigc_branch_request(text,text,jsonb) to authenticated;

do $branch$
declare source boy_central.branches%rowtype; target boy_central.branches%rowtype;
  location_uuid uuid; sheet_uuid uuid; next_row integer;
begin
  select * into source from boy_central.branches where code='BIGC-CENTRAL-PATTAYA' and active;
  if source.id is null then raise exception 'source BigC branch missing'; end if;
  insert into boy_central.branches(company_id,code,name,branch_type,timezone,active,opened_at,closed_at,note)
  values(source.company_id,'BIGC-SOUTH-PATTAYA','BigC พัทยาใต้',source.branch_type,'Asia/Bangkok',true,source.opened_at,source.closed_at,'สาขาพัทยาใต้ · แยกประวัติและสต็อกจากพัทยากลาง')
  on conflict(company_id,code) do update set active=true,name=excluded.name,updated_at=now()
  returning * into target;
  insert into boy_central.inventory_locations(company_id,branch_id,code,name,location_type,active)
  values(target.company_id,target.id,'BIGC-SOUTH-MAIN','จุดเก็บสินค้า BigC พัทยาใต้','main',true)
  on conflict(company_id,code) do update set active=true returning id into location_uuid;

  insert into boy_central.branch_items(company_id,branch_id,item_id,default_location_id,minimum_stock,reorder_point,target_stock,preferred_supplier_id,default_purchase_unit_id,default_issue_unit_id,notes,active)
  select target.company_id,target.id,item_id,location_uuid,minimum_stock,reorder_point,target_stock,preferred_supplier_id,default_purchase_unit_id,default_issue_unit_id,notes,active
  from boy_central.branch_items where branch_id=source.id on conflict(branch_id,item_id) do nothing;
  insert into boy_central.branch_expense_items(branch_id,expense_item_id,sort_order,active)
  select target.id,expense_item_id,sort_order,active from boy_central.branch_expense_items where branch_id=source.id on conflict(branch_id,expense_item_id) do nothing;
  insert into boy_central.branch_suppliers(branch_id,supplier_id,is_preferred,active)
  select target.id,supplier_id,is_preferred,active from boy_central.branch_suppliers where branch_id=source.id on conflict(branch_id,supplier_id) do nothing;
  insert into boy_central.branch_item_suppliers(branch_id,item_id,supplier_id,supplier_item_code,is_primary,last_purchase_price,active)
  select target.id,item_id,supplier_id,supplier_item_code,is_primary,last_purchase_price,active from boy_central.branch_item_suppliers where branch_id=source.id on conflict(branch_id,item_id,supplier_id) do nothing;
  insert into boy_central.user_branch_roles(company_id,user_id,branch_id,role,active)
  select target.company_id,user_id,target.id,'admin',true from boy_central.profiles where company_id=target.company_id and active and company_role='admin'
  on conflict(user_id,branch_id) do update set role='admin',active=true;
  insert into boy_central.user_branch_roles(company_id,user_id,branch_id,role,active)
  select target.company_id,user_id,target.id,role,true from boy_central.user_branch_roles where branch_id=source.id and active and role in ('admin','manager')
  on conflict(user_id,branch_id) do nothing;
  insert into boy_central.bigc_workflow_settings(branch_id,company_id,menu_config,default_return_keys,version)
  select target.id,target.company_id,menu_config,default_return_keys,1 from boy_central.bigc_workflow_settings where branch_id=source.id
  on conflict(branch_id) do nothing;
  insert into boy_central.bigc_interbranch_cost_rules(company_id,receiving_branch_id,received_item_id,raw_item_id,effective_month,active,counted_by_piece,note)
  select target.company_id,target.id,received_item_id,raw_item_id,effective_month,active,counted_by_piece,note from boy_central.bigc_interbranch_cost_rules where receiving_branch_id=source.id
  on conflict(receiving_branch_id,received_item_id,effective_month) do nothing;

  select id into sheet_uuid from boy_central.master_catalog_sheets where company_id=target.company_id and sheet_name='M_สาขา';
  update boy_central.master_catalog_rows set row_data=row_data||jsonb_build_object('ชื่อสาขา','BigC พัทยาใต้','รหัสสาขา','BIGC-SOUTH-PATTAYA','เปิดใช้งาน',true),active=true,updated_at=now()
  where sheet_id=sheet_uuid and record_key='BR-003';
  if not found then
    insert into boy_central.master_catalog_rows(company_id,sheet_id,row_number,record_key,row_data,active)
    select target.company_id,sheet_uuid,coalesce(max(row_number),0)+1,'BR-003',jsonb_build_object('branch_id','BR-003','ชื่อสาขา','BigC พัทยาใต้','รหัสสาขา','BIGC-SOUTH-PATTAYA','เปิดใช้งาน',true),true
    from boy_central.master_catalog_rows where sheet_id=sheet_uuid;
  end if;
  select id into sheet_uuid from boy_central.master_catalog_sheets where company_id=target.company_id and sheet_name='M_สินค้าสาขา';
  select coalesce(max(row_number),0) into next_row from boy_central.master_catalog_rows where sheet_id=sheet_uuid;
  insert into boy_central.master_catalog_rows(company_id,sheet_id,row_number,record_key,row_data,active)
  select target.company_id,sheet_uuid,next_row+row_number() over(order by i.code),'BRI-BR-003-'||i.code,
    jsonb_build_object('branch_item_id','BRI-BR-003-'||i.code,'branch_id','BR-003','item_id',i.code,'เปิดใช้งาน',bi.active,'default_purchase_unit_id',coalesce(pu.code,''),'default_issue_unit_id',coalesce(iu.code,''),'หมายเหตุ','BigC พัทยาใต้'),bi.active
  from boy_central.branch_items bi join boy_central.items i on i.id=bi.item_id
  left join boy_central.units pu on pu.id=bi.default_purchase_unit_id left join boy_central.units iu on iu.id=bi.default_issue_unit_id
  where bi.branch_id=target.id and not exists(select 1 from boy_central.master_catalog_rows r where r.sheet_id=sheet_uuid and r.record_key='BRI-BR-003-'||i.code);
end $branch$;
notify pgrst,'reload schema';
