// DICTIONARY-PORT §2. Dictionary format:
//   Label: term, term *, * term, #size | default: value

export type DictionaryGroup = {
  label: string;
  terms: string[];
  fallback: string;
};

export function parseDictionary(raw: string): DictionaryGroup[] {
  const out = new Map<string, DictionaryGroup>();

  for (const rawLine of String(raw ?? "").split(/\r\n|\r|\n/)) {
    let line = rawLine.trim();
    if (line === "" || !line.includes(":")) continue;

    // Optional "| default: value" at the end of the line.
    let fallback = "";
    const pipe = line.indexOf("|");
    if (pipe !== -1) {
      const options = line.slice(pipe + 1).trim();
      line = line.slice(0, pipe).trim();
      const match = options.match(/default\s*:\s*(.+)$/i);
      if (match) fallback = match[1].trim();
    }

    const colon = line.indexOf(":");
    const label = line.slice(0, colon).trim();
    const termsRaw = line.slice(colon + 1).trim();
    if (label === "" || termsRaw === "") continue;

    const terms = termsRaw
      .split(",")
      .map((t) => t.trim())
      .filter((t) => t !== "");
    if (terms.length === 0) continue;

    // Later duplicate labels overwrite earlier ones (PHP array key behaviour).
    out.set(label, { label, terms, fallback });
  }

  return Array.from(out.values());
}

/**
 * The built-in list. Written for a bridal shop first; it is the wrong list
 * for most shops, which is why the settings screen says so out loud and
 * offers a starting point for other trades.
 */
export const DEFAULT_DICTIONARY = [
  "Material: lace, Chantilly lace, guipure, tulle, satin, silk, crepe, organza, beads, sequins, embroidery, velvet, linen, cotton, wool",
  "Cut: cut *, silhouette *, A-line, mermaid, ball gown, princess, fitted, straight, flared, column, empire, wrap",
  "Length: mini, midi, short, long, maxi, knee-length, ankle-length, floor-length",
  "Neckline: neckline *, V-neck, sweetheart, square, boat, halter, off-shoulder, one shoulder",
  "Sleeves: sleeves *, straps *, sleeveless, strapless, detachable sleeves, puff sleeves, spaghetti straps",
  "Back: back *, open back, lace-up, corset, buttons, hidden zip",
  "Details: train, detachable train, fringe, appliqué, 3D flowers, beading, feathers, crystals, pearls, belt, pockets, veil, cape, slit",
  "Colour: white, ivory, off-white, nude, champagne, blush, black, navy, grey, beige",
  "Occasion: wedding, civil ceremony, engagement, christening, party, evening, everyday",
].join("\n");

/**
 * Starter dictionaries, one per trade. English by default, because the terms
 * have to be edited into the language the descriptions are actually written
 * in — a list nobody can read is worse than no list at all.
 */
export const PRESETS: Record<string, { label: string; lines: string[] }> = {
  fashion: {
    label: "Clothing and bridal",
    lines: [
      "Material: lace, Chantilly lace, guipure, tulle, satin, silk, crepe, organza, beads, sequins, embroidery, velvet, linen, cotton, wool, denim, leather",
      "Cut: cut *, silhouette *, A-line, mermaid, ball gown, princess, fitted, straight, flared, column, empire, wrap",
      "Length: mini, midi, short, long, maxi, knee-length, ankle-length, floor-length, cropped",
      "Neckline: neckline *, V-neck, sweetheart, square, boat, halter, off-shoulder, one shoulder, high neck",
      "Sleeves: sleeves *, straps *, sleeveless, strapless, long sleeves, short sleeves, detachable sleeves, puff sleeves, spaghetti straps",
      "Back: back *, open back, low back, lace-up, corset, buttons, hidden zip",
      "Details: train, detachable train, fringe, appliqué, 3D flowers, beading, feathers, crystals, pearls, belt, pockets, veil, cape, slit, lining",
      "Colour: white, ivory, off-white, nude, champagne, blush, black, navy, grey, beige, red, green, blue",
      "Occasion: wedding, civil ceremony, engagement, christening, party, evening, cocktail, everyday, office",
    ],
  },
  furniture: {
    label: "Furniture and interiors",
    lines: [
      "Material: oak, walnut, beech, pine, ash, birch, MDF, chipboard, veneer, glass, metal, steel, brass, marble, stone, rattan, leather, faux leather, fabric, velvet, linen, cotton",
      "Finish: lacquered, oiled, waxed, matt, gloss, painted, natural, distressed, brushed",
      "Style: modern, scandinavian, industrial, classic, rustic, minimalist, vintage, retro, boho, contemporary, mid-century",
      "Dimensions: #size",
      "Capacity: * seats, * drawers, * shelves, * doors, * places, * people",
      "Features: extendable, folding, reclining, with storage, with drawers, adjustable, modular, on castors, sofa bed, stackable",
      "Colour: white, black, grey, anthracite, beige, cream, natural, oak, walnut, wenge, green, blue",
      "Room: living room, bedroom, kitchen, dining room, office, hallway, bathroom, terrace, kids room",
    ],
  },
  electronics: {
    label: "Electronics",
    lines: [
      "Screen: screen *, display *, resolution *, OLED, AMOLED, LCD, IPS, retina, touchscreen, refresh rate *",
      "Processor: processor *, chipset *, cores *, GHz",
      "Memory: RAM *, storage *, GB, TB, SSD, HDD, expandable, microSD",
      "Battery: battery *, mAh, battery life *, fast charging, wireless charging",
      "Connectivity: Wi-Fi, Bluetooth, USB-C, HDMI, ethernet, jack, 5G, LTE, NFC",
      "Camera: camera *, megapixels, MP, optical stabilisation, ultrawide, telephoto, front camera",
      "Warranty: warranty *, years, months",
    ],
  },
  services: {
    label: "Services",
    lines: [
      "Duration: * hours, * days, * weeks, * months, * sessions",
      "Format: online, on site, at your premises, hybrid, remote, one to one, group",
      "Includes: consulting, implementation, maintenance, training, support, reporting, audit, strategy",
      "Suited to: beginners, advanced, companies, freelancers, online shops, restaurants, clinics, agencies",
      "Delivery: delivery *, turnaround *, working days, lead time *",
    ],
  },
  food: {
    label: "Food and drink",
    lines: [
      "Ingredients: ingredients *, contains *, free from *, made with *",
      "Diet: vegan, vegetarian, gluten free, lactose free, sugar free, organic, keto, halal, kosher",
      "Weight: #size, * pieces, * portions",
      "Origin: origin *, made in *, produced in *, local, artisan, single origin",
      "Storage: refrigerated, frozen, ambient, shelf life *, best before *",
    ],
  },
};

export function presetText(key: string): string {
  return PRESETS[key] ? PRESETS[key].lines.join("\n") : "";
}
