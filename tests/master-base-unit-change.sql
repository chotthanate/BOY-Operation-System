-- Run with BEGIN/ROLLBACK; uses the real admin RPC without retaining test edits.
do $test$
declare m boy_central.master_catalog_rows%rowtype;p boy_central.items%rowtype;
 target boy_central.units%rowtype;old_unit uuid;old_code text;result jsonb;history jsonb;changes jsonb;stale_payload jsonb;
begin
 perform set_config('request.jwt.claim.sub',(select user_id::text from boy_central.profiles where active and company_role='admin' limit 1),true);
 select * into strict p from boy_central.items where code='ITEM-0326';old_unit:=p.base_unit_id;
 select code into old_code from boy_central.units where id=old_unit;
 select * into strict target from boy_central.units where company_id=p.company_id and name=case when old_code='UNIT-015' then 'ไม้' else 'ชิ้น' end and active;
 select r.* into strict m from boy_central.master_catalog_rows r join boy_central.master_catalog_sheets s on s.id=r.sheet_id
  where s.sheet_name='M_สินค้า' and r.company_id=p.company_id and r.record_key=p.code;
 select jsonb_agg(to_jsonb(x) order by x.id) into history from boy_central.stock_movements x where item_id=p.id;
 stale_payload:=jsonb_build_object('item_id',p.code,'__version',m.source_version,'base_unit_id',target.code,'หมายเหตุ','QA base-unit atomic save');
 result:=boy_central.change_master_base_unit_one_to_one(stale_payload,'QA rollback');
 if (select base_unit_id from boy_central.items where id=p.id)<>target.id then raise exception 'new unit not applied';end if;
 if not exists(select 1 from boy_central.item_units where item_id=p.id and unit_id=old_unit and conversion_to_base=1 and not is_base_unit) then raise exception 'historical unit lost';end if;
 if not exists(select 1 from boy_central.item_units where item_id=p.id and unit_id=target.id and conversion_to_base=1 and is_base_unit) then raise exception 'new base link missing';end if;
 if not exists(select 1 from boy_central.master_runtime_links where master_row_id=m.id and status='ready' and source_data->>'base_unit_id'=target.code) then raise exception 'runtime link inconsistent';end if;
 if result->'unitCatalog' is null then raise exception 'fresh related catalog not returned';end if;
 if (select row_data->>'หมายเหตุ' from boy_central.master_catalog_rows where id=m.id)<>'QA base-unit atomic save' then raise exception 'other item edits lost';end if;
 select jsonb_agg(to_jsonb(x) order by x.id) into changes from boy_central.stock_movements x where item_id=p.id;
 if history is distinct from changes then raise exception 'stock history changed';end if;
 begin
  perform boy_central.change_master_base_unit_one_to_one(stale_payload,'QA stale');
  raise exception 'stale edit accepted';
 exception when others then if sqlerrm='stale edit accepted' then raise;end if;end;
 select * into m from boy_central.master_catalog_rows where id=m.id;
 begin
  perform boy_central.change_master_base_unit_one_to_one(jsonb_build_object('item_id',p.code,'__version',m.source_version,'base_unit_id','UNIT-011'),'QA reject weight');
  raise exception 'non-count conversion accepted';
 exception when others then if sqlerrm='non-count conversion accepted' then raise;end if;end;
 if (select base_unit_id from boy_central.items where id=p.id)<>target.id then raise exception 'rejected conversion changed item';end if;
 begin
  perform boy_central.change_master_base_unit_one_to_one(jsonb_build_object('item_id',p.code,'__version',m.source_version,'base_unit_id',old_code,'stock_target_item_id','group-must-not-change'),'QA reject pool');
  raise exception 'stock pool conversion accepted';
 exception when others then if sqlerrm='stock pool conversion accepted' then raise;end if;end;
 if has_function_privilege('anon','boy_central.change_master_base_unit_one_to_one(jsonb,text)','execute') then raise exception 'anonymous conversion allowed';end if;
 perform set_config('request.jwt.claim.sub','00000000-0000-4000-8000-000000000001',true);
 begin
  perform boy_central.change_master_base_unit_one_to_one(stale_payload,'QA not admin');
  raise exception 'non-admin conversion accepted';
 exception when others then
  if sqlerrm not like '%เฉพาะแอดมิน%' then raise;end if;
 end;
end $test$;
select '1:1 save, retained old unit, linked catalog, history, stale edits and non-count guards passed; rollback required' result;
