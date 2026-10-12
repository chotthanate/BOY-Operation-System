-- The partial bulk-upsert RPC only accepts fields declared in sheet headers.
-- Keep the stock mode and target alongside the existing tracking flag.
update boy_central.master_catalog_sheets
set headers = headers || '"รูปแบบสต็อก"'::jsonb
where sheet_name = 'M_สินค้า'
  and not headers ? 'รูปแบบสต็อก';

update boy_central.master_catalog_sheets
set headers = headers || '"stock_target_item_id"'::jsonb
where sheet_name = 'M_สินค้า'
  and not headers ? 'stock_target_item_id';
