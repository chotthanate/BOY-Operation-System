-- Promote the current burger web catalog to BOY Central. Google Sheets is no
-- longer the runtime source for this page after this snapshot.
do $$
declare
  company uuid;
  burger uuid;
  entry jsonb;
  item_id_value uuid;
  unit_id_value uuid;
  category_id_value uuid;
  target_id_value uuid;
  expense_id_value uuid;
  catalog jsonb := $catalog$[
    ["ITEM-0271","ขนมปังเบอร์เกอร์ Lotus","UNIT-015","SUB-0049","group","ITEM-0336"],
    ["ITEM-0272","ขนมปังเบอร์เกอร์ Aro","UNIT-015","SUB-0049","group","ITEM-0336"],
    ["ITEM-0273","ขนมปังเบอร์เกอร์","UNIT-015","SUB-0049","group","ITEM-0336"],
    ["ITEM-0274","ชีส","UNIT-015","SUB-0050","self",null],
    ["ITEM-0275","ไข่","UNIT-022","SUB-0052","self",null],
    ["ITEM-0276","แฮม","UNIT-011","SUB-0053","self",null],
    ["ITEM-0277","เบคอน","UNIT-011","SUB-0054","self",null],
    ["ITEM-0278","เนื้อหมู","UNIT-015","SUB-0048","self",null],
    ["ITEM-0279","เนื้อไก่","UNIT-015","SUB-0048","self",null],
    ["ITEM-0280","เนื้อวัว","UNIT-015","SUB-0048","self",null],
    ["ITEM-0281","เนื้อปลา","UNIT-015","SUB-0048","self",null],
    ["ITEM-0282","เนื้อกุ้ง","UNIT-015","SUB-0048","self",null],
    ["ITEM-0283","เนื้อนกกระจอกเทศ","UNIT-011","SUB-0048","self",null],
    ["ITEM-0284","เนื้อแพะ","UNIT-015","SUB-0048","self",null],
    ["ITEM-0285","เนื้อกระต่าย","UNIT-015","SUB-0048","self",null],
    ["ITEM-0286","เนื้อกวาง","UNIT-015","SUB-0048","self",null],
    ["ITEM-0287","เนื้อวากิว","UNIT-011","SUB-0048","self",null],
    ["ITEM-0288","บาร์บีคิว หมู","UNIT-015","SUB-0057","self",null],
    ["ITEM-0289","บาร์บีคิว ไก่","UNIT-015","SUB-0057","self",null],
    ["ITEM-0290","บาร์บีคิว เนื้อ","UNIT-015","SUB-0057","self",null],
    ["ITEM-0291","บาร์บีคิว 3 ชั้น","UNIT-015","SUB-0057","self",null],
    ["ITEM-0292","บาร์บีคิว กุ้ง","UNIT-015","SUB-0057","self",null],
    ["ITEM-0293","บาร์บีคิว เห็ดออรินจิ","UNIT-015","SUB-0057","self",null],
    ["ITEM-0294","บาร์บีคิว กระเจี๊ยบ","UNIT-015","SUB-0057","self",null],
    ["ITEM-0295","บาร์บีคิว บรอกโคลี","UNIT-015","SUB-0057","self",null],
    ["ITEM-0296","ผักสด","UNIT-011","SUB-0051","self",null],
    ["ITEM-0297","ซอสมะเขือเทศ Aro 1000 กรัม","UNIT-021","SUB-0055","self",null],
    ["ITEM-0298","ซอสมะเขือเทศ Heinz 1000 กรัม","UNIT-021","SUB-0055","self",null],
    ["ITEM-0299","ซอสมะเขือเทศ Safepack 1000 กรัม","UNIT-021","SUB-0055","self",null],
    ["ITEM-0300","มายองเนส Aro 1000 กรัม","UNIT-021","SUB-0055","self",null],
    ["ITEM-0301","มายองเนส สุขุม 1000 กรัม","UNIT-021","SUB-0055","self",null],
    ["ITEM-0302","มายองเนสศรีราชา สุขุม 1000 กรัม","UNIT-021","SUB-0055","self",null],
    ["ITEM-0303","มายองเนสศรีราชา 1000 กรัม","UNIT-021","SUB-0055","self",null],
    ["ITEM-0304","มัสตาร์ด","UNIT-021","SUB-0055","self",null],
    ["ITEM-0305","มัสตาร์ด Aro 1000 กรัม","UNIT-021","SUB-0055","self",null],
    ["ITEM-0306","ผงหอม","UNIT-021","SUB-0086","self",null],
    ["ITEM-0307","ผงหอม Shopee","UNIT-021","SUB-0086","self",null],
    ["ITEM-0308","ผงกระเทียม","UNIT-021","SUB-0086","self",null],
    ["ITEM-0309","ผงกระเทียม Shopee","UNIT-021","SUB-0086","self",null],
    ["ITEM-0310","แตงกวาดอง หวาน","UNIT-021","SUB-0056","self",null],
    ["ITEM-0311","แตงกวาดอง เปรี้ยว","UNIT-021","SUB-0056","self",null],
    ["ITEM-0312","แตงกวาดอง","UNIT-021","SUB-0056","self",null],
    ["ITEM-0318","ถุง 5x8 นิ้ว","UNIT-002","SUB-0021","self",null],
    ["ITEM-0320","ถุงหิ้ว 6x11 นิ้ว","UNIT-002","SUB-0021","self",null],
    ["ITEM-0321","ถุงหิ้ว 7x15 นิ้ว","UNIT-002","SUB-0021","self",null],
    ["ITEM-0336","ขนมปัง","UNIT-001","SUB-0001","self",null]
  ]$catalog$::jsonb;
