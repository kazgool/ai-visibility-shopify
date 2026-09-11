// The Business screen's delivery answers, read from the words the merchant
// typed into numbers structured data can carry (CC-PROMPT-AI-READABILITY-4
// item 2). The text itself is never changed: it stays exactly as typed in the
// business record and everywhere text is published (the buyer questions, the
// plain-text page, llms.txt). What this produces is stored next to it.
//
// Pure, and not a .server module: the Business screen shows what will be
// published for Google as the merchant types, and a component may not import
// a .server file (the reason social-profiles.ts exists). business.server.ts
// runs it on save.
//
// The rule every branch follows: a number goes into structured data only when
// the text states it as one exact delivery price. A text stating several
// (by weight, per item, a range), a starting price, or two currencies gives no
// rate at all rather than one that is false for part of the orders. The
// merchant sees why on the screen and can reword it; a wrong price published
// to Google is not something they can see.

export type DeliveryCostParsed = {
  /** One exact delivery price, or null when the text states none. 0 is free delivery. */
  rate: number | null;
  /** ISO 4217. The currency written in the text, else the shop's. */
  currency: string;
  /** Orders from this amount ship free. Null when the text states no threshold. */
  freeOverAmount: number | null;
};

/** Why `rate` is null, for the one line on the Business screen. */
export type RateNote = "none" | "starting" | "varies" | "currency";

export type CostReading = {
  parsed: DeliveryCostParsed;
  rateNote: RateNote | null;
};

/**
 * Lower case, no diacritics, one kind of space and one kind of dash. NBSP and
 * the narrow no-break space arrive from copy-pasted admin text; "gratuita"
 * with or without its breve is one word here.
 */
export function normalizeDeliveryText(text: string): string {
  return text
    .replace(/[\u00a0\u202f\u2007]/g, " ")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[\u2010-\u2015\u2212]/g, "-")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** "19,99" and "19.99" are 19.99; "1.000" and "1,000" are 1000; "1.000,50" is 1000.5. */
export function parseAmount(raw: string): number | null {
  if (/^\d+$/.test(raw)) return Number(raw);
  if (/^\d{1,3}(?:[.,]\d{3})+$/.test(raw)) return Number(raw.replace(/[.,]/g, ""));
  const grouped = /^(\d{1,3}(?:[.,]\d{3})+)[.,](\d{1,2})$/.exec(raw);
  if (grouped) return Number(`${grouped[1].replace(/[.,]/g, "")}.${grouped[2]}`);
  const decimal = /^(\d+)[.,](\d{1,2})$/.exec(raw);
  if (decimal) return Number(`${decimal[1]}.${decimal[2]}`);
  return null;
}

const DOLLAR_CURRENCIES = new Set(["USD", "CAD", "AUD", "NZD", "SGD", "HKD"]);

/** A currency word, code or symbol, as ISO 4217. "$" is the shop's own dollar when it has one. */
function currencyOf(token: string, shopCurrency: string): string | null {
  if (/^(lei|leu|ron)$/.test(token)) return "RON";
  if (/^(eur|euro|euros|\u20ac)$/.test(token)) return "EUR";
  if (/^(gbp|\u00a3)$/.test(token)) return "GBP";
  if (/^(usd|dollars?|dolari)$/.test(token)) return "USD";
  if (token === "$") return DOLLAR_CURRENCIES.has(shopCurrency) ? shopCurrency : "USD";
  return null;
}

const CURRENCY_AFTER = /^\s*(?:de\s+)?(lei|leu|ron|eur|euros?|\u20ac|usd|dollars?|dolari|gbp|\u00a3|\$)(?![a-z])/;
const CURRENCY_BEFORE = /(lei|ron|eur|\u20ac|usd|gbp|\u00a3|\$)\s*$/;
/** A number followed by one of these is a weight, a distance or a count - a condition, not a price. */
const CONDITION_UNIT = /^\s*(?:de\s+)?(kg|kilograme?|g|gr|grame|km|buc|bucati|pcs|pieces|items?|produse|articole|colete?)(?![a-z])/;
/** A number followed by one of these is not a price at all. */
const OTHER_UNIT = /^\s*(?:de\s+)?(zile|zi|days?|ore|ora|h|hrs?|hours?|%|ml|l|cm|mm|m)(?![a-z])/;
/** "... pentru fiecare kg", "per item": the price is per unit, so it varies with the order. */
const PER_UNIT_AFTER = /^\s*(?:de\s+)?(?:lei|leu|ron|eur|euros?|\u20ac|usd|gbp|\u00a3|\$)?\s*(?:\/|per|pe|pentru fiecare|fiecare|for each|each|every)\s*(?:kg|km|item|produs|bucata|colet|articol|kilogram|additional)/;
const STARTING_BEFORE = /(?:from|starting(?: at| from)?|starts at|incepand(?: cu| de la)?|de la|minim(?:um)?|min\.?|at least|cel putin)\s*(?:\u20ac|\u00a3|\$)?\s*$/;
const FREE = /\b(?:free|gratuit[ae]?|gratis|fara cost|fara taxa)\b/;

