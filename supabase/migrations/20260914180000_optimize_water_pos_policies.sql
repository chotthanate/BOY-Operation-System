create index if not exists pos_branch_configs_company_id_idx
  on boy_central.pos_branch_configs(company_id);
create index if not exists pos_branch_configs_updated_by_idx
  on boy_central.pos_branch_configs(updated_by);
create index if not exists pos_devices_company_id_idx
  on boy_central.pos_devices(company_id);
create index if not exists pos_sync_events_company_id_idx
  on boy_central.pos_sync_events(company_id);

drop policy if exists pos_branch_configs_write on boy_central.pos_branch_configs;
create policy pos_branch_configs_insert on boy_central.pos_branch_configs
  for insert to authenticated
  with check ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));
create policy pos_branch_configs_update on boy_central.pos_branch_configs
  for update to authenticated
  using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])))
  with check ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));
create policy pos_branch_configs_delete on boy_central.pos_branch_configs
  for delete to authenticated
  using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));

drop policy if exists pos_devices_write on boy_central.pos_devices;
create policy pos_devices_insert on boy_central.pos_devices
  for insert to authenticated
  with check ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));
create policy pos_devices_update on boy_central.pos_devices
  for update to authenticated
  using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])))
  with check ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));
create policy pos_devices_delete on boy_central.pos_devices
  for delete to authenticated
  using ((select boy_central_private.has_branch_access(branch_id,array['admin','manager'])));