begin
  select b.company_id,b.id into company,burger
  from boy_central.branches b where b.code='BURGER' and b.active limit 1;
  if company is null then raise exception 'active BURGER branch not found'; end if;

  insert into boy_central.categories(company_id,code,name,category_type,parent_id,active)
  select company,source.code,source.name,'item',parent.id,true
  from (values
    ('SUB-0001','ผลไม้','CAT-001'),
    ('SUB-0021','ถุง','CAT-002'),
    ('SUB-0040','สวัสดิการ','CAT-008')
  ) source(code,name,parent_code)
  join boy_central.categories parent
    on parent.company_id=company and parent.category_type='item' and parent.code=source.parent_code
  on conflict(company_id,category_type,code) do update set
    name=excluded.name,parent_id=excluded.parent_id,active=true,updated_at=now();

  for entry in select value from jsonb_array_elements(catalog) loop
    select u.id into unit_id_value from boy_central.units u
      where u.company_id=company and u.code=entry->>2 and u.active;
    select c.id into category_id_value from boy_central.categories c
      where c.company_id=company and c.code=entry->>3 and c.active;
    if unit_id_value is null or category_id_value is null then
      raise exception 'missing unit or category for %',entry->>0;
    end if;

    insert into boy_central.items
      (company_id,code,name,item_type,category_id,base_unit_id,track_stock,
       stock_target_item_id,purchaseable,issueable,sellable,active)
    values
      (company,entry->>0,entry->>1,'STOCK_ITEM',category_id_value,unit_id_value,
       entry->>4='self',null,true,true,false,true)
    on conflict(company_id,code) do update set
      name=excluded.name,item_type='STOCK_ITEM',category_id=excluded.category_id,
      base_unit_id=excluded.base_unit_id,track_stock=excluded.track_stock,
      stock_target_item_id=null,purchaseable=true,issueable=true,active=true,updated_at=now()
    returning id into item_id_value;

    insert into boy_central.branch_items
      (company_id,branch_id,item_id,default_purchase_unit_id,default_issue_unit_id,active)
    values(company,burger,item_id_value,unit_id_value,unit_id_value,true)
    on conflict(branch_id,item_id) do update set
      default_purchase_unit_id=excluded.default_purchase_unit_id,
      default_issue_unit_id=excluded.default_issue_unit_id,active=true,updated_at=now();

    update boy_central.item_units set is_base_unit=false,updated_at=now()
      where item_id=item_id_value and unit_id<>unit_id_value and is_base_unit;
    insert into boy_central.item_units
      (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
    values(company,item_id_value,unit_id_value,1,true,true,true,true)
    on conflict(item_id,unit_id) do update set
      conversion_to_base=1,is_base_unit=true,allow_purchase=true,allow_issue=true,active=true,updated_at=now();

    select ei.id into expense_id_value from boy_central.expense_items ei
      where ei.company_id=company and ei.item_id=item_id_value order by ei.created_at limit 1;
    if expense_id_value is null then
      insert into boy_central.expense_items
        (company_id,code,name,category_id,item_id,affects_stock,purchase_unit_id,
         stock_conversion_to_base,requires_quantity,requires_unit,active)
      values(company,'EXP-'||(entry->>0),entry->>1,category_id_value,item_id_value,true,
             unit_id_value,1,true,true,true)
      on conflict(company_id,code) do update set
        name=excluded.name,category_id=excluded.category_id,item_id=excluded.item_id,
        affects_stock=true,purchase_unit_id=excluded.purchase_unit_id,
        stock_conversion_to_base=1,requires_quantity=true,requires_unit=true,active=true,updated_at=now()
      returning id into expense_id_value;
    else
      update boy_central.expense_items set
        name=entry->>1,category_id=category_id_value,affects_stock=true,
        purchase_unit_id=unit_id_value,stock_conversion_to_base=1,
        requires_quantity=true,requires_unit=true,active=true,updated_at=now()
      where id=expense_id_value;
    end if;
    insert into boy_central.branch_expense_items(branch_id,expense_item_id,active)
    values(burger,expense_id_value,true)
    on conflict(branch_id,expense_item_id) do update set active=true,updated_at=now();
  end loop;

  for entry in select value from jsonb_array_elements(catalog) where value->>4='group' loop
    select i.id into item_id_value from boy_central.items i
      where i.company_id=company and i.code=entry->>0;
    select i.id into target_id_value from boy_central.items i
      where i.company_id=company and i.code=entry->>5 and i.track_stock and i.active;
    if target_id_value is null then raise exception 'missing stock target for %',entry->>0; end if;
    update boy_central.items set track_stock=false,stock_target_item_id=target_id_value,updated_at=now()
      where id=item_id_value;
  end loop;

  select c.id into category_id_value from boy_central.categories c
    where c.company_id=company and c.code='SUB-0040' and c.active;
  insert into boy_central.expense_items
    (company_id,code,name,category_id,item_id,affects_stock,requires_quantity,requires_unit,active)
  values(company,'EXP-ITEM-0239','เลี้ยงข้าวพนักงาน',category_id_value,null,false,false,false,true)
  on conflict(company_id,code) do update set
    name=excluded.name,category_id=excluded.category_id,item_id=null,
    affects_stock=false,requires_quantity=false,requires_unit=false,active=true,updated_at=now()
  returning id into expense_id_value;
  insert into boy_central.branch_expense_items(branch_id,expense_item_id,active)
  values(burger,expense_id_value,true)
  on conflict(branch_id,expense_item_id) do update set active=true,updated_at=now();
end
$$;
