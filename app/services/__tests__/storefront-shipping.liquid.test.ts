import { describe, expect, it } from "vitest";
import { blockDefaults, ldObjects, ourNodes, renderBlock, SHOP_URL, storefront } from "./liquid-harness";

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
const orgOf = (html: string) => ourNodes(html, "Organization")[0];
const serviceOf = (html: string) => orgOf(html)?.hasShippingService;

const SERVICE_ID = `${SHOP_URL}/#shipping`;
const REFERENCE = { "@type": "OfferShippingDetails", hasShippingService: { "@id": SERVICE_ID } };
const RO = { "@type": "DefinedRegion", addressCountry: "RO" };
const money = (value: number) => ({ "@type": "MonetaryAmount", value, currency: "RON" });

describe("the shop-wide delivery policy on the Organization node (item 3)", () => {
  it("states the base rate as one condition when the rate is read and the box is not ticked", async () => {
    const html = await page({ deliveryCost: "19,99 lei", deliveryCostParsed: rate(19.99) });
    const org = orgOf(html);
    expect(org["@id"]).toBe(`${SHOP_URL}#organization`);
    expect(org.sameAs).toBeUndefined();
    expect(serviceOf(html)).toEqual({
      "@type": "ShippingService",
      "@id": SERVICE_ID,
      name: "19,99 lei",
      shippingConditions: [{ "@type": "ShippingConditions", shippingDestination: RO, shippingRate: money(19.99) }],
    });
  });

  it("bounds the base rate below the threshold and starts free delivery at it, as the documentation's example does", async () => {
    const html = await page({ deliveryCost: "19,99 lei, gratuit peste 200 lei", deliveryCostParsed: rate(19.99, 200) });
    expect(serviceOf(html).shippingConditions).toEqual([
      {
        "@type": "ShippingConditions",
        shippingDestination: RO,
        orderValue: { "@type": "MonetaryAmount", minValue: 0, maxValue: 199.99, currency: "RON" },
        shippingRate: money(19.99),
      },
      {
        "@type": "ShippingConditions",
        shippingDestination: RO,
        orderValue: { "@type": "MonetaryAmount", minValue: 200, currency: "RON" },
        shippingRate: money(0),
      },
    ]);
  });

  it("states only the free condition when the box is ticked", async () => {
    const html = await page({
      deliveryCost: "de la 15 lei, gratuit peste 200 lei",
      deliveryCostIsFrom: true,
      deliveryCostParsed: rate(15, 200),
    });
    const conditions = serviceOf(html).shippingConditions;
    expect(conditions).toHaveLength(1);
    expect(conditions[0].orderValue.minValue).toBe(200);
    expect(conditions[0].shippingRate).toEqual(money(0));
  });

  it("states only the free condition when no rate could be read (Republica BIO's wording)", async () => {
    const html = await page({
      deliveryCost: "15 Lei sub 1 kg, plus 1 leu pentru fiecare kg suplimentar; gratuit peste 250 de lei",
      deliveryCostParsed: rate(null, 250),
    });
    const conditions = serviceOf(html).shippingConditions;
    expect(conditions).toHaveLength(1);
    expect(conditions[0].orderValue).toEqual({ "@type": "MonetaryAmount", minValue: 250, currency: "RON" });
  });

  it("publishes no policy, and no Organization node at all without profiles, when there is nothing to state", async () => {
    const html = await page({ deliveryCost: "25 lei", deliveryCostIsFrom: true, deliveryCostParsed: rate(25) });
    expect(ourNodes(html, "Organization")).toHaveLength(0);
  });

  it("states every country typed in each condition", async () => {
    const html = await page({
      deliveryCost: "20 lei, gratuit peste 300 lei",
      deliveryCostParsed: rate(20, 300),
      deliveryCountries: ["RO", "MD"],
    });
    for (const condition of serviceOf(html).shippingConditions) {
      expect(condition.shippingDestination).toEqual([RO, { "@type": "DefinedRegion", addressCountry: "MD" }]);
    }
  });

  it("joins the theme's Organization node by its @id when the scan found one", async () => {
    const themeOrg = `${SHOP_URL}/#theme-organization`;
    const html = await page(
      { deliveryCost: "20 lei", deliveryCostParsed: rate(20) },
      { themeScan: { ...NO_THEME_NODE, organizationId: themeOrg } },
    );
    const org = orgOf(html);
    expect(org["@id"]).toBe(themeOrg);
    expect(org.name).toBeUndefined();
    expect(org.hasShippingService["@id"]).toBe(SERVICE_ID);
  });

  it("is on every page, the home page included, beside the store profiles", async () => {
    const html = await renderBlock(
      HEAD,
      storefront({
        template: "index",
        settings,
        business: {
          deliveryCost: "20 lei",
          deliveryCostParsed: rate(20),
          socialProfiles: { facebook: "https://www.facebook.com/nordwood" },
        },
      }),
    );
    const org = orgOf(html);
    expect(org.sameAs).toEqual(["https://www.facebook.com/nordwood"]);
    expect(org.hasShippingService.shippingConditions).toHaveLength(1);
  });
});

