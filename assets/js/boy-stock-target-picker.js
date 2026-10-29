((root) => {
  "use strict";

  const text = (value) => String(value || "").normalize("NFKC").toLocaleLowerCase("th").replace(/\s+/g, " ").trim();
  const active = (row) => ![false, "FALSE", "false", 0, "0"].includes(row["เปิดใช้งาน"]);
  const tracked = (row) => row["รูปแบบสต็อก"] === "นับเป็นรายการนี้"
    || (!row["รูปแบบสต็อก"] && [true, "TRUE", "true", 1, "1"].includes(row["ติดตามสต็อก"]));

  function candidates(rows, { currentId = "", selectedId = "", categoryId = "", subcategoryId = "", query = "", showAll = false } = {}) {
    const search = text(query);
    const eligible = (rows || []).filter((row) => row.item_id && String(row.item_id) !== String(currentId)
      && active(row) && !row.stock_target_item_id && tracked(row));
    const sameSubcategory = !search && !showAll && subcategoryId
      && eligible.some((row) => String(row.subcategory_id) === String(subcategoryId));
    const visible = eligible.filter((row) => {
      if (String(row.item_id) === String(selectedId)) return true;
      if (search) return text(`${row["ชื่อสินค้า"]} ${row.item_id}`).includes(search);
      return showAll || (sameSubcategory ? String(row.subcategory_id) === String(subcategoryId)
        : !categoryId || String(row.category_id) === String(categoryId));
    });
    visible.sort((a, b) => {
      const rank = (row) => String(row.item_id) === String(selectedId) ? -1
        : subcategoryId && String(row.subcategory_id) === String(subcategoryId) ? 0
          : categoryId && String(row.category_id) === String(categoryId) ? 1 : 2;
      return rank(a) - rank(b) || text(a["ชื่อสินค้า"]).localeCompare(text(b["ชื่อสินค้า"]), "th");
    });
    const selected = (rows || []).find((row) => String(row.item_id) === String(selectedId));
    if (selected && !visible.some((row) => String(row.item_id) === String(selectedId))) visible.unshift(selected);
    return visible;
  }

  const api = { candidates };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.BOYStockTargetPicker = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
