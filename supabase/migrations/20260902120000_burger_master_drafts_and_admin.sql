-- Burger master import, persistent expense drafts, and guarded master maintenance.
-- Source: BOY_Master Google Sheet. Ambiguous duplicate rows ITEM-0307/0309 are intentionally excluded.

create table boy_central.expense_drafts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references boy_central.companies(id),
  branch_id uuid not null references boy_central.branches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_date date not null,
  payload jsonb not null default '{"lines":[]}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (branch_id, user_id, transaction_date)
);

create index expense_drafts_user_date_idx
  on boy_central.expense_drafts (user_id, transaction_date desc);

create trigger expense_drafts_set_updated_at
before update on boy_central.expense_drafts
for each row execute function boy_central_private.set_updated_at();

alter table boy_central.expense_drafts enable row level security;

create policy expense_drafts_own_select on boy_central.expense_drafts
for select to authenticated
using (user_id = (select auth.uid()) and (select boy_central_private.has_branch_access(branch_id, null)));

create policy expense_drafts_own_insert on boy_central.expense_drafts
for insert to authenticated
with check (user_id = (select auth.uid()) and (select boy_central_private.has_branch_access(branch_id, array['admin','manager','staff'])));

create policy expense_drafts_own_update on boy_central.expense_drafts
for update to authenticated
using (user_id = (select auth.uid()) and (select boy_central_private.has_branch_access(branch_id, array['admin','manager','staff'])))
with check (user_id = (select auth.uid()) and (select boy_central_private.has_branch_access(branch_id, array['admin','manager','staff'])));

create policy expense_drafts_own_delete on boy_central.expense_drafts
for delete to authenticated
using (user_id = (select auth.uid()) and (select boy_central_private.has_branch_access(branch_id, array['admin','manager','staff'])));

revoke all on boy_central.expense_drafts from anon;
grant select, insert, update, delete on boy_central.expense_drafts to authenticated;

do $$
declare
  company uuid;
  burger uuid;
