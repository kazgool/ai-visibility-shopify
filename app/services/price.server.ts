// Shopify's Admin API returns money amounts as raw decimal strings, e.g.
// "1190.0" or "1050.00". Published unformatted, that reads as an import
// error, not a price. Formatted once, here, before the value is handed to
// any engine function - the mirror front matter, the generated summary and
// the generated "How much does X cost?" answer all read the same string.
//
// Two decimals when the amount is not a whole number, none when it is.

export function formatPrice(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  if (trimmed === "") return null;
  const amount = Number(trimmed);
  if (!Number.isFinite(amount)) return null;
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(2);
}
