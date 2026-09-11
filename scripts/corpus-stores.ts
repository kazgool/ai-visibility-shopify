// The FAQ corpus's stores as the engine runs them (CC-PROMPT-AI-READABILITY-3).
// Which set each store is in is decided in _shopify/corpus/manifest.md; this
// file only says how each one is run.
//
// preset:    the trade preset a merchant in that vertical would pick; its text is
//            the dictionary, and its id selects the preset question templates.
//            Chosen from the vertical alone, never from a hold-out product.
// dictionary: a merchant's own dictionary file instead of a preset.
// shopName:  the store's brand, for the "vendor differs from the shop" rule.
// business:  a business record, where one is known.
import type { BusinessInfo, Language } from "../app/engine";

export type CorpusStore = {
  name: string;
  set: "dev" | "holdout";
  language: Language;
  vertical: string;
  preset: string | null;
  dictionary?: string;
  shopName: string;
  business?: BusinessInfo;
};

/** Republica BIO's delivery, returns and payment as its product pages state
 * them on 11 September 2026, in the words a merchant would type into the
 * Business screen. Not the "1-2" shorthand scripts/audit-engine-run.ts uses:
 * a delivery time with no unit would be judged against us for our own typing. */
const RB_BUSINESS: BusinessInfo = {
  deliveryTime:
    "În 24 de ore pentru comenzile plasate până la ora 13:00, de luni până joi; în maxim 48 de ore pentru cele plasate după ora 13:00",
  deliveryCost: "15 Lei sub 1 kg, plus 1 leu pentru fiecare kg suplimentar; gratuit peste 250 de lei",
  returnDays: 14,
  paymentMethods: "Card bancar (Visa, Mastercard); Ramburs (plata la livrare); Transfer bancar/ordin de plată în contul Republica BIO",
};