begin
  select id into company from boy_central.companies where code = 'BOY';
  select id into burger from boy_central.branches where company_id = company and code = 'BURGER';

  insert into boy_central.units (company_id, code, name, symbol, unit_type, decimal_places, active)
  select company, code, name, name,
    case when code in ('UNIT-011','UNIT-021') then 'weight' else 'count' end,
    case code when 'UNIT-011' then 3 when 'UNIT-021' then 2 else 0 end, true
  from (values
    ('UNIT-001','ถุง'),('UNIT-002','แพ็ค'),('UNIT-003','ถาด'),('UNIT-004','กล่อง'),
    ('UNIT-005','ขวด'),('UNIT-006','กระปุก'),('UNIT-007','ม้วน'),('UNIT-008','ห่อ'),
    ('UNIT-009','ลัง'),('UNIT-010','แกลลอน'),('UNIT-011','กิโลกรัม'),('UNIT-012','หวี'),
    ('UNIT-013','ลูก'),('UNIT-014','ถัง'),('UNIT-015','ชิ้น'),('UNIT-016','ปิ๊ป'),
    ('UNIT-017','กระป๋อง'),('UNIT-018','แถว'),('UNIT-019','ใบ'),('UNIT-020','โหล'),
    ('UNIT-021','กรัม'),('UNIT-022','ฟอง')
  ) v(code,name)
  on conflict (company_id, code) do update set name=excluded.name, active=true;

  insert into boy_central.categories (company_id, code, name, category_type, sort_order, active)
  select company, code, name, 'item', sort_order, true
  from (values
    ('CAT-001','วัตถุดิบ',100),('CAT-002','บรรจุภัณฑ์',200),('CAT-003','อุปกรณ์',300),
    ('CAT-004','ค่าขนส่ง',400),('CAT-005','ค่าใช้จ่ายอื่นๆ',700),('CAT-006','การตลาด',800),
    ('CAT-007','ค่าเช่าสถานที่',500),('CAT-008','ค่าแรงพนักงาน',600),
    ('CAT-009','ของใช้สิ้นเปลือง',900),('CAT-010','ค่าบริการและค่าธรรมเนียม',1000),
    ('CAT-011','ภาษีและใบอนุญาต',1100)
  ) v(code,name,sort_order)
  on conflict (company_id, category_type, code) do update set name=excluded.name, active=true;

  insert into boy_central.categories (company_id, code, name, category_type, parent_id, sort_order, active)
  select company, v.code, v.name, 'item', p.id, v.sort_order, true
  from (values
    ('SUB-0048','เนื้อเบอร์เกอร์','CAT-001',181),('SUB-0049','ขนมปัง','CAT-001',182),
    ('SUB-0050','ชีส','CAT-001',183),('SUB-0051','ผักสด','CAT-001',184),
    ('SUB-0052','ไข่','CAT-001',185),('SUB-0053','แฮม','CAT-001',186),
    ('SUB-0054','เบคอน','CAT-001',187),('SUB-0055','ซอส','CAT-001',188),
    ('SUB-0056','แตงกวาดอง','CAT-001',189),('SUB-0057','บาร์บีคิว','CAT-001',191),
    ('SUB-0080','เนื้อหมู','CAT-001',197),('SUB-0081','เนื้อไก่','CAT-001',198),
    ('SUB-0082','เนื้อวัว','CAT-001',199),('SUB-0083','อาหารทะเล','CAT-001',200),
    ('SUB-0084','เนื้อสัตว์แปรรูป','CAT-001',201),('SUB-0085','ข้าวและธัญพืช','CAT-001',202),
    ('SUB-0086','เครื่องปรุงและเครื่องเทศ','CAT-001',203),('SUB-0087','เครื่องใน','CAT-001',204)
  ) v(code,name,parent_code,sort_order)
  join boy_central.categories p on p.company_id=company and p.category_type='item' and p.code=v.parent_code
  on conflict (company_id, category_type, code) do update set name=excluded.name, parent_id=excluded.parent_id, active=true;

  insert into boy_central.items
    (company_id,code,name,category_id,base_unit_id,track_stock,purchaseable,issueable,sellable,active,legacy_name)
  select company,v.code,v.name,c.id,u.id,true,true,true,false,true,v.legacy_name
  from (values
    ('ITEM-0271','ขนมปังเบอร์เกอร์ Lotus','SUB-0049','UNIT-015',null),
    ('ITEM-0272','ขนมปังเบอร์เกอร์ Aro','SUB-0049','UNIT-015',null),
    ('ITEM-0273','ขนมปังเบอร์เกอร์','SUB-0049','UNIT-015',null),
    ('ITEM-0274','ชีส','SUB-0050','UNIT-015',null),('ITEM-0275','ไข่','SUB-0052','UNIT-022',null),
    ('ITEM-0276','แฮม','SUB-0053','UNIT-011',null),('ITEM-0277','เบคอน','SUB-0054','UNIT-011',null),
    ('ITEM-0278','เนื้อหมู','SUB-0048','UNIT-011',null),('ITEM-0279','เนื้อไก่','SUB-0048','UNIT-011',null),
    ('ITEM-0280','เนื้อวัว','SUB-0048','UNIT-011',null),('ITEM-0281','เนื้อปลา','SUB-0048','UNIT-011',null),
    ('ITEM-0282','เนื้อกุ้ง','SUB-0048','UNIT-011',null),('ITEM-0283','เนื้อนกกระจอกเทศ','SUB-0048','UNIT-011',null),
    ('ITEM-0284','เนื้อแพะ','SUB-0048','UNIT-011',null),('ITEM-0285','เนื้อกระต่าย','SUB-0048','UNIT-011',null),
    ('ITEM-0286','เนื้อกวาง','SUB-0048','UNIT-011',null),('ITEM-0287','เนื้อวากิว','SUB-0048','UNIT-011',null),
    ('ITEM-0288','บาร์บีคิว หมู','SUB-0057','UNIT-015',null),('ITEM-0289','บาร์บีคิว ไก่','SUB-0057','UNIT-015',null),
    ('ITEM-0290','บาร์บีคิว เนื้อ','SUB-0057','UNIT-015',null),('ITEM-0291','บาร์บีคิว 3 ชั้น','SUB-0057','UNIT-015',null),
    ('ITEM-0292','บาร์บีคิว กุ้ง','SUB-0057','UNIT-015',null),('ITEM-0293','บาร์บีคิว เห็ดออรินจิ','SUB-0057','UNIT-015',null),
    ('ITEM-0294','บาร์บีคิว กระเจี๊ยบ','SUB-0057','UNIT-015',null),('ITEM-0295','บาร์บีคิว บรอกโคลี','SUB-0057','UNIT-015',null),
    ('ITEM-0296','ผักสด','SUB-0051','UNIT-011',null),
    ('ITEM-0297','ซอสมะเขือเทศ Aro 1000 กรัม','SUB-0055','UNIT-021','มะเขือเทศ Aro 1000 กรัม'),
    ('ITEM-0298','ซอสมะเขือเทศ Heinz 1000 กรัม','SUB-0055','UNIT-021','มะเขือเทศ Heinz 1000 กรัม'),
    ('ITEM-0299','ซอสมะเขือเทศ Safepack 1000 กรัม','SUB-0055','UNIT-021','มะเขือเทศ Safepack 1000 กรัม'),
    ('ITEM-0300','มายองเนส Aro 1000 กรัม','SUB-0055','UNIT-021',null),
    ('ITEM-0301','มายองเนส สุขุม 1000 กรัม','SUB-0055','UNIT-021',null),
    ('ITEM-0302','มายองเนสศรีราชา สุขุม 1000 กรัม','SUB-0055','UNIT-021','มายองเนส ศรีราชา สุขุม 1000 กรัม'),
    ('ITEM-0303','มายองเนสศรีราชา 1000 กรัม','SUB-0055','UNIT-021','มายองเนส ศรีราชา 1000 กรัม'),
    ('ITEM-0304','มัสตาร์ด','SUB-0055','UNIT-021',null),('ITEM-0305','มัสตาร์ด Aro 1000 กรัม','SUB-0055','UNIT-021',null),
    ('ITEM-0306','ผงหอม','SUB-0086','UNIT-021',null),('ITEM-0308','ผงกระเทียม','SUB-0086','UNIT-021',null),
    ('ITEM-0310','แตงกวาดอง หวาน','SUB-0056','UNIT-021',null),
    ('ITEM-0311','แตงกวาดอง เปรี้ยว','SUB-0056','UNIT-021',null),('ITEM-0312','แตงกวาดอง','SUB-0056','UNIT-021',null)
  ) v(code,name,category_code,unit_code,legacy_name)
  join boy_central.categories c on c.company_id=company and c.category_type='item' and c.code=v.category_code
  join boy_central.units u on u.company_id=company and u.code=v.unit_code
  on conflict (company_id,code) do update set name=excluded.name,category_id=excluded.category_id,
    base_unit_id=excluded.base_unit_id,track_stock=true,purchaseable=true,issueable=true,active=true,legacy_name=excluded.legacy_name;

  insert into boy_central.item_units (company_id,item_id,unit_id,conversion_to_base,is_base_unit,allow_purchase,allow_issue,active)
  select company,i.id,i.base_unit_id,1,true,true,true,true
  from boy_central.items i where i.company_id=company and i.code between 'ITEM-0271' and 'ITEM-0312'
  on conflict (item_id,unit_id) do update set conversion_to_base=1,is_base_unit=true,active=true;

  insert into boy_central.branch_items (company_id,branch_id,item_id,active)
  select company,burger,i.id,true from boy_central.items i
  where i.company_id=company and i.code between 'ITEM-0271' and 'ITEM-0312'
  on conflict (branch_id,item_id) do update set active=true;

  insert into boy_central.expense_items (company_id,code,name,category_id,item_id,affects_stock,active)
  select company,'EXP-'||i.code,i.name,i.category_id,i.id,true,true
  from boy_central.items i where i.company_id=company and i.code between 'ITEM-0271' and 'ITEM-0312'
  on conflict (company_id,code) do update set name=excluded.name,category_id=excluded.category_id,item_id=excluded.item_id,affects_stock=true,active=true;

  insert into boy_central.branch_expense_items (branch_id,expense_item_id,sort_order,active)
  select burger,e.id,100,true from boy_central.expense_items e
  where e.company_id=company and e.code like 'EXP-ITEM-03%'
     or (e.company_id=company and e.code like 'EXP-ITEM-02%')
  on conflict (branch_id,expense_item_id) do update set active=true;

  insert into boy_central.suppliers (company_id,code,name,supplier_type,active)
  select company,code,name,'mixed',true from (values
    ('MACRO','Macro'),('GO-WHOLESALE','Go Whole Sale'),('PAENG-KA-NOEI','แป้งกะเนย'),
    ('TALAD-THAI','ตลาดไท'),('RATTANAKORN','รัตนากร')
  ) v(code,name)
  on conflict (company_id,code) do update set name=excluded.name,active=true;

  insert into boy_central.branch_suppliers (branch_id,supplier_id,is_preferred,active)
  select burger,s.id,s.code in ('MACRO','GO-WHOLESALE'),true
  from boy_central.suppliers s where s.company_id=company
  on conflict (branch_id,supplier_id) do update set active=true,is_preferred=excluded.is_preferred;
