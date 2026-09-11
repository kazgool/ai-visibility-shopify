// RFC 4180 CSV for the audit scripts: quoted fields may hold commas, newlines
// and "" for a quote. The repo has no CSV dependency and only scripts read CSV.
export function parseCsv(text: string): Record<string, string>[] {
  const records: string[][] = [];
  let field = "";
  let record: string[] = [];
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { record.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      record.push(field); field = "";
      records.push(record); record = [];
    } else field += ch;
  }
  if (field !== "" || record.length > 0) { record.push(field); records.push(record); }
  const [header, ...body] = records;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h.replace(/^﻿/, ""), r[i] ?? ""])));
}

/** A Shopify product CSV export as /products.json-shaped products: one per
 * handle, the first row carrying the title. Options come from the variant rows. */
export function csvProducts(text: string): {
  id: string; title: string; handle: string; body_html: string; vendor: string; product_type: string;
  options: { name: string; values: string[] }[]; variants: { price: string }[];
}[] {
  const byHandle = new Map<string, ReturnType<typeof csvProducts>[number]>();
  for (const r of parseCsv(text)) {
    const handle = r["Handle"];
    if (!handle) continue;
    let p = byHandle.get(handle);
    if (!p) {
      if (!r["Title"]) continue;
      p = { id: handle, title: r["Title"], handle, body_html: r["Body (HTML)"] ?? "", vendor: r["Vendor"] ?? "", product_type: r["Type"] ?? "", options: [], variants: [] };
      for (const n of [1, 2, 3]) {
        const name = r[`Option${n} Name`];
        if (name) p.options.push({ name, values: [] });
      }
      byHandle.set(handle, p);
    }
    p.options.forEach((o, i) => {
      const v = r[`Option${i + 1} Value`];
      if (v && !o.values.includes(v)) o.values.push(v);
    });
    if (r["Variant Price"]) p.variants.push({ price: r["Variant Price"] });
  }
  return [...byHandle.values()];
}
