# Engine output before the content-language batch, 11 September 2026

The "before" for CC-PROMPT-AI-READABILITY-2 item 5. Engine at a3fe573.

How it was run (from `F:\ai-visibility-shopify`):

```
npx tsx scripts/audit-engine-run.ts rb <scratch>/rb/p1.json "F:/AI Visibility SHOPIFY/dictionar-republicabio-curatat.txt" --business rb --lang en --dump <scratch>/rb/before-rb.json
npx tsx scripts/audit-engine-run.ts furniture "F:/AI Visibility SHOPIFY/globalmobila-shopify-products.csv" --lang en --dump <scratch>/fu/before-fu.json
npx tsx scripts/audit-engine-report.ts report <dump> 10
```

Inputs:

- Republica BIO: `https://republicabio.ro/products.json?limit=250`, read
  11 September 2026, 189 products; price is the first variant's; dictionary
  `dictionar-republicabio-curatat.txt` (26 groups). Business answers are the
  ones the live FAQPage on the Ashwagandha page carried the same day:
  delivery "1-2", cost 15 RON, returns 14 days, the four payment methods, no
  warranty. The old sandbox paths in the script (`/tmp/rb/p1.json`) no longer
  exist; the script now takes the paths as arguments.
- Furniture: `globalmobila-shopify-products.csv`, 355 products, built-in
  dictionary, no business answers.
- Facts come from `extractProduct` directly; the variant split the live pass
  applies is not reproduced (the storefront JSON has no selectedOptions).

What this confirms from the brief:

- Every Republica BIO product gets exactly four questions, and they are the
  same four commerce templates on all 189: price, delivery, returns, payment.
  No question is built from the 26-group dictionary's own facts, because
  `buildQuestions` only knows material, dimensions, seats, includes,
  capacity and room.
- Every summary is English template text around the merchant's first
  sentence ("Key details: ...", "Priced at 81.01 RON from Republica BIO.").
  187 of 189 carry the whole price sentence. The other two carry it cut: the
  80-word cap stops one at "Priced at..." and the other before the sentence
  starts. Both are the long "pachet promotional" descriptions.
- The live page agrees: the Ashwagandha FAQPage on 11 September answered
  "How much does ... cost?" with "81.01 RON.", while the brief records
  98.80 lei on the page the same day.

## Republica BIO

- Products: 189
- Summaries (non-empty): 189
- Summaries carrying a price sentence: 187
- Content language passed: en; business answers passed: yes
- Questions: 756 in all, 4.00 per product

Questions per product:

| Questions | Products |
|---|---|
| 4 | 189 |

Templates fired:

| Template | Questions | Products |
|---|---|---|
| price | 189 | 189 |
| delivery | 189 | 189 |
| returns | 189 | 189 |
| payment | 189 | 189 |

10 sample Q&A pairs:

- **How much does MACA FORTE COMPLETE PROTOCOL, pachet promotional, cura completa pentru 3 luni, BIO, VEGAN cost?** 212.31 RON.
- **How long does delivery take for Mega Pack Pernute Bio crocante cu crema de ciocolata si alune FARA GLUTEN Republica BIO, Pachet Promotional?** 1-2. Delivery costs 15 RON.
- **Can I return ASHWAGANDHA COMPLETE PROTOCOL, pachet promotional, cura completa pentru 3 luni, BIO, RAW, VEGAN, ecologic?** Yes, within 14 days.
- **How can I pay?** Card bancar (Visa, Mastercard); Apple Pay; Ramburs (plata la livrare); Transfer bancar/ordin de plată în contul Republica BIO.
- **How much does Silhouette Evening Restore, pudra functionala ecologica, FARA GLUTEN, Republica BIO, 200g cost?** 69.00 RON.
- **How long does delivery take for Vegan Protein 70% - Probiotic & Prebiotic Republica BIO, 500g, ecologic, gust cookie?** 1-2. Delivery costs 15 RON.
- **Can I return Cele mai...PASTE Reteta 3 Orez Porumb Hrisca, fara gluten, ecologic, Republica BIO, 250g?** Yes, within 14 days.
- **How much does Seminte Bio de canepa decorticate FARA GLUTEN Republica BIO, 200g cost?** 34.50 RON.
- **How much does Brain Food, pulbere functionala ecologica, FARA GLUTEN, Republica BIO, 200 g cost?** 49.27 RON.
- **How long does delivery take for Miere de Manuka Melora, MGO 700+ (UMF 18) Noua Zeelanda, 250 g, naturala?** 1-2. Delivery costs 15 RON.

## Furniture fixture

- Products: 355
- Summaries (non-empty): 355
- Summaries carrying a price sentence: 355
- Content language passed: en; business answers passed: no
- Questions: 781 in all, 2.20 per product

Questions per product:

| Questions | Products |
|---|---|
| 1 | 45 |
| 2 | 195 |
| 3 | 114 |
| 4 | 1 |

Templates fired:

| Template | Questions | Products |
|---|---|---|
| price | 355 | 355 |
| dimensions | 306 | 306 |
| material | 118 | 118 |
| room | 2 | 2 |

10 sample Q&A pairs:

- **What are the dimensions of Set Masa extensibila & 6 Scaune - Beige Circle?** l 80, L 130, h 79 cm, L 170.
- **How much does Set Canapea & 2 Fotolii - Black cost?** 1450 RON.
- **What are the dimensions of Set Canapea Extensibila cu Lada si 2 fotolii - Aqua?** 190 x 110 cm, lungime 225 cm, inaltime 93 cm.
- **How much does Set Masa extensibila & 6 Scaune - Brown Poppy cost?** 1050 RON.
- **What are the dimensions of Fotoliu cu roti - Classic Verde Satin?** inaltime 74.
- **How much does Set 2 Scaune Velvet - Turcoaz cost?** 599 RON.
- **What is Monaco Gold - Alb/Alb made of?** MDF.
- **What are the dimensions of Masuta Cafea - Piatra Neagra/Auriu Vortex?** 78cm, 48 cm.
- **How much does Set Masa Fixa & 6 Scaune - Negru/Gold cost?** 2199 RON.
- **How much does Fotoliu Bar - Gri/Negru cost?** 499 RON.
