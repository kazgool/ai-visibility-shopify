# Engine output after the content-language batch, 11 September 2026

The "after" for CC-PROMPT-AI-READABILITY-2 item 5, measured against
`engine-before.md` with the same inputs, the same scripts and the same
metrics. Republica BIO is run in Romanian (`--lang ro`), the furniture
fixture in English (`--lang en`).

```
npx tsx scripts/audit-engine-run.ts rb <scratch>/rb/p1.json "F:/AI Visibility SHOPIFY/dictionar-republicabio-curatat.txt" --business rb --lang ro --dump <scratch>/rb/after-rb.json
npx tsx scripts/audit-engine-run.ts furniture "F:/AI Visibility SHOPIFY/globalmobila-shopify-products.csv" --lang en --dump <scratch>/fu/after-fu.json
npx tsx scripts/audit-engine-report.ts report <after dump> 20
npx tsx scripts/audit-engine-report.ts diff <before dump> <after dump> 20
npx tsx scripts/audit-engine-report.ts removed <before dump> <after dump>
```

## What changed, in one paragraph

No summary carries a price any more (187 of 189 did on Republica BIO, 355 of
355 on the furniture fixture), and no product is asked "How much does it
cost?" (189 and 355 before). On Republica BIO the questions now come from the
merchant's own 26-group dictionary: 1,105 generic questions across all 189
products, where before there was not one. Because the order the brief sets is
label-specific, then generic, then business, with a cap of six, the generic
questions fill the six places on 183 products and the three business
questions (delivery, returns, payment) are cut there. That is the one real
loss in this batch, listed with the rest below, and it is a decision for
Marius.

## Republica BIO, after (Romanian)

- Products: 189
- Summaries (non-empty): 189
- Summaries carrying a price sentence: 0 (before: 187)
- Content language passed: ro; business answers passed: yes
- Questions: 1124 in all, 5.95 per product (before: 756, 4.00)

| Questions | Products |
|---|---|
| 4 | 4 |
| 5 | 2 |
| 6 | 183 |

| Template | Questions | Products |
|---|---|---|
| generic | 1105 | 189 |
| delivery | 7 | 7 |
| returns | 6 | 6 |
| payment | 6 | 6 |

The seven products that keep business questions are the ones with too few
facts to fill six places: five eBooks, the gift card, and the bicarbonate.

## Furniture fixture, after (English)

- Products: 355
- Summaries (non-empty): 355
- Summaries carrying a price sentence: 0 (before: 355)
- Content language passed: en; business answers passed: no
- Questions: 676 in all, 1.90 per product (before: 781, 2.20)

| Questions | Products |
|---|---|
| 0 | 16 |
| 1 | 123 |
| 2 | 123 |
| 3 | 65 |
| 4 | 28 |

| Template | Questions | Products |
|---|---|---|
| dimensions | 306 | 306 |
| generic | 250 | 198 |
| material | 118 | 118 |
| room | 2 | 2 |

The 16 products with no question had one before, the price question, and no
fact at all; nothing else was ever asked of them.

## Diff

### Templates, before and after

| Template | Republica BIO before | after | change | Furniture before | after | change |
|---|---|---|---|---|---|---|
| price | 189 | 0 | -189 | 355 | 0 | -355 |
| delivery | 189 | 7 | -182 | 0 | 0 | 0 |
| returns | 189 | 6 | -183 | 0 | 0 | 0 |
| payment | 189 | 6 | -183 | 0 | 0 | 0 |
| dimensions | 0 | 0 | 0 | 306 | 306 | 0 |
| material | 0 | 0 | 0 | 118 | 118 | 0 |
| room | 0 | 0 | 0 | 2 | 2 | 0 |
| generic | 0 | 1105 | +1105 | 0 | 250 | +250 |

Summaries changed: 189 of 189 and 355 of 355 (price sentence gone on all;
on Republica BIO also "Key details:" is now "Detalii principale:").

### Every removed item, read

`removed` lists each question a product had before and has no question of
the same template for after. All of them, grouped by template and answer:

| Catalogue | Template | Count | Answer |
|---|---|---|---|
| Republica BIO | price | 189 | each a bare price ("81.01 RON."); every one of the 189 checked to be nothing but a price |
| Republica BIO | returns | 183 | "Yes, within 14 days." |
| Republica BIO | payment | 183 | "Card bancar (Visa, Mastercard); Apple Pay; Ramburs (plata la livrare); Transfer bancar/ordin de plată în contul Republica BIO." |
| Republica BIO | delivery | 182 | "1-2. Delivery costs 15 RON." |
| Furniture | price | 355 | each a bare price; every one checked |

737 lines for Republica BIO and 355 for the furniture fixture, nothing else.

### True facts that left the generated text

