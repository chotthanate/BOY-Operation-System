create index if not exists bigc_workflows_company_id_idx
  on boy_central.bigc_workflows(company_id);
create index if not exists bigc_workflows_source_workflow_id_idx
  on boy_central.bigc_workflows(source_workflow_id)
  where source_workflow_id is not null;
create index if not exists bigc_workflows_submitted_by_idx
  on boy_central.bigc_workflows(submitted_by)
  where submitted_by is not null;
create index if not exists bigc_workflow_lines_company_id_idx
  on boy_central.bigc_workflow_lines(company_id);
create index if not exists bigc_workflow_lines_item_id_idx
  on boy_central.bigc_workflow_lines(item_id)
  where item_id is not null;
create index if not exists bigc_workflow_settings_company_id_idx
  on boy_central.bigc_workflow_settings(company_id);
create index if not exists bigc_workflow_settings_updated_by_idx
  on boy_central.bigc_workflow_settings(updated_by)
  where updated_by is not null;
create index if not exists bigc_workflow_drafts_company_id_idx
  on boy_central.bigc_workflow_drafts(company_id);
create index if not exists bigc_workflow_drafts_user_id_idx
  on boy_central.bigc_workflow_drafts(user_id);
