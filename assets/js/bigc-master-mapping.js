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

  function matchesSearch(item, query) {
    const normalize = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("th")
      .replace(/[\u0E48-\u0E4B]/g, "").replace(/\s+/g, " ").trim();
    const terms = normalize(query).split(" ").filter(Boolean);
    const text = normalize(`${item.name || ""} ${item.code || ""}`);
    return terms.every((term) => text.includes(term));
  }

  const api = { codesFor, withCodes, matchesSearch };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BOYBigCMasterMapping = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
