(() => {
  "use strict";
  const all = [
    { code: 'TAWANA', name: 'ทาวน่า', mark: 'TW', slug: 'tawana', expensePath: 'tawana.html', sourceSystem: 'boy_tawana_web' },
    { code: 'BURGER', name: 'ร้านเบอร์เกอร์', mark: 'BG', slug: 'burger', expensePath: 'burger.html', sourceSystem: 'boy_burger_web' },
    { code: 'GRILL', name: 'ร้านเนื้อย่าง', mark: 'GR', slug: 'grill', expensePath: 'burger.html?branch=GRILL', sourceSystem: 'boy_grill_web' },
    { code: 'BIGC-CENTRAL-PATTAYA', name: 'BigC พัทยากลาง', mark: 'BC', slug: 'bigc', expensePath: 'bigc.html', orderPath: 'bigc-v2.html', sourceSystem: 'boy_bigc_web' },
    { code: 'BIGC-SOUTH-PATTAYA', name: 'BigC พัทยาใต้', mark: 'BS', slug: 'bigc-south', expensePath: 'bigc-south.html', orderPath: 'bigc-south-order.html', sourceSystem: 'boy_bigc_south_web' }
  ];
  const get = code => all.find(branch => branch.code === code);
  const dataPath = (code, page) => `burger.html?branch=${encodeURIComponent(code)}&page=${encodeURIComponent(page)}`;
  window.BOY_BRANCHES = { all, get, dataPath };
})();
