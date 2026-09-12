import { describe, expect, it } from "vitest";
import {
  DELIVERY_CURRENCY_UNKNOWN_LINE,
  deliveryCostLine,
  deliveryLine,
  deliveryTimeLine,
  normalizeDeliveryText,
  offerShippingPublished,
  parseAmount,
  parseCountryList,
  readDeliveryCost,
  readDeliveryTime,
  shippingServicePublished,
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

// Item 4: the delivery time text, read into whole days.
describe("readDeliveryTime", () => {
  it.each([
    // The forms the brief names.
    ["1-2", { minDays: 1, maxDays: 2 }],
    ["2-4 working days", { minDays: 2, maxDays: 4 }],
    ["24-48 ore", { minDays: 1, maxDays: 2 }],
    ["1-3 zile lucratoare", { minDays: 1, maxDays: 3 }],
    ["next day", { minDays: 1, maxDays: 1 }],
    ["a doua zi", { minDays: 1, maxDays: 1 }],
    // More English and Romanian.
    ["2 to 4 days", { minDays: 2, maxDays: 4 }],
    ["3-5 business days", { minDays: 3, maxDays: 5 }],
    ["Next-day delivery", { minDays: 1, maxDays: 1 }],
    ["same day", { minDays: 0, maxDays: 0 }],
    ["livrare in aceeasi zi", { minDays: 0, maxDays: 0 }],
    ["o zi", { minDays: 1, maxDays: 1 }],
    ["doua zile", { minDays: 2, maxDays: 2 }],
    ["2 sau 3 zile", { minDays: 2, maxDays: 3 }],
    ["3", { minDays: 3, maxDays: 3 }],
    // Hours round up to whole days.
    ["48h", { minDays: 2, maxDays: 2 }],
    ["Livrare in 24 de ore", { minDays: 1, maxDays: 1 }],
    ["36 hours", { minDays: 2, maxDays: 2 }],
    // Weeks are seven days.
    ["1-2 saptamani", { minDays: 7, maxDays: 14 }],
    // An upper bound alone: that figure, never faster than promised.
    ["up to 5 days", { minDays: 5, maxDays: 5 }],
    ["pana la 3 zile", { minDays: 3, maxDays: 3 }],
    // Several durations: the span.
    ["1-2 zile, 3-5 zile in afara Bucurestiului", { minDays: 1, maxDays: 5 }],
    // Republica BIO's wording: two durations in hours, and two clock times that are not durations.
    [
      "\u00cen 24 de ore pentru comenzile plasate p\u00e2n\u0103 la ora 13:00, de luni p\u00e2n\u0103 joi; \u00een maxim 48 de ore pentru cele plasate dup\u0103 ora 13:00",
      { minDays: 1, maxDays: 2 },
    ],
    // A price beside the time is not a duration.
    ["2 zile, 20 lei", { minDays: 2, maxDays: 2 }],
    // Dirty input: case, diacritics, dashes, NBSP.
    ["  2 - 4 ZILE  ", { minDays: 2, maxDays: 4 }],
    ["1\u20132 zile", { minDays: 1, maxDays: 2 }],
    ["1\u00a0-\u00a02 zile", { minDays: 1, maxDays: 2 }],
    ["2 zile lucr\u0103toare", { minDays: 2, maxDays: 2 }],
    // Unreadable.
    ["call us", null],
    ["", null],
    ["5 lei", null],
  ])("%s", (text, expected) => {
    expect(readDeliveryTime(text)).toEqual(expected);
  });
});

describe("deliveryTimeLine", () => {
  it.each([
    ["1-2 zile", false, "Delivery time published for Google: 1 to 2 days."],
    ["next day", false, "Delivery time published for Google: 1 day."],
    ["in aceeasi zi", false, "Delivery time published for Google: the same day."],
    ["3 zile", false, "Delivery time published for Google: 3 days."],
    ["call us", false, "Delivery time not published for Google: we could not read a number of days from this text."],
  ])("%s", (text, varies, line) => {
    expect(deliveryTimeLine(text as string, varies as boolean)).toBe(line);
  });

  it("says nothing when the field is empty or the time varies by product", () => {
    expect(deliveryTimeLine("  ", false)).toBeNull();
    expect(deliveryTimeLine("1-2 zile", true)).toBeNull();
  });
});

// Items 2d and 3: the Liquid rules in TypeScript, for B6.
describe("shippingServicePublished and offerShippingPublished", () => {
  const parsed = (value: number | null, free: number | null = null) => ({
    rate: value,
    currency: "RON",
    freeOverAmount: free,
  });
  const days = { minDays: 1, maxDays: 2 };
  // Changed on purpose by CC-PROMPT-AI-READABILITY-4 item 4: a time publishes when read into days, not as text.
  it.each([
    ["a rate read", { deliveryCostParsed: parsed(20) }, true, true],
    ["a starting price", { deliveryCostParsed: parsed(20), deliveryCostIsFrom: true }, false, false],
    ["a starting price and a time", { deliveryCostParsed: parsed(20), deliveryCostIsFrom: true, deliveryTimeParsed: days }, false, true],
    ["a threshold alone", { deliveryCostParsed: parsed(null, 200) }, true, true],
    ["a starting price and a threshold", { deliveryCostParsed: parsed(15, 200), deliveryCostIsFrom: true }, true, true],
    ["a time that varies", { deliveryTimeParsed: days, deliveryVaries: true }, false, false],
    ["a time as text that was never read into days", { deliveryTime: "1-2" }, false, false],
    ["nothing", {}, false, false],
  ])("%s", (_name, record, service, offer) => {
    expect(shippingServicePublished(record)).toBe(service);
    expect(offerShippingPublished(record)).toBe(offer);
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

describe("deliveryLine", () => {
  const base = { costText: "25 RON", isFrom: false, timeText: "1-2 zile", varies: false };

  it("is the cost line and then the time line", () => {
    expect(deliveryLine({ ...base, shopCurrency: "RON" })).toBe(
      "Published for Google: 25 RON. Delivery time published for Google: 1 to 2 days.",
    );
  });

  it("says nothing when both fields are empty", () => {
    expect(deliveryLine({ costText: " ", isFrom: false, timeText: "", varies: false, shopCurrency: "RON" })).toBeNull();
    expect(deliveryLine({ costText: " ", isFrom: false, timeText: "", varies: false, shopCurrency: null })).toBeNull();
  });

  // The save keeps the words and publishes nothing; the line says both.
  it("says why nothing is published when the shop's currency could not be read", () => {
    const line = deliveryLine({ ...base, shopCurrency: null });
    expect(line).toBe(DELIVERY_CURRENCY_UNKNOWN_LINE);
    expect(line).toMatch(/^[\x20-\x7e]*$/);
    expect(line).not.toMatch(/Published for Google:/);
    expect(deliveryLine({ ...base, costText: "", shopCurrency: null })).toBe(DELIVERY_CURRENCY_UNKNOWN_LINE);
  });
});
