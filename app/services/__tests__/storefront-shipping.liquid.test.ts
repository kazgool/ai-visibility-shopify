import { describe, expect, it } from "vitest";
import { blockDefaults, ldObjects, ourNodes, renderBlock, storefront } from "./liquid-harness";

// CC-PROMPT-AI-READABILITY-4 items 2 to 4: delivery in structured data, from
// the Business record as saved (text plus the numbers read from it). The head
// embed rendered whole through liquidjs, in Full mode on a theme with no
// Product node of its own, so our complete node is on the page. Invented data.

const HEAD = "ai-visibility.liquid";
const settings = { ...blockDefaults(HEAD), mode: "full" };
const NO_THEME_NODE = { productId: "", hasProductLd: false };

const rate = (value: number | null, freeOverAmount: number | null = null) => ({
  rate: value,
  currency: "RON",
  freeOverAmount,
});

async function page(business: Record<string, unknown>, extra: Parameters<typeof storefront>[0] = {}) {
  return renderBlock(HEAD, storefront({ settings, themeScan: NO_THEME_NODE, business, ...extra }));
}

const offerOf = (html: string) => ourNodes(html, "Product")[0].offers;

describe("the Offer's shippingDetails (item 2d)", () => {
  it("publishes the rate and the destination when the rate is read and the box is not ticked", async () => {
    const html = await page({ deliveryCost: "19,99 lei", deliveryCostParsed: rate(19.99), deliveryTime: "1-2 zile" });
    const details = offerOf(html).shippingDetails;
    expect(details["@type"]).toBe("OfferShippingDetails");
    expect(details.shippingRate).toEqual({ "@type": "MonetaryAmount", value: 19.99, currency: "RON" });
    expect(details.shippingDestination).toEqual({ "@type": "DefinedRegion", addressCountry: "RO" });
  });

  it("publishes no rate when the starting price box is ticked, and still the destination and the time", async () => {
    const html = await page({
      deliveryCost: "25 lei",
      deliveryCostIsFrom: true,
      deliveryCostParsed: rate(25),
      deliveryTime: "1-2 zile",
    });
    const details = offerOf(html).shippingDetails;
    expect(details.shippingRate).toBeUndefined();
    expect(details.shippingDestination).toEqual({ "@type": "DefinedRegion", addressCountry: "RO" });
    expect(details.deliveryTime).toBeDefined();
  });

  it("publishes no rate when none could be read, and never the free-over threshold on the Offer", async () => {
    const html = await page({
      deliveryCost: "15 lei sub 1 kg; gratuit peste 250 de lei",
      deliveryCostParsed: rate(null, 250),
      deliveryTime: "1-2 zile",
    });
    const details = offerOf(html).shippingDetails;
    expect(details.shippingRate).toBeUndefined();
    expect(JSON.stringify(offerOf(html))).not.toContain("250");
  });

  it("publishes no shippingDetails at all for a threshold alone with no delivery time", async () => {
    const html = await page({ deliveryCost: "gratuit peste 200 lei", deliveryCostParsed: rate(null, 200) });
    expect(offerOf(html).shippingDetails).toBeUndefined();
  });

  it("publishes every country typed, as an array when there are several", async () => {
    const html = await page({
      deliveryCost: "20 lei",
      deliveryCostParsed: rate(20),
      deliveryCountries: ["RO", "MD", "BG"],
    });
    expect(offerOf(html).shippingDetails.shippingDestination).toEqual([
      { "@type": "DefinedRegion", addressCountry: "RO" },
      { "@type": "DefinedRegion", addressCountry: "MD" },
      { "@type": "DefinedRegion", addressCountry: "BG" },
    ]);
  });

  it("falls back to the shop's own country, and publishes no destination when there is none", async () => {
    const md = await page({ deliveryCost: "20 lei", deliveryCostParsed: rate(20) }, { countryCode: "MD" });
    expect(offerOf(md).shippingDetails.shippingDestination).toEqual({ "@type": "DefinedRegion", addressCountry: "MD" });
    const none = await page({ deliveryCost: "20 lei", deliveryCostParsed: rate(20) }, { countryCode: null });
    expect(offerOf(none).shippingDetails.shippingDestination).toBeUndefined();
  });

  it("publishes no delivery time when it varies by product", async () => {
    const html = await page({
      deliveryCost: "20 lei",
      deliveryCostParsed: rate(20),
      deliveryTime: "1-2 zile",
      deliveryVaries: true,
    });
    const details = offerOf(html).shippingDetails;
    expect(details.deliveryTime).toBeUndefined();
    expect(details.shippingRate).toBeDefined();
  });

  it("publishes no rate in a currency other than the offer's", async () => {
    const html = await page({ deliveryCost: "20 lei", deliveryCostParsed: rate(20) }, { currency: "EUR" });
    expect(offerOf(html).priceCurrency).toBe("EUR");
    expect(offerOf(html).shippingDetails).toBeUndefined();
  });

  it("publishes no rate from a record saved before the text was read into numbers", async () => {
    const html = await page({ deliveryCost: "19,99 lei" });
    expect(offerOf(html).shippingDetails).toBeUndefined();
  });

  it("adds no shippingDetails to an AggregateOffer (item 2e)", async () => {
    const context = storefront({
      settings,
      themeScan: NO_THEME_NODE,
      business: { deliveryCost: "20 lei", deliveryCostParsed: rate(20), deliveryTime: "1-2 zile", returnDays: 14 },
    });
    Object.assign(context.product as Record<string, unknown>, { price_varies: true, price_min: 10000, price_max: 20000 });
    const html = await renderBlock(HEAD, context);
    const offers = offerOf(html);
    expect(offers["@type"]).toBe("AggregateOffer");
    expect(offers.shippingDetails).toBeUndefined();
  });

  it("renders JSON that parses in every case above", async () => {
    for (const business of [
      {},
      { deliveryCostParsed: rate(0) },
      { deliveryCostParsed: rate(19.99, 200), deliveryCountries: ["RO", "MD"], deliveryTime: "2-4 zile" },
      { deliveryCostParsed: rate(null, null), deliveryTime: "x", deliveryVaries: true },
    ]) {
      const html = await page(business);
      expect(() => ldObjects(html)).not.toThrow();
    }
  });
});
