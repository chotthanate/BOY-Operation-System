((root) => {
  "use strict";

  function uniqueCodes(values) {
    return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))];
  }

  function codesFor(item = {}) {
    const primary = String(item.masterItemId || item.master_item_id || "").trim();
    const linked = Array.isArray(item.masterItemIds) ? item.masterItemIds
      : Array.isArray(item.master_item_ids) ? item.master_item_ids : [];
    return uniqueCodes([primary, ...linked]);
  }

  function withCodes(item, values, primary = "") {
    const codes = uniqueCodes(values);
    const selectedPrimary = codes.includes(primary) ? primary : codes[0] || "";
    const ordered = selectedPrimary ? [selectedPrimary, ...codes.filter((code) => code !== selectedPrimary)] : [];
    return { ...item, masterItemIds: ordered, masterItemId: selectedPrimary || null };
  }

  function canonicalCodeFor(values, itemsByCode, catalogByCode = new Map()) {
    const codes = uniqueCodes(values);
    if (!codes.length) return { code: "", error: "" };
    const normalizedTargets = codes.map((code) => {
      const item = itemsByCode.get(code);
      return item?.stock_target_item_id || item?.id || null;
    });
    if (normalizedTargets.every(Boolean)) {
      if (new Set(normalizedTargets).size !== 1) return { code: "", error: "สินค้าที่เลือกไม่ได้อยู่ในสต็อกรวมเดียวกัน กรุณาจัดกลุ่มในข้อมูลกลางก่อน" };
      const target = [...itemsByCode.values()].find((item) => item.id === normalizedTargets[0]);
      if (target) return { code: target.code, error: "" };
    }
    // Catalog mappings are enough to link variants even when the normalized
    // inventory read is incomplete in this browser. The stock write still uses
    // the canonical item UUID resolved separately before settings are saved.
    const catalogTargets = codes.map((code) => {
      const catalog = catalogByCode.get(code);
      return catalog ? String(catalog.stockTargetCode || catalog.stock_target_item_id || code).trim() : "";
    });
    if (catalogTargets.every(Boolean)) {
      if (new Set(catalogTargets).size !== 1) return { code: "", error: "สินค้าที่เลือกไม่ได้อยู่ในสต็อกรวมเดียวกัน กรุณาจัดกลุ่มในข้อมูลกลางก่อน" };
      const targetCode = catalogTargets[0];
      if (catalogByCode.has(targetCode) || itemsByCode.has(targetCode)) return { code: targetCode, error: "" };
    }
    if (codes.length === 1 && !itemsByCode.has(codes[0]) && !catalogByCode.has(codes[0])) return { code: codes[0], error: "" };
    return { code: "", error: "ข้อมูลการจับคู่สินค้ากลางไม่ครบ กรุณาโหลดรายการใหม่" };
  }

  function matchesSearch(item, query) {
    const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("th")
      .replace(/[\u0E48-\u0E4B]/g, "").replace(/\s+/g, " ").trim();
    const terms = normalize(query).split(" ").filter(Boolean);
    const text = normalize(`${item.name || ""} ${item.code || ""}`);
    return terms.every((term) => text.includes(term));
  }

  const api = { codesFor, withCodes, canonicalCodeFor, matchesSearch };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BOYBigCMasterMapping = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
