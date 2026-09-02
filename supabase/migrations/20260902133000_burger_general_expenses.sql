do $$
declare company uuid; burger uuid;
begin
  select id into company from boy_central.companies where code='BOY';
  select id into burger from boy_central.branches where company_id=company and code='BURGER';
  insert into boy_central.categories(company_id,code,name,category_type,sort_order,active)
  select company,code,name,'expense',sort_order,true from (values
    ('EXP-CAT-003','อุปกรณ์',300),('EXP-CAT-004','ค่าขนส่ง',400),('EXP-CAT-005','ค่าใช้จ่ายอื่นๆ',700),
    ('EXP-CAT-006','การตลาด',800),('EXP-CAT-007','ค่าเช่าและสาธารณูปโภค',500),
    ('EXP-CAT-008','ค่าแรงพนักงาน',600),('EXP-CAT-010','ค่าบริการและค่าธรรมเนียม',1000),
    ('EXP-CAT-011','ภาษีและใบอนุญาต',1100)
  ) v(code,name,sort_order)
  on conflict(company_id,category_type,code) do update set name=excluded.name,active=true;

  insert into boy_central.expense_items(company_id,code,name,category_id,affects_stock,active)
  select company,v.code,v.name,c.id,false,true
  from (values
    ('EXP-BURGER-RENT','ค่าเช่าร้าน','EXP-CAT-007'),('EXP-BURGER-ELECTRIC','ค่าไฟฟ้า','EXP-CAT-007'),
    ('EXP-BURGER-WATER','ค่าน้ำประปา','EXP-CAT-007'),('EXP-BURGER-WAGE','ค่าแรงพนักงาน','EXP-CAT-008'),
    ('EXP-BURGER-DELIVERY','ค่าขนส่ง','EXP-CAT-004'),('EXP-BURGER-ADS','ค่าโฆษณา','EXP-CAT-006'),
    ('EXP-BURGER-REPAIR','ค่าซ่อมอุปกรณ์','EXP-CAT-003'),('EXP-BURGER-EQUIPMENT','อุปกรณ์ทั่วไป','EXP-CAT-003'),
    ('EXP-BURGER-PLATFORM','ค่าธรรมเนียมแพลตฟอร์ม','EXP-CAT-010'),('EXP-BURGER-BANK','ค่าธรรมเนียมธนาคาร','EXP-CAT-010'),
    ('EXP-BURGER-TAX','ภาษี','EXP-CAT-011'),('EXP-BURGER-OTHER','ค่าใช้จ่ายอื่นๆ','EXP-CAT-005')
  ) v(code,name,category_code)
  join boy_central.categories c on c.company_id=company and c.category_type='expense' and c.code=v.category_code
  on conflict(company_id,code) do update set name=excluded.name,category_id=excluded.category_id,active=true;

  insert into boy_central.branch_expense_items(branch_id,expense_item_id,sort_order,active)
  select burger,e.id,10,true from boy_central.expense_items e
  where e.company_id=company and e.code like 'EXP-BURGER-%'
  on conflict(branch_id,expense_item_id) do update set active=true;
end $$;
