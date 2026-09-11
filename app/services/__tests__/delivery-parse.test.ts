import { describe, expect, it } from "vitest";
import {
  deliveryCostLine,
  normalizeDeliveryText,
  parseAmount,
  parseCountryList,
  readDeliveryCost,
} from "../delivery-parse";

// CC-PROMPT-AI-READABILITY-4 item 2a: the delivery cost text, read into
// { rate, currency, freeOverAmount }. Every pattern the brief names, the
// Republica BIO wording, and dirty input. Unreadable text gives rate null.

type Row = [input: string, shop: string, rate: number | null, currency: string, free: number | null, note: string | null];

const ROWS: Row[] = [
  // The field's own placeholder.
  ["Free over 500, or: 25", "RON", 25, "RON", 500, null],
  // Romanian and English forms.
  ["gratuit peste 200 lei", "RON", null, "RON", 200, "none"],
  ["livrare gratuita de la 199 RON", "RON", null, "RON", 199, "none"],
  ["19,99\u00a0lei", "RON", 19.99, "RON", null, null],
  ["19.99 lei", "RON", 19.99, "RON", null, null],
  ["25 RON", "RON", 25, "RON", null, null],
  ["free", "RON", 0, "RON", null, null],
  ["gratuit", "RON", 0, "RON", null, null],
  ["Livrare 20 lei, gratuit la comenzi peste 300 lei", "RON", 20, "RON", 300, null],
  ["Free shipping on orders over $50, otherwise $5.99", "USD", 5.99, "USD", 50, null],
  // Currency word, code or none; none is the shop's.
  ["25", "EUR", 25, "EUR", null, null],
  ["5 EUR", "RON", 5, "EUR", null, null],
  ["5 euro", "RON", 5, "EUR", null, null],
  ["$5", "CAD", 5, "CAD", null, null],
  ["0 lei", "RON", 0, "RON", null, null],
  ["250 de lei", "RON", 250, "RON", null, null],
  // Thousands and decimals.
  ["1.000 lei", "RON", 1000, "RON", null, null],
  ["1.000,50 lei", "RON", 1000.5, "RON", null, null],
  // Dirty input: case, diacritics, NBSP, stray spaces.
  ["Gratuit\u0103", "RON", 0, "RON", null, null],
  ["  FREE  over\u00a0500 , or:\u00a025 ", "RON", 25, "RON", 500, null],
  ["LIVRARE GRATUIT\u0102 PESTE 200\u202fLEI", "RON", null, "RON", 200, "none"],
  ["19,99\u00a0lei", "RON", 19.99, "RON", null, null],
  // A starting price, stated in the text itself, is not one exact price.
  ["de la 25 lei", "RON", null, "RON", null, "starting"],
  ["From 25 RON", "RON", null, "RON", null, "starting"],
  // Several prices: none of them is the price.
  ["15-25 lei", "RON", null, "RON", null, "varies"],
  ["gratuit in Bucuresti, 20 lei in rest", "RON", null, "RON", null, "varies"],
  // Republica BIO's own wording (scripts/corpus-stores.ts): by weight, then free over a threshold.
  [
    "15 Lei sub 1 kg, plus 1 leu pentru fiecare kg suplimentar; gratuit peste 250 de lei",
    "RON",
    null,
    "RON",
    250,
    "varies",
  ],
  // Two currencies: nothing, rather than a guess at which.
  ["20 lei sau 5 eur", "RON", null, "RON", null, "currency"],
  // A clock time is not an amount.
  ["Comenzi plasate pana la 13:00: 20 lei", "RON", 20, "RON", null, null],
  // Unreadable.
  ["5% din valoarea comenzii", "RON", null, "RON", null, "none"],
  ["call us", "RON", null, "RON", null, "none"],
  ["", "RON", null, "RON", null, "none"],
];

describe("readDeliveryCost", () => {
  for (const [input, shop, rate, currency, free, note] of ROWS) {
    it(`${JSON.stringify(input)} (shop ${shop})`, () => {
      const { parsed, rateNote } = readDeliveryCost(input, shop);
      expect(parsed).toEqual({ rate, currency, freeOverAmount: free });
      expect(rateNote).toBe(note);
    });
  }
});

describe("parseAmount", () => {
  it.each([
    ["19,99", 19.99],
    ["19.99", 19.99],
    ["12.5", 12.5],
    ["1.000", 1000],
    ["1,000", 1000],
    ["1.000,50", 1000.5],
    ["12.345.678", 12345678],
    ["250", 250],
  ])("%s is %s", (raw, value) => {
    expect(parseAmount(raw)).toBe(value);
  });
});

describe("normalizeDeliveryText", () => {
  it("folds NBSP, diacritics, dashes and case", () => {
    expect(normalizeDeliveryText("  Livrare\u00a0GRATUIT\u0102 \u2013 \u0219 \u021b  ")).toBe("livrare gratuita - s t");
  });
});

describe("parseCountryList", () => {
  it("reads two-letter codes in any case, once each, in the order typed", () => {
    expect(parseCountryList("RO, md; ro / BG")).toEqual({ countries: ["RO", "MD", "BG"], invalid: [] });
  });
  it("names what is not a code instead of guessing one", () => {
    expect(parseCountryList("Romania, RO")).toEqual({ countries: ["RO"], invalid: ["Romania"] });
  });
  it("is empty for an empty field", () => {
    expect(parseCountryList("  ")).toEqual({ countries: [], invalid: [] });
  });
});

// Item 2b: the one line under the delivery cost field.
describe("deliveryCostLine", () => {
  it.each([
    ["19,99 lei, gratuit peste 200 lei", false, "Published for Google: 19.99 RON, free over 200 RON."],
    [
      "19,99 lei, gratuit peste 200 lei",
      true,
      "Published for Google: free over 200 RON. Not published: the starting price, because Google takes one exact delivery price.",
    ],
    ["25 RON", true, "Not published for Google: the starting price, because Google takes one exact delivery price."],
    ["gratuit peste 200 lei", false, "Published for Google: free over 200 RON."],
    ["free", false, "Published for Google: free delivery."],
    ["call us", false, "Not published for Google: we could not read a price from this text."],
    [
      "15 Lei sub 1 kg, plus 1 leu pentru fiecare kg suplimentar; gratuit peste 250 de lei",
      false,
      "Published for Google: free over 250 RON. Not published: a delivery price, because this text states more than one.",
    ],
    ["20 lei sau 5 eur", false, "Not published for Google: anything, because this text mixes currencies."],
  ])("%s (starting price box %s)", (text, isFrom, line) => {
    expect(deliveryCostLine(text as string, isFrom as boolean, "RON")).toBe(line);
  });

  it("says nothing for an empty field", () => {
    expect(deliveryCostLine("  ", false, "RON")).toBeNull();
  });

  it("is plain characters only", () => {
    for (const [input] of ROWS) {
      const line = deliveryCostLine(input, false, "RON");
      if (line !== null) expect(line).toMatch(/^[\x20-\x7e]*$/);
    }
  });
});