end $$;

create or replace function boy_central.admin_update_burger_master(payload jsonb)
returns jsonb language plpgsql security definer set search_path=''
as $$
declare actor uuid := (select auth.uid()); company uuid; burger uuid; target uuid; kind text;
begin
  select p.company_id into company from boy_central.profiles p
  where p.user_id=actor and p.active and p.company_role='admin';
  if company is null then raise exception 'admin access required'; end if;
  select id into burger from boy_central.branches where company_id=company and code='BURGER';
  kind := payload->>'kind';
  if kind='item' then
    target := nullif(payload->>'id','')::uuid;
    if target is null or not exists (select 1 from boy_central.branch_items where branch_id=burger and item_id=target) then
      raise exception 'burger item not found';
    end if;
    update boy_central.items set
      name=coalesce(nullif(trim(payload->>'name'),''),name),
      category_id=coalesce(nullif(payload->>'category_id','')::uuid,category_id),
      base_unit_id=coalesce(nullif(payload->>'base_unit_id','')::uuid,base_unit_id),
      track_stock=coalesce((payload->>'track_stock')::boolean,track_stock),
      active=coalesce((payload->>'active')::boolean,active)
    where id=target and company_id=company;
  elsif kind='expense_item' then
    target := nullif(payload->>'id','')::uuid;
    if target is null or not exists (select 1 from boy_central.branch_expense_items where branch_id=burger and expense_item_id=target) then
      raise exception 'burger expense item not found';
    end if;
    update boy_central.expense_items set
      name=coalesce(nullif(trim(payload->>'name'),''),name),
      category_id=coalesce(nullif(payload->>'category_id','')::uuid,category_id),
      affects_stock=coalesce((payload->>'affects_stock')::boolean,affects_stock),
      active=coalesce((payload->>'active')::boolean,active)
    where id=target and company_id=company;
  else raise exception 'unsupported master kind';
  end if;
  return jsonb_build_object('status','updated','id',target);
end $$;

revoke all on function boy_central.admin_update_burger_master(jsonb) from public, anon;
grant execute on function boy_central.admin_update_burger_master(jsonb) to authenticated;
