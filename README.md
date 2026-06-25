# BOY Operation System

Staging repo for the next BOY business workflow.

## Pages

- `index.html` - staging menu
- `tawana.html` - Tawana page connected to the new BOY Operation System Apps Script
- `bigc.html` - บิ๊กซีพัทยากลาง expense-only page, connected to `BOY_Transactions > รายจ่าย`
- `bigc-order.html` - บิ๊กซีพัทยากลาง order/receive/return page
- `dashboard.html` - monthly reporting dashboard for income, expenses, profit, raw materials, and branch comparison

## Safety

`tawana.html` writes to the new BOY workbook family only:

- BOY_Master
- BOY_Transactions
- BOY_Costing
- BOY_Reports

`bigc-order.html` writes บิ๊กซีพัทยากลาง order/receive/return data through the shared Apps Script backend.

`dashboard.html` is read-only from the browser side. It requests summarized data from Apps Script and does not write rows to Sheets.

## Apps Script

- Local source: `apps-script/`
- Web app: `https://script.google.com/macros/s/AKfycbzgShPP4BpUUvDSs53esvJLru3CFAe1tM4LqdXE9rUzENbBNBFY3lPPqjVw6fnhgEKmGw/exec`
