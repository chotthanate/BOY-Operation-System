create index if not exists purchase_receipts_company_id_idx
  on boy_central.purchase_receipts(company_id);
create index if not exists purchase_receipts_created_by_idx
  on boy_central.purchase_receipts(created_by) where created_by is not null;
create index if not exists purchase_receipts_received_by_idx
  on boy_central.purchase_receipts(received_by) where received_by is not null;
create index if not exists purchase_receipts_received_device_id_idx
  on boy_central.purchase_receipts(received_device_id) where received_device_id is not null;
create index if not exists purchase_receipt_lines_company_id_idx
  on boy_central.purchase_receipt_lines(company_id);
create index if not exists purchase_receipt_lines_branch_id_idx
  on boy_central.purchase_receipt_lines(branch_id);
create index if not exists purchase_receipt_lines_unit_id_idx
  on boy_central.purchase_receipt_lines(unit_id) where unit_id is not null;