The mechanical check (every fact value a before summary or answer carried,
looked for in every after summary and answer) returned 0 for the furniture
fixture and 3 for Republica BIO. The 3 are false positives, read one by one:
"Certificari: bio" on IMMUNITY TO GO and the two Melora Manuka drops. None of
the three before texts carried that fact; the substring "bio" came from
"Republica BIO" inside the payment answer, which the cap cut. No dictionary
fact is lost.

What did leave the generated text, and where it is still published:

| Fact | Lost from | Products | Still published in |
|---|---|---|---|
| Price | summary and questions | 189 + 355 | the page itself; the Product node's `offers.price` (theme or ours); the mirror front matter `price:` |
| Brand (vendor) | the summary, where it sat inside the price sentence ("Priced at ... from Molecules of Youth") | every product with a vendor | the Product node's `brand`; the mirror front matter `brand:` |
| "currently out of stock" | the summary's price sentence | none in these runs (all read as available) | `offers.availability`; the mirror front matter `availability:` |
| Delivery time and cost | the questions | 182 of 189 | the mirror's Cumpărare table; our Product node's `shippingDetails` in full mode (delivery time only) |
| Return window | the questions | 183 of 189 | the mirror's Cumpărare table; our Product node's `hasMerchantReturnPolicy` in full mode |
| Payment methods | the questions | 183 of 189 | the mirror's Cumpărare table only |

The last three are the cap at work, not the language: the brief puts the
business questions after every generic one and cuts at six. On the visible
content block those three answers are therefore gone for 183 products, and
payment methods are left on the mirror alone. Keeping them needs the order
or the cap changed (for example: reserve places for the business questions),
which is Marius's call; the code does exactly what the brief says.

## Labels, Republica BIO after

Asked: how many products got the generic question for the label. Cut: the
label was eligible and the cap of six was reached first. Skipped: a value is
a dose or an instruction (`isInstructionValue` in extract.ts: DOSE_MARKERS, or
a SERVING_LEADS verb in the first three words).

| Label | Asked | Cut by the cap | Skipped (dose/instruction) |
|---|---|---|---|
| Forma | 168 | 0 | 0 |
| Ingredient principal | 166 | 0 | 0 |
| Ingrediente | 147 | 0 | 0 |
| Gramaj | 136 | 0 | 0 |
| Cantitate pachet | 96 | 0 | 0 |
| Certificari | 96 | 81 | 0 |
| Concentratie | 71 | 0 | 0 |
| Valori nutritionale | 56 | 19 | 0 |
| Nume stiintific | 52 | 39 | 0 |
| Fara | 52 | 113 | 0 |
| Portie de referinta | 28 | 30 | 23 |
| Testare | 12 | 95 | 0 |
| Origine geografica | 8 | 159 | 0 |
| Alergeni | 7 | 47 | 0 |
| Recoltare | 5 | 21 | 0 |
| Pastrare | 2 | 162 | 0 |
| Contine | 2 | 118 | 0 |
| Ambalaj | 1 | 182 | 0 |
| Notificare | 0 | 71 | 0 |
| Excipienti | 0 | 52 | 0 |
| Avertismente de eticheta | 0 | 80 | 0 |
| Procesare | 0 | 48 | 0 |
| Gust si aroma | 0 | 51 | 0 |
| Origine ingredient | 0 | 23 | 0 |
| Utilizare | 0 | 0 | 32 |
| Valabilitate | 0 | 0 | 13 |

Skipped, with examples:

- Utilizare, 32 products: "2 capsule zilnic". A dosage (DOSE_MARKERS
  "zilnic"); the reason the rule exists.
