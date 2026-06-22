# BOY Operation System

Staging repo for the next BOY business workflow.

## Pages

- `index.html` - staging menu
- `tawana.html` - Tawana page connected to the new BOY Operation System Apps Script
- `bigc.html` - BigC expense-only page, connected to `BOY_Transactions > รายจ่าย`
- `bigc-order.html` - copied from the current BOY-order-v2 order/receive/return page, still in staging mode

## Safety

`tawana.html` writes to the new BOY workbook family only:

- BOY_Master
- BOY_Transactions
- BOY_Costing
- BOY_Reports

`bigc-order.html` still blocks write actions until the BigC order/receive/return backend is connected.

## Apps Script

- Local source: `apps-script/`
- Web app: `https://script.google.com/macros/s/AKfycbzgShPP4BpUUvDSs53esvJLru3CFAe1tM4LqdXE9rUzENbBNBFY3lPPqjVw6fnhgEKmGw/exec`
