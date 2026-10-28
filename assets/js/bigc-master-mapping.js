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

  function canonicalCodeFor(values, itemsByCode) {
    const codes = uniqueCodes(values);
    if (!codes.length) return { code: "", error: "" };
    if (codes.length === 1 && !itemsByCode.has(codes[0])) return { code: codes[0], error: "" };
    const targets = codes.map((code) => {
      const item = itemsByCode.get(code);
      return item?.stock_target_item_id || item?.id || null;
    });
    if (targets.some((id) => !id)) return { code: "", error: "โหลดข้อมูลสินค้ากลางไม่ครบ กรุณาเชื่อมต่อแล้วลองใหม่" };
    if (new Set(targets).size !== 1) return { code: "", error: "สินค้าที่เลือกไม่ได้อยู่ในสต็อกรวมเดียวกัน กรุณาจัดกลุ่มในข้อมูลกลางก่อน" };
    const target = [...itemsByCode.values()].find((item) => item.id === targets[0]);
    return target ? { code: target.code, error: "" } : { code: "", error: "ไม่พบรายการสต็อกรวมในข้อมูลกลาง" };
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