describe("the Offer's shippingDetails (items 2d and 3)", () => {
  // Changed on purpose by CC-PROMPT-AI-READABILITY-4 item 3: the rate and destination moved to the shop-wide policy, and the Offer refers to it by @id only, as the merchant listing documentation says.
  it("refers to the shop-wide policy by @id, and states nothing else, when the rate is read", async () => {
    const html = await page({ deliveryCost: "19,99 lei", deliveryCostParsed: rate(19.99), deliveryTime: "1-2 zile" });
    expect(offerOf(html).shippingDetails).toEqual(REFERENCE);
  });

  it("states no rate when the starting price box is ticked, and still the destination and the time", async () => {
    const html = await page({
      deliveryCost: "25 lei",
      deliveryCostIsFrom: true,
      deliveryCostParsed: rate(25),
      deliveryTime: "1-2 zile",
    });
    const details = offerOf(html).shippingDetails;
    expect(details.shippingRate).toBeUndefined();
    expect(details.hasShippingService).toBeUndefined();
    expect(details.shippingDestination).toEqual(RO);
    expect(details.deliveryTime).toBeDefined();
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-4 item 3: a threshold makes a shop-wide policy, so the Offer refers to it.
  it("refers to the policy when only a threshold was read, and never states the threshold on the Offer", async () => {
    const html = await page({
      deliveryCost: "15 lei sub 1 kg; gratuit peste 250 de lei",
      deliveryCostParsed: rate(null, 250),
      deliveryTime: "1-2 zile",
    });
    expect(offerOf(html).shippingDetails).toEqual(REFERENCE);
    expect(JSON.stringify(offerOf(html))).not.toContain("250");
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-4 item 3: a threshold alone makes a shop-wide policy to refer to.
  it("refers to the policy for a threshold alone with no delivery time", async () => {
    const html = await page({ deliveryCost: "gratuit peste 200 lei", deliveryCostParsed: rate(null, 200) });
    expect(offerOf(html).shippingDetails).toEqual(REFERENCE);
  });

  it("states every country typed, as an array, when it states its own destination", async () => {
    const html = await page({
      deliveryCost: "de la 20 lei",
      deliveryCostIsFrom: true,
      deliveryCostParsed: rate(20),
      deliveryTime: "1-2 zile",
      deliveryCountries: ["RO", "MD", "BG"],
    });
    expect(offerOf(html).shippingDetails.shippingDestination).toEqual([
      RO,
      { "@type": "DefinedRegion", addressCountry: "MD" },
      { "@type": "DefinedRegion", addressCountry: "BG" },
    ]);
  });

  it("falls back to the shop's own country, and states no destination when there is none", async () => {
    const own = { deliveryCost: "de la 20 lei", deliveryCostIsFrom: true, deliveryCostParsed: rate(20), deliveryTime: "1-2 zile" };
    const md = await page(own, { countryCode: "MD" });
    expect(offerOf(md).shippingDetails.shippingDestination).toEqual({ "@type": "DefinedRegion", addressCountry: "MD" });
    const none = await page(own, { countryCode: null });
    expect(offerOf(none).shippingDetails.shippingDestination).toBeUndefined();
    expect(offerOf(none).shippingDetails.deliveryTime).toBeDefined();
  });

  it("states no delivery time when it varies by product", async () => {
    const own = await page({
      deliveryCost: "de la 20 lei",
      deliveryCostIsFrom: true,
      deliveryCostParsed: rate(20),
      deliveryTime: "1-2 zile",
      deliveryVaries: true,
    });
    expect(offerOf(own).shippingDetails).toBeUndefined();
    const policy = await page({ deliveryCost: "20 lei", deliveryCostParsed: rate(20), deliveryTime: "1-2 zile", deliveryVaries: true });
    expect(offerOf(policy).shippingDetails).toEqual(REFERENCE);
  });

  // Changed on purpose by CC-PROMPT-AI-READABILITY-4 item 3: no rate is stated on the Offer any more, so the visitor's currency changes nothing there; the policy carries the shop's.
  it("refers to the policy whatever the visitor's currency", async () => {
    const html = await page({ deliveryCost: "20 lei", deliveryCostParsed: rate(20) }, { currency: "EUR" });
    expect(offerOf(html).priceCurrency).toBe("EUR");
    expect(offerOf(html).shippingDetails).toEqual(REFERENCE);
    expect(serviceOf(html).shippingConditions[0].shippingRate.currency).toBe("RON");
  });

  it("states nothing from a record saved before the text was read into numbers", async () => {
    const html = await page({ deliveryCost: "19,99 lei" });
    expect(offerOf(html).shippingDetails).toBeUndefined();
    expect(ourNodes(html, "Organization")).toHaveLength(0);
  });

  it("adds no shippingDetails to an AggregateOffer (item 2e); the shop-wide policy still covers it", async () => {
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
    expect(serviceOf(html)["@id"]).toBe(SERVICE_ID);
  });
});

describe("every combination renders JSON that parses", () => {
  it("across the cases above and their neighbours", async () => {
    for (const business of [
      {},
      { deliveryCost: "free", deliveryCostParsed: rate(0) },
      { deliveryCost: "x", deliveryCostParsed: rate(19.99, 200), deliveryCountries: ["RO", "MD"], deliveryTime: "2-4 zile" },
      { deliveryCost: "x", deliveryCostParsed: rate(null, null), deliveryTime: "x", deliveryVaries: true },
      { deliveryCost: "x", deliveryCostParsed: rate(5, 50), deliveryCostIsFrom: true, socialProfiles: { x: "https://x.com/n" } },
    ]) {
      for (const countryCode of ["RO", null]) {
        const html = await page(business, { countryCode });
        expect(() => ldObjects(html)).not.toThrow();
      }
    }
  });
});
