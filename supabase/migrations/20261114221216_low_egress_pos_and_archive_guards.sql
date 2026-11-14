-- Read-only projection: existing snapshots and local product images are kept.
create view public.pos_app_state_compact with(security_invoker=true) as
 select store_id,key,case when key='products' and jsonb_typeof(payload)='array' then
 (select coalesce(jsonb_agg(value-'imageDataUrl'-'imageName'-'imageSize'),'[]') from jsonb_array_elements(payload))
 else payload end payload,updated_at from public.pos_app_state;
grant select on public.pos_app_state_compact to anon,authenticated;

create function boy_central.get_pos_device_delta(device_token text,known_config text default null,known_stock text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare d boy_central.pos_devices%rowtype; config_version text;stock_version text;body jsonb;
begin
 select * into d from boy_central_private.pos_device_for_token(device_token);
 if d.id is null then raise exception 'device access denied';end if;
 select md5(concat((select version from boy_central.pos_branch_configs where branch_id=d.branch_id),
 (select max(updated_at) from boy_central.items where company_id=d.company_id),
 (select max(updated_at) from boy_central.units where company_id=d.company_id),
 (select max(updated_at) from boy_central.recipes where company_id=d.company_id),
 (select max(updated_at) from boy_central.pos_master_mappings where branch_id=d.branch_id))) into config_version;
 select md5(concat((select max(updated_at) from boy_central.inventory_balances where branch_id=d.branch_id),
 (select max(updated_at) from boy_central.branch_items where branch_id=d.branch_id))) into stock_version;
 if config_version is distinct from known_config then body:=boy_central.get_pos_device_bootstrap(device_token);
 elsif stock_version is distinct from known_stock then
 select jsonb_build_object('inventory',coalesce(jsonb_agg(jsonb_build_object('central_item_id',i.id,'name',i.name,'quantity',coalesce(ib.quantity_on_hand,0),'unit',u.name,'low_stock',bi.minimum_stock)),'[]')) into body
 from boy_central.branch_items bi join boy_central.items i on i.id=bi.item_id join boy_central.units u on u.id=i.base_unit_id
 left join boy_central.inventory_balances ib on ib.branch_id=bi.branch_id and ib.item_id=bi.item_id
 where bi.branch_id=d.branch_id and bi.active and i.track_stock and i.stock_target_item_id is null;
 else body:=jsonb_build_object('not_modified',true);end if;
 return body||jsonb_build_object('configuration_version',config_version,'stock_version',stock_version);
end $$;
revoke all on function boy_central.get_pos_device_delta(text,text,text) from public;
grant execute on function boy_central.get_pos_device_delta(text,text,text) to anon,authenticated;

create table boy_central.archive_manifests(
 id uuid primary key default gen_random_uuid(),company_id uuid not null references boy_central.companies(id),
 dataset text not null,date_from date not null,date_to date not null,archive_uri text not null,
 row_count bigint not null,sha256 text not null,verified_at timestamptz,restore_tested_at timestamptz,
 created_at timestamptz not null default now(),unique(company_id,dataset,date_from,date_to));
alter table boy_central.archive_manifests enable row level security;
revoke all on boy_central.archive_manifests from public,anon,authenticated;
create function boy_central.get_storage_guardrails()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare bytes bigint;
begin
 if not exists(select 1 from boy_central.profiles where user_id=auth.uid() and active and company_role='admin')then raise exception 'admin required';end if;
 bytes:=pg_database_size(current_database());
 return jsonb_build_object('database_bytes',bytes,'planning_quota_bytes',500*1024*1024,'warning_percent',60,'action_percent',75,'critical_percent',85,
 'egress_measured',false,'automatic_business_deletion',false,'archived_verified',(select count(*) from boy_central.archive_manifests where verified_at is not null and restore_tested_at is not null),
 'old_order_candidates',(select count(*) from boy_central.pos_orders where ordered_at<now()-interval '180 days'),
 'mirror_pending',(select count(*) from boy_central.mirror_jobs where status<>'synced'));
end $$;
revoke all on function boy_central.get_storage_guardrails() from public,anon;
grant execute on function boy_central.get_storage_guardrails() to authenticated;
notify pgrst,'reload schema';