export const CORPUS_STORES: CorpusStore[] = [
  // Dev
  { name: "republicabio.ro", set: "dev", language: "ro", vertical: "food and supplements", preset: null, dictionary: "F:/AI Visibility SHOPIFY/dictionar-republicabio-curatat.txt", shopName: "Republica BIO", business: RB_BUSINESS },
  { name: "globalmobila-fixture.csv", set: "dev", language: "ro", vertical: "furniture", preset: "furniture", shopName: "Global Mobila" },
  { name: "secom.ro", set: "dev", language: "ro", vertical: "food and supplements", preset: "supplements", shopName: "Secom" },
  { name: "mobexpert.ro", set: "dev", language: "ro", vertical: "furniture", preset: "furniture", shopName: "Mobexpert" },
  { name: "rusticart.ro", set: "dev", language: "ro", vertical: "furniture and home", preset: "furniture", shopName: "Rusticart" },
  { name: "aquaframe.ro", set: "dev", language: "ro", vertical: "home", preset: "retail", shopName: "Aquaframe" },
  { name: "deathwishcoffee.com", set: "dev", language: "en", vertical: "food", preset: "food", shopName: "Death Wish Coffee" },
  { name: "greatjonesgoods.com", set: "dev", language: "en", vertical: "home", preset: "retail", shopName: "Great Jones" },
  { name: "colourpop.com", set: "dev", language: "en", vertical: "cosmetics", preset: "beauty", shopName: "ColourPop" },
  { name: "beardbrand.com", set: "dev", language: "en", vertical: "cosmetics", preset: "beauty", shopName: "Beardbrand" },
  { name: "taylorstitch.com", set: "dev", language: "en", vertical: "fashion", preset: "clothing", shopName: "Taylor Stitch" },
  { name: "marialuciahohan.com", set: "dev", language: "en", vertical: "fashion", preset: "clothing", shopName: "Maria Lucia Hohan" },
  { name: "zeedog.com", set: "dev", language: "en", vertical: "pets", preset: "pets", shopName: "Zee.Dog" },
  { name: "fablepets.com", set: "dev", language: "en", vertical: "pets and toys", preset: "pets", shopName: "Fable Pets" },
  { name: "twelvesouth.com", set: "dev", language: "en", vertical: "electronics", preset: "electronics", shopName: "Twelve South" },
  { name: "shokz.com", set: "dev", language: "en", vertical: "electronics", preset: "electronics", shopName: "Shokz" },
  { name: "brightland.co", set: "dev", language: "en", vertical: "food", preset: "food", shopName: "Brightland" },
  { name: "feals.com", set: "dev", language: "en", vertical: "supplements", preset: "supplements", shopName: "Feals" },
  { name: "graza.co", set: "dev", language: "en", vertical: "food", preset: "food", shopName: "Graza" },
  { name: "meowmeowtweet.com", set: "dev", language: "en", vertical: "cosmetics", preset: "beauty", shopName: "Meow Meow Tweet" },
  { name: "moleculesofyouth.com", set: "dev", language: "en", vertical: "supplements", preset: "supplements", shopName: "Molecules of Youth" },
  { name: "toskovat.com", set: "dev", language: "en", vertical: "cosmetics", preset: "beauty", shopName: "Toskovat" },
  { name: "truff.com", set: "dev", language: "en", vertical: "food", preset: "food", shopName: "Truff" },
  // Hold-out: never opened while writing rules.
  // Hold-out until run holdout2 (11 September 2026); their errors were read to
  // fix rules, so they moved to dev and a store of the same language replaced
  // each (_shopify/corpus/manifest.md).
  { name: "animax.ro", set: "dev", language: "ro", vertical: "pets", preset: "pets", shopName: "Animax" },
  { name: "istyle.ro", set: "dev", language: "ro", vertical: "electronics", preset: "electronics", shopName: "iStyle" },
  { name: "jlab.com", set: "dev", language: "en", vertical: "electronics", preset: "electronics", shopName: "JLab" },
  // Hold-out in run holdout3, moved to dev after its errors were read.
  { name: "terraissa.com", set: "dev", language: "ro", vertical: "cosmetics", preset: "beauty", shopName: "Terra Issa" },
  // Third split (after holdout3): same-language replacements, counts only.
  { name: "herbaris.ro", set: "holdout", language: "ro", vertical: "cosmetics and household", preset: "beauty", shopName: "Herbaris" },
  { name: "miledy.ro", set: "holdout", language: "ro", vertical: "cosmetics", preset: "beauty", shopName: "Miledy" },
  { name: "gunner.com", set: "holdout", language: "en", vertical: "pets", preset: "pets", shopName: "Gunner" },
  { name: "outdoorvoices.com", set: "holdout", language: "en", vertical: "fashion", preset: "clothing", shopName: "Outdoor Voices" },
  { name: "e-ring.ro", set: "holdout", language: "ro", vertical: "jewellery", preset: "retail", shopName: "E-Ring" },
  { name: "peakdesign.com", set: "holdout", language: "en", vertical: "electronics and gear", preset: "electronics", shopName: "Peak Design" },
  // Added to the hold-out the same day, from counts only, so the bar is not
  // carried by two stores: e-ring.ro and peakdesign.com produce fewer than 50.
  { name: "jolar.ro", set: "holdout", language: "ro", vertical: "fashion (leather goods)", preset: "fashion", shopName: "Jolar" },
  { name: "iarmaroc.com", set: "holdout", language: "ro", vertical: "designer marketplace", preset: "retail", shopName: "IARMAROC" },
  { name: "vintageradar.com", set: "holdout", language: "en", vertical: "fashion (watches)", preset: "retail", shopName: "Vintage Radar" },
  { name: "thesill.com", set: "dev", language: "en", vertical: "home", preset: "retail", shopName: "The Sill" },
  { name: "cocokind.com", set: "holdout", language: "en", vertical: "cosmetics", preset: "beauty", shopName: "cocokind" },
  { name: "wildone.com", set: "dev", language: "en", vertical: "pets", preset: "pets", shopName: "Wild One" },
];
