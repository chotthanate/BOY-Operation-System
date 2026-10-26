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

  const api = { codesFor, withCodes };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BOYBigCMasterMapping = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
