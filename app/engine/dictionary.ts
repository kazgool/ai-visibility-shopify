// DICTIONARY-PORT §2. Dictionary format:
//   Label: term, term *, * term, #size | default: value

export type DictionaryGroup = {
  label: string;
  terms: string[];
  fallback: string;
};

/**
 * Words a dictionary line can carry instead of an attribute family. A line
 * whose label is one of these - either plainly, or with the "+" suffix that
 * means "add to the default" - is a directive and never becomes a family.
 * That is what lets a keyword introduced in a later version land in a
 * dictionary written today without publishing an attribute group called
 * "negators".
 *
 * The "+" alone proves nothing. A merchant is free to call a family "Extras+"
 * or "Bonus+", and a rule that read every trailing "+" as a directive deleted
 * those families without a word. The keyword has to be one we know.
 */
const KEYWORDS = new Set(["negators"]);

type Directive = { name: string; add: boolean };

function directiveOf(label: string): Directive | null {
  const raw = label.trim().toLowerCase();
  const add = raw.endsWith("+");
  const name = (add ? raw.slice(0, -1) : raw).trim();
  if (!/^[a-z][a-z0-9_-]*$/.test(name)) return null;
  if (!KEYWORDS.has(name)) return null;
  return { name, add };
}

/** The default negation words, used unless a dictionary says otherwise. */
export const DEFAULT_NEGATORS: string[] = [
  "nu", "fara", "nu contine", "no", "not", "without", "free", "free of",
  "sans", "ohne", "sin", "zonder", "bez",
];

export type DictionaryOptions = { negators: string[] };

/**
 * Read the directive lines out of a dictionary. `negators: x, y` replaces the
 * default list for the shop, `negators+: x, y` adds to it; absent means the
 * default. Unknown keywords are read and dropped, not applied.
 */
export function parseDictionaryOptions(raw: string): DictionaryOptions {
  let negators = DEFAULT_NEGATORS;

  for (const rawLine of String(raw ?? "").split(/\r\n|\r|\n/)) {
    const line = rawLine.trim();
    const colon = line.indexOf(":");
    if (line === "" || colon === -1) continue;

    const directive = directiveOf(line.slice(0, colon));
    if (!directive || directive.name !== "negators") continue;

    const values = line
      .slice(colon + 1)
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "");
    if (values.length === 0) continue;

    negators = directive.add ? [...negators, ...values] : values;
  }

  return { negators };
}

