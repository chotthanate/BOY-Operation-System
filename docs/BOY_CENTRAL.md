# BOY Central

BOY Central คือฐานข้อมูลกลางระยะยาวของทาวน่า, BigC, ร้านเบอร์เกอร์,
ร้านเนื้อย่าง และสาขาในอนาคต โดย Supabase เป็นแหล่งข้อมูลจริงหลังผ่าน Pilot
ส่วน Apps Script, Google Sheets และ Burger POS เดิมยังทำงานต่อระหว่างช่วงย้ายระบบ

## สิ่งที่เตรียมแล้ว

- โครงข้อมูลบริษัท สาขา สิทธิ์ผู้ใช้ Master ธุรกรรม การชำระเงิน สต็อก ต้นทุน
  Statement, POS shadow data, ไฟล์แนบ และ Audit Log
- Row Level Security แยกสิทธิ์ตามสาขา และไม่ให้ `anon` อ่านตารางโดยตรง
- API บันทึกรายจ่ายแบบ atomic พร้อม Stock Ledger และต้นทุนเฉลี่ยถ่วงน้ำหนักต่อสาขา
- API รับสำเนาออเดอร์/ยกเลิกจาก POS พร้อม `idempotency_key`
- API รับชุดข้อมูลที่ตรวจแล้วจาก Google Sheets
- Edge Function แยกสำหรับ Apps Script และ POS แบบ server-to-server

## บทบาทของ Google Sheets

`BOY_Master` เพิ่มแท็บเตรียมนำเข้า 5 แท็บ:

- `I_แก้ไขสินค้า`
- `I_แก้ไข Supplier`
- `I_แก้ไขพนักงาน`
- `I_แก้ไขสาขา`
- `I_ผลการนำเข้า`

`BOY_Transactions` เพิ่มแท็บเตรียมนำเข้า 5 แท็บ:

- `I_รายรับภายนอก`
- `I_Statement_ช่องทางขาย`
- `I_ค่าธรรมเนียม`
- `I_รายการปรับปรุง`
- `I_ประวัตินำเข้า`

ข้อมูลในแท็บ `I_*` ยังไม่ใช่ข้อมูลจริงจนกว่าจะผ่านสถานะตรวจสอบและนำเข้า
กรณี Grab หรือคนละครึ่งที่ POS บันทึกยอดขายแล้ว ให้ใช้ `pos_sales_included = TRUE`
และ `record_mode = reconcile_only` เพื่อบันทึกค่าธรรมเนียม/ยอดรับเงินจริงโดยไม่เพิ่มยอดขายซ้ำ

## ความปลอดภัยของช่องเชื่อมต่อ

- หน้าเว็บใช้ Supabase Auth และ Public/Anon Key เท่านั้น
- `SUPABASE_SERVICE_ROLE_KEY` อยู่ใน Edge Function secret เท่านั้น
- `BOY_IMPORT_SHARED_SECRET` ใช้กับ Apps Script ฝั่งเซิร์ฟเวอร์
- `BOY_POS_SYNC_SHARED_SECRET` ใช้กับบริการฝั่งเซิร์ฟเวอร์เท่านั้น ห้ามใส่ใน Vite,
  JavaScript หน้าเว็บ หรือ GitHub
- ระบบ POS ปัจจุบันเป็น client-side จึงยังไม่เปิด Shadow Sync จนกว่าจะมีตัวกลางที่เก็บ secret
  ได้อย่างปลอดภัย หรือเปลี่ยน POS ให้ใช้ Supabase Auth

## ลำดับเปิดใช้

1. สร้าง Supabase โปรเจกต์ `BOY Central` แยกจาก `BOY Burger POS`
2. ใช้ migration ใน `supabase/migrations/` และรัน schema contract test
3. สร้างผู้ดูแลคนแรกและตรวจ RLS ข้ามสาขา
4. นำ Master เข้าและแก้รายการซ้ำ/กำกวม
5. เปิดรายจ่าย สต็อก และ Dashboard ร้านเบอร์เกอร์เป็น Pilot
6. เปิด POS Shadow Sync และเปรียบเทียบยอดโดยไม่เปลี่ยนฐาน POS เดิม
7. Cutover เมื่อยอดขาย รายจ่าย การชำระเงิน และสต็อกตรงกันเท่านั้น

ระบบเดิมต้องเก็บเป็น Archive แบบอ่านอย่างเดียวหลัง Cutover และห้ามมีสต็อกจริงสองชุด