- Portie de referinta, 23 of 81: "vnr, doza zilnica recomandata". Skipped
  because one part is a dose phrase; the other 58 values ("vnr", "per
  portie") are asked or cut.
- Valabilitate, 13 products: "a se consuma de preferinta". Skipped by
  accident, not by intent: "consuma" is a serving lead, so a best-before
  phrase reads as an instruction. Nothing true is lost by it (the phrase
  carries no date), but it is not what the rule is for.

Questions that read badly, for Marius to judge with the phrase table: the
generic template takes the merchant's label as a noun, and two of the 26
labels are not nouns. "Ce fara are X? fara adaosuri." (Fara, 52 products)
and "Ce contine are X?" (Contine, 2 products). "Ce portie de referinta are
X? vnr." (28) answers with an abbreviation. Renaming the group in the
dictionary ("Fara" to "Fara aditivi" or similar) fixes the question with no
code change; the code does not second-guess a label.

## 20 sample Q&A pairs, Republica BIO, after (Romanian)

- **Ce forma are MACA FORTE COMPLETE PROTOCOL, pachet promotional, cura completa pentru 3 luni, BIO, VEGAN?** capsule, pulbere.
- **Ce ingrediente are Mega Pack SANATELE BIO Linte, Orez Negru si Ceapa, ecologic, fara gluten, Pachet Promotional?** faina de linte rosie, pudra de ceapa, ulei de floarea soarelui high.
- **Ce gramaj are Mega Pack Pernute Bio crocante cu crema de ciocolata si alune FARA GLUTEN Republica BIO, Pachet Promotional?** 250 g.
- **Ce concentratie are Fertility Booster, pachet promotional (Maca Extract + m36 Zinc Bisglycinate)?** 400 mg, 25 mg, 1600 mg.
- **Ce ingrediente are ASHWAGANDHA COMPLETE PROTOCOL, pachet promotional, cura completa pentru 3 luni, BIO, RAW, VEGAN, ecologic?** radacina de ashwagandha, radacini de ashwagandha.
- **Ce ingredient principal are IMMUNITY ESSENTIALS, pachet promotional (Miere Manuka Melora 100+, 250g + m36 Zinc Bisglycinate+ m10 Natural Vitamin D3 2000 IU from lanolin), natural, 335.5g?** manuka.
- **Ce forma are CHLORELLA COMPLETE PROTOCOL, pachet promotional, cura completa pentru 100 de zile, BIO, RAW, VEGAN, ecologic?** tablete, pulbere.
- **Ce cantitate pachet are Mega Pack Ulei de canepa cu 500mg CBD HempAID, pachet promotional?** 4 picaturi.
- **Ce gramaj are Silhouette Evening Restore, pudra functionala ecologica, FARA GLUTEN, Republica BIO, 200g?** 40 g, 150 ml.
- **Ce concentratie are m35 Complete Magnesium Formula, 60 capsule, 57 g, Molecules of Youth, natural?** 144 mg, 150 mg, 20 mg, 19,99 mg.
- **Ce nume stiintific are Vegan Protein 70% - Probiotic & Prebiotic Republica BIO, 500g, ecologic, gust cookie?** cannabis sativa, orzya sativa, theobroma cacao, cucurbita moscata.
- **Ce valori nutritionale are Dropsuri miere de Manuka MGO 525+ (UMF 15+) Melora - lamaie si propolis, 12 buc, 48g, naturale?** grasimi totale.
- **Ce forma are Cele mai...PASTE Reteta 3 Orez Porumb Hrisca, fara gluten, ecologic, Republica BIO, 250g?** paste.
- **Ce cantitate pachet are Ulei de canepa cu 1000mg CBD, 500mg CBDA, 500mg CBGA, broad spectrum, HempAID, natural, 10ml?** 4 picaturi.
- **Ce valori nutritionale are Seminte Bio de canepa decorticate FARA GLUTEN Republica BIO, 200g?** proteine vegetale, proteine complete, grasimi sanatoase, fibre contribuie.
- **Ce fara are Miere ecologica poliflora cruda din Flori de Munte, Republica BIO, 700g?** fara adaosuri.
- **Ce nume stiintific are Brain Food, pulbere functionala ecologica, FARA GLUTEN, Republica BIO, 200 g?** lepidium meyenii, theobroma cacao, salvia hispanica, ceratonia siliqua.
- **Ce certificari are Pudra de cacao pura, ecologica, FARA GLUTEN, Republica BIO, 200 g?** bio, ecologica, ecologice, neiradiat.
- **Ce forma are Miere de Manuka Melora, MGO 700+ (UMF 18) Noua Zeelanda, 250 g, naturala?** miere, ceai.
- **Ce gramaj are Miere de Manuka MANUKA LAB, MGO 300+ Noua Zeelanda, 500 g, naturala?** 500 g.

Read as a buyer would: every answer is the dictionary's own extraction, so
each one inherits the dictionary's accuracy. "Ce forma are Miere de Manuka
... ? miere, ceai." and "4 picaturi" as a package quantity are extraction
questions the generic template now makes visible, not new ones.

## 10 sample Q&A pairs, furniture fixture, after (English)

- **What are the dimensions of Set Masa extensibila & 6 Scaune - Beige Circle?** l 80, L 130, h 79 cm, L 170.
- **What colour does Set Canapea & 2 Fotolii - Blue have?** blue.
- **What are the dimensions of Set Canapea & 2 Fotolii - Mustar?** L 130, l 75, h 60 cm, L 65.
- **What are the dimensions of Set Masa extensibila & 6 Scaune - Hearts?** l 80, L 130, h 79 cm, L 170.
- **What are the dimensions of Fotoliu cu roti - Bubble Beige?** inaltime 74.
- **What is Set 2 Scaune Velvet - Turcoaz made of?** velvet.
- **What style does Monaco White - Negru/Nuc have?** modern.
- **What are the dimensions of Masuta Cafea - Amber/Auriu Drept?** 78cm, 48 cm.
- **What is Set Masa Fixa & 6 Scaune - Gri/Gold made of?** metal.
- **What style does Fotoliu Bar - Negru/Negru have?** modern.

## WordPress fixtures

`fixtures.test.ts` calls neither `buildSummary` nor `buildQuestions` and
asserts nothing about the price sentence, so the brief's stop condition did
not arise. Nothing in it changed, and it is green in the full run (81 files,
1,535 tests, with `.env` renamed away).