export function parseDictionary(raw: string): DictionaryGroup[] {
  const out = new Map<string, DictionaryGroup>();

  for (const rawLine of String(raw ?? "").split(/\r\n|\r|\n/)) {
    let line = rawLine.trim();
    if (line === "" || !line.includes(":")) continue;
    if (directiveOf(line.slice(0, line.indexOf(":")))) continue;

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
 * The built-in list, used until a merchant picks a preset or writes their own.
 *
 * Furniture, because it is the trade with the most measurable attributes
 * buried in prose — the case this engine was built for. It is still the wrong
 * list for a clothing shop, which is why onboarding asks for the trade before
 * anything else and the settings screen says so out loud.
 */
export const DEFAULT_DICTIONARY = [
  "Material: oak, walnut, beech, pine, ash, MDF, chipboard, veneer, glass, tempered glass, metal, steel, stainless steel, brass, marble, stone, rattan, leather, faux leather, fabric, velvet, linen, cotton, foam",
  "Finish: lacquered, oiled, waxed, matt, gloss, painted, natural, distressed, brushed",
  "Style: modern, scandinavian, industrial, classic, rustic, minimalist, vintage, retro, boho, contemporary, mid-century",
  "Dimensions: #size",
  "Seats: * people, * places, * persons",
  "Includes: * chairs, * drawers, * shelves, * doors, * pieces",
  "Features: extendable, folding, reclining, with storage, with drawers, adjustable, modular, on castors, sofa bed, stackable, mechanism *",
  "Colour: white, black, grey, anthracite, beige, cream, natural, oak, walnut, wenge, gold, green, blue",
  "Room: living room, bedroom, kitchen, dining room, office, hallway, bathroom, terrace, kids room",
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
      "Seats: * people, * places, * persons",
      "Includes: * chairs, * drawers, * shelves, * doors, * pieces",
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
  supplements: {
    label: "Supplements and health",
    lines: [
      "Form: capsules, tablets, powder, liquid, softgel, gummies, sachets, drops",
      "Active ingredient: contains *, with *, extract of *, standardised to *",
      "Strength: #size, * mg, * mcg, * IU, * billion CFU",
      "Servings: * capsules, * tablets, * servings, * doses, * days",
      "Diet: vegan, vegetarian, gluten free, lactose free, sugar free, non-GMO, halal, kosher",
      "Suited to: adults, children, athletes, pregnancy, seniors",
      "Certification: GMP, ISO, organic, third-party tested, lab tested",
    ],
  },
  telco: {
    label: "Telecom and connectivity",
    lines: [
      "Plan: prepaid, postpaid, monthly, annual, unlimited, family, business",
      "Data: * GB, * TB, unlimited data, data *",
      "Speed: * Mbps, * Gbps, download *, upload *, fibre, DSL, 4G, 5G",
      "Contract: contract *, no contract, * months, * years, cancel anytime",
      "Included: minutes *, SMS *, roaming *, hotspot, router included, installation",
      "Coverage: national, international, EU roaming, coverage *",
    ],
  },
  retail: {
    label: "General retail (mixed catalogue)",
    lines: [
      "Material: cotton, polyester, leather, plastic, metal, steel, aluminium, wood, glass, ceramic, silicone, rubber",
      "Size: #size, * pieces, * pack",
      "Colour: white, black, grey, blue, red, green, yellow, pink, brown, beige, silver, gold, multicolour",
      "Compatibility: compatible with *, fits *, for *",
      "Power: * W, * V, * mAh, battery *, rechargeable, mains powered, USB",
      "Care: machine washable, hand wash, dishwasher safe, wipe clean",
      "Warranty: warranty *, * years, * months",
      "Certification: CE, RoHS, FSC, OEKO-TEX, energy class *",
    ],
  },
  beauty: {
    label: "Beauty and personal care",
    lines: [
      "Skin type: dry, oily, combination, sensitive, normal, mature, acne-prone",
      "Concern: hydration, anti-ageing, brightening, acne, redness, pigmentation, fine lines, sun protection",
      "Key ingredients: contains *, with *, hyaluronic acid, retinol, vitamin C, niacinamide, salicylic acid, ceramides, SPF *",
      "Format: cream, serum, gel, oil, lotion, foam, balm, mask, mist, stick",
      "Volume: #size, * ml, * g",
      "Free from: paraben free, sulphate free, fragrance free, alcohol free, cruelty free, vegan",
      "Finish: matte, dewy, satin, natural, glossy, shimmer",
    ],
  },
  jewelry: {
    label: "Jewellery and accessories",
    lines: [
      "Metal: gold, white gold, rose gold, silver, sterling silver, platinum, stainless steel, titanium, brass, gold plated, vermeil",
      "Purity: 9k, 14k, 18k, 24k, 925, 585",
      "Stone: diamond, sapphire, ruby, emerald, pearl, moissanite, zirconia, opal, amethyst, topaz",
      "Carat: * ct, * carat",
      "Size: #size, * cm, * mm",
      "Closure: clasp *, lobster clasp, spring ring, magnetic, adjustable, screw back, push back",
      "Occasion: engagement, wedding, anniversary, everyday, gift, formal",
    ],
  },
  sports: {
    label: "Sports, fitness and outdoor",
    lines: [
      "Discipline: running, cycling, hiking, gym, yoga, swimming, football, tennis, skiing, climbing",
      "Material: polyester, nylon, merino wool, cotton, elastane, Gore-Tex, ripstop, neoprene, carbon, aluminium",
      "Weight: #size, * kg, * g",
      "Capacity: * litres, * kg load, * persons",
      "Features: waterproof, windproof, breathable, quick dry, UV protection, reflective, insulated, adjustable, foldable",
      "Level: beginner, intermediate, advanced, professional",
      "Season: summer, winter, all season, three season",
    ],
  },
  pets: {
    label: "Pet supplies",
    lines: [
      "Animal: dog, cat, rabbit, bird, fish, hamster, reptile",
      "Life stage: puppy, kitten, adult, senior, all life stages",
      "Size: #size, small breed, medium breed, large breed, * kg",
      "Ingredients: contains *, with *, grain free, single protein, chicken, salmon, beef, lamb, turkey",
      "Diet: hypoallergenic, sensitive stomach, weight control, dental, vet formulated",
      "Format: dry food, wet food, treats, supplement, toy, bed, collar, harness, litter",
      "Weight: * kg, * g, * pieces",
    ],
  },
  baby: {
    label: "Baby and kids",
    lines: [
      "Age: * months, * years, newborn, toddler, preschool, 0-6 months, 6-12 months",
      "Material: organic cotton, cotton, bamboo, muslin, wood, BPA free plastic, silicone, stainless steel",
      "Size: #size, * cm, * kg",
      "Safety: BPA free, phthalate free, non-toxic, EN71 certified, hypoallergenic, rounded edges",
      "Features: machine washable, adjustable, foldable, reversible, dishwasher safe, portable",
      "Use: feeding, sleeping, bathing, travel, play, nursery",
    ],
  },
  footwear: {
    label: "Footwear and shoes",
    lines: [
      "Upper: leather, suede, nubuck, canvas, mesh, synthetic, knit, patent leather",
      "Sole: rubber, EVA, TPU, leather sole, cork, Vibram",
      "Closure: laces, velcro, zip, slip-on, buckle, elastic",
      "Heel height: #size, flat, low heel, mid heel, high heel, platform, wedge",
      "Size range: * EU, * UK, * US",
      "Fit: narrow, regular, wide, true to size, roomy toe box",
      "Use: everyday, running, hiking, formal, office, beach, indoor",
      "Features: waterproof, breathable, orthopaedic, memory foam, arch support, non-slip",
    ],
  },
  toys: {
    label: "Toys, games and hobbies",
    lines: [
      "Age: * years, * months, 3+, 6+, 8+, 12+, adult",
      "Players: * players, single player, * to * players",
      "Material: wood, plastic, plush, cardboard, metal, silicone",
      "Skills: motor skills, problem solving, creativity, memory, language, STEM, coordination",
      "Pieces: * pieces, * cards, * blocks",
      "Playing time: * minutes, * hours",
      "Type: board game, puzzle, building set, plush, figure, craft kit, outdoor toy, educational",
      "Battery: batteries included, batteries not required, rechargeable, * AA",
    ],
  },
  eyewear: {
    label: "Eyewear and sunglasses",
    lines: [
      "Frame material: acetate, metal, titanium, TR90, stainless steel, wood, plastic",
      "Frame shape: round, square, rectangular, aviator, cat eye, oval, wayfarer, oversized",
      "Lens: polarised, UV400, photochromic, blue light filter, anti-reflective, mirrored, gradient, prescription ready",
      "Measurements: #size, * mm lens, * mm bridge, * mm temple",
      "Face fit: narrow, medium, wide, low bridge fit",
      "Gender: unisex, men, women, kids",
      "Included: case, cloth, warranty *",
    ],
  },
  bags: {
    label: "Bags, backpacks and luggage",
    lines: [
      "Material: full grain leather, leather, canvas, nylon, polyester, recycled polyester, polycarbonate, aluminium",
      "Capacity: * litres, * L, fits * laptop",
      "Dimensions: #size",
      "Compartments: * pockets, * compartments, laptop sleeve, water bottle pocket, trolley sleeve",
      "Closure: zip, magnetic, drawstring, buckle, TSA lock, combination lock",
      "Wheels: * wheels, spinner wheels, two wheel, no wheels",
      "Cabin approved: cabin size, carry on, checked luggage",
      "Features: water resistant, RFID blocking, expandable, padded straps, USB port",
    ],
  },
  automotive: {
    label: "Automotive parts and accessories",
    lines: [
      "Fits: compatible with *, fits *, for *, OEM *, universal fit",
      "Part number: OEM *, part number *, reference *",
      "Material: steel, aluminium, cast iron, carbon fibre, ABS plastic, rubber, ceramic",
      "Dimensions: #size",
      "Position: front, rear, left, right, driver side, passenger side, front axle, rear axle",
      "Specification: * V, * Ah, * W, * bar, * Nm, * mm thread",
      "Standard: ECE approved, DOT, E-mark, ISO *, TÜV",
      "Warranty: warranty *, * years, * km",
    ],
  },
  crafts: {
    label: "Art, crafts and handmade",
    lines: [
      "Medium: acrylic, oil, watercolour, gouache, ink, pastel, charcoal, pencil, resin, clay, yarn, fabric",
      "Surface: canvas, paper, wood panel, board, ceramic, glass, linen",
      "Dimensions: #size",
      "Weight: * gsm, * g, * kg",
      "Set contents: * pieces, * colours, * brushes, * sheets",
      "Technique: handmade, hand painted, hand thrown, screen printed, embroidered, woven, carved",
      "Finish: matte, gloss, satin, varnished, unfinished, glazed",
      "Skill level: beginner, intermediate, advanced",
    ],
  },
  books: {
    label: "Books and stationery",
    lines: [
      "Format: hardcover, paperback, spiral bound, ebook, audiobook, boxed set",
      "Pages: * pages, * sheets",
      "Language: English, Romanian, French, German, Spanish, bilingual",
      "Paper: * gsm, recycled paper, acid free, dotted, lined, blank, squared",
      "Dimensions: #size, A4, A5, A6, B5, pocket size",
      "Age group: children, young adult, adult, all ages",
      "Binding: sewn binding, glued, wire-o, leather bound",
      "Includes: index, illustrations, bookmark ribbon, elastic closure, pen loop",
    ],
  },
  watches: {
    label: "Watches and luxury goods",
    lines: [
      "Movement: automatic, manual, quartz, solar, kinetic, mechanical",
      "Case material: stainless steel, titanium, gold, rose gold, ceramic, bronze, carbon",
      "Case size: #size, * mm case, * mm thickness",
      "Crystal: sapphire crystal, mineral glass, acrylic",
      "Strap: leather strap, steel bracelet, rubber strap, NATO strap, mesh, milanese",
      "Water resistance: * ATM, * m, * bar, water resistant",
      "Complications: chronograph, date, GMT, moonphase, power reserve *, tachymeter",
      "Included: box, papers, warranty *, certificate",
    ],
  },
  digital: {
    label: "Digital products and software",
    lines: [
      "Delivery: instant download, email delivery, licence key, cloud access, streaming",
      "Format: PDF, EPUB, MP4, MP3, PSD, AI, SVG, ZIP, Figma, Notion template",
      "File size: #size, * MB, * GB",
      "Licence: personal use, commercial use, extended licence, single seat, * seats, unlimited projects",
      "Compatibility: compatible with *, requires *, Windows, macOS, iOS, Android, web browser",
      "Duration: * hours, * lessons, * modules, lifetime access, * months access",
      "Updates: free updates, * year of updates, version *",
      "Support: email support, community access, * days support",
    ],
  },
  industrial: {
    label: "Industrial supplies and B2B",
    lines: [
      "Material: stainless steel 304, stainless steel 316, carbon steel, aluminium, brass, PVC, PTFE, HDPE, cast iron",
      "Dimensions: #size, * mm, * inch, DN *",
      "Capacity: * kg load, * litres, * m3, * bar, * L per minute",
      "Power: * kW, * W, * V, * A, * Hz, three phase, single phase",
      "Standard: ISO *, DIN *, EN *, ANSI *, CE marked, ATEX",
      "Protection: IP*, corrosion resistant, food grade, explosion proof, flame retardant",
      "Packaging: * per box, * per pallet, bulk, minimum order *",
      "Lead time: in stock, * days lead time, made to order",
    ],
  },
  custom: {
    label: "Start from scratch",
    lines: [
      "# One attribute group per line: Label: term, term, term",
      "# Delete these lines and write the attributes buyers compare in your trade.",
      "Material: ",
      "Size: #size",
      "Colour: ",
    ],
  },
};

export function presetText(key: string): string {
  return PRESETS[key] ? PRESETS[key].lines.join("\n") : "";
}