/**
 * Clauses: a threshold and a base price are usually two clauses of one
 * sentence ("Free over 500, or: 25"). A comma splits only when a space
 * follows, so "19,99" is never cut.
 */
function clausesOf(text: string): string[] {
  return text
    .split(/;|\|| - |,\s|\.\s|\n|\s(?:or|sau|otherwise|altfel|else)\s/)
    .map((c) => c.trim())
    .filter(Boolean);
}

type Amount = {
  value: number;
  currency: string | null;
  /** Followed by a weight, distance or count. */
  condition: boolean;
  perUnit: boolean;
  starting: boolean;
};

function amountsIn(clause: string, shopCurrency: string): Amount[] {
  // Clock times ("until 13:00") are not amounts.
  const text = clause.replace(/\b\d{1,2}:\d{2}\b/g, " ");
  const out: Amount[] = [];
  for (const match of text.matchAll(/\d+(?:[.,]\d+)*/g)) {
    const value = parseAmount(match[0]);
    if (value === null) continue;
    const start = match.index ?? 0;
    const before = text.slice(0, start);
    const after = text.slice(start + match[0].length);
    if (OTHER_UNIT.test(after)) continue;
    const condition = CONDITION_UNIT.test(after);
    const suffix = CURRENCY_AFTER.exec(after)?.[1];
    const prefix = CURRENCY_BEFORE.exec(before)?.[1];
    const token = suffix ?? prefix ?? null;
    out.push({
      value,
      currency: token ? currencyOf(token, shopCurrency) : null,
      condition,
      perUnit: PER_UNIT_AFTER.test(after),
      starting: STARTING_BEFORE.test(before),
    });
  }
  return out;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * The delivery cost text, read. `shopCurrency` is the shop's ISO currency,
 * used when the text writes none (the placeholder "Free over 500, or: 25").
 */
export function readDeliveryCost(text: string, shopCurrency: string): CostReading {
  const clauses = clausesOf(normalizeDeliveryText(text));
  const thresholds: Amount[] = [];
  const bases: Amount[] = [];
  let conditional = false;
  let freeWithoutAmount = false;

  for (const clause of clauses) {
    const amounts = amountsIn(clause, shopCurrency);
    if (amounts.some((a) => a.condition)) conditional = true;
    const prices = amounts.filter((a) => !a.condition);
    if (FREE.test(clause)) {
      // In a clause that says free, the amount is the order value it is free
      // from ("gratuit peste 200 lei", "free shipping on orders over $50"),
      // and a 0 is the price itself.
      const nonZero = prices.filter((a) => a.value !== 0);
      if (nonZero.length === 0) freeWithoutAmount = true;
      thresholds.push(...nonZero);
    } else {
      bases.push(...prices);
    }
  }

  const currencies = new Set(
    [...thresholds, ...bases].map((a) => a.currency).filter((c): c is string => c !== null),
  );
  if (currencies.size > 1) {
    return { parsed: { rate: null, currency: shopCurrency, freeOverAmount: null }, rateNote: "currency" };
  }
  const currency = currencies.size === 1 ? [...currencies][0] : shopCurrency;

  const thresholdValues = new Set(thresholds.map((a) => round2(a.value)));
  const freeOverAmount = thresholdValues.size === 1 ? [...thresholdValues][0] : null;

  // The candidates for one exact price: every stated base amount, and free
  // delivery stated with no threshold ("gratuit in Bucuresti, 20 lei in rest"
  // is two prices, so it varies).
  const candidates = new Set(bases.map((a) => round2(a.value)));
  if (freeWithoutAmount) candidates.add(0);

  let rate: number | null = null;
  let rateNote: RateNote | null = null;
  if (bases.some((a) => a.starting)) rateNote = "starting";
  else if (conditional || bases.some((a) => a.perUnit) || candidates.size > 1) rateNote = "varies";
  else if (candidates.size === 1) rate = [...candidates][0];
  else rateNote = "none";

  return { parsed: { rate, currency, freeOverAmount }, rateNote };
}

/**
 * "Countries you deliver to": two-letter ISO 3166-1 codes, separated by
 * commas or spaces. Anything else is returned as invalid, for the screen to
 * name - never guessed into a code.
 */
export function parseCountryList(text: string): { countries: string[]; invalid: string[] } {
  const countries: string[] = [];
  const invalid: string[] = [];
  for (const token of text.split(/[\s,;/]+/).filter(Boolean)) {
    const code = token.toUpperCase();
    if (/^[A-Z]{2}$/.test(code)) {
      if (!countries.includes(code)) countries.push(code);
    } else {
      invalid.push(token);
    }
  }
  return { countries, invalid };
}

/** The delivery answers of a business record, as far as this module reads them. */
export type DeliveryFields = {
  deliveryTime?: string;
  deliveryVaries?: boolean;
  deliveryCostIsFrom?: boolean;
  deliveryCostParsed?: DeliveryCostParsed;
};

/**
 * Whether the Organization node carries the shop-wide delivery policy
 * (ai-visibility.liquid, item 3): a publishable rate (read from the text,
 * starting price box not ticked) or a free-delivery threshold. The same rule
 * as the block, in TypeScript, for B6.
 */
export function shippingServicePublished(b: DeliveryFields): boolean {
  const rate = b.deliveryCostParsed?.rate != null && b.deliveryCostIsFrom !== true;
  const free = b.deliveryCostParsed?.freeOverAmount != null;
  return rate || free;
}

/**
 * Whether the Offer carries shippingDetails for this record, by the rule
 * ai-visibility.liquid applies: a reference to the shop-wide policy when there
 * is one (item 3), else a delivery time that does not vary (item 2d). B6 reads
 * this as "the record gives the Offer something to publish".
 */
export function offerShippingPublished(b: DeliveryFields): boolean {
  const time = (b.deliveryTime ?? "").trim() !== "" && b.deliveryVaries !== true;
  return shippingServicePublished(b) || time;
}

/** 19.99 as "19.99", 25 as "25". */
export function formatAmount(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

const RATE_NOT_PUBLISHED: Record<RateNote, string> = {
  none: "we could not read a price from this text",
  starting: "the starting price, because Google takes one exact delivery price",
  varies: "a delivery price, because this text states more than one",
  currency: "anything, because this text mixes currencies",
};

/**
 * The one line under the delivery cost field: what goes to Google from what
 * was typed, and what does not and why. Null when the field is empty. Plain
 * words - the merchant never needs to know what structured data is.
 *
 * `isFrom` is the "This is a starting price" box: a rate read from the text
 * is then not published (item 2d), and the line says so.
 */
export function deliveryCostLine(costText: string, isFrom: boolean, shopCurrency: string): string | null {
  if (costText.trim() === "") return null;
  const { parsed, rateNote } = readDeliveryCost(costText, shopCurrency);
  // No currency known at all (the shop's could not be read) prints the bare
  // amount rather than a trailing space.
  const money = (n: number) => (parsed.currency ? `${formatAmount(n)} ${parsed.currency}` : formatAmount(n));
  const parts: string[] = [];
  let reason: string | null = rateNote ? RATE_NOT_PUBLISHED[rateNote] : null;
  if (parsed.rate !== null) {
    if (isFrom) reason = RATE_NOT_PUBLISHED.starting;
    else parts.push(parsed.rate === 0 ? "free delivery" : money(parsed.rate));
  }
  if (parsed.freeOverAmount !== null) parts.push(`free over ${money(parsed.freeOverAmount)}`);

  if (parts.length === 0) {
    return `Not published for Google: ${reason ?? RATE_NOT_PUBLISHED.none}.`;
  }
  // A threshold with no base price stated ("gratuit peste 200 lei") has
  // nothing left unpublished to explain.
  if (parsed.rate === null && rateNote === "none") reason = null;
  const published = `Published for Google: ${parts.join(", ")}.`;
  return reason ? `${published} Not published: ${reason}.` : published;
}
