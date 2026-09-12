# Things for Marius to approve

Sections 1 to 3 are batch 5 item 13, unchanged and still waiting. Section 4,
at the end, is batch 6 section D: everything the doubt review found that is a
decision rather than a bug, including the three carried forward from batch 5.
**Nothing in this document was changed in either batch.** It is all printed so
it can be read once and decided.

---

## 1. The engine phrase table, English and Romanian side by side

Every fixed phrase the engine writes into text a shopper or an assistant
reads. Rendered with a sample title, so each row is the sentence as it
appears rather than a template. Reproduce with
`npx tsx scripts/read-phrase-table.ts` (read only, and it takes
`--title "..."` to try another product name).


| Key | English | Romanian |
|---|---|---|
| `isA` | Ulei de cocos 500 ml is a supliment. | Ulei de cocos 500 ml face parte din categoria supliment. |
| `isAProduct` | Ulei de cocos 500 ml is a product. | Ulei de cocos 500 ml este un produs. |
| `keyDetails` | Key details: bio, 500 ml. | Detalii principale: bio, 500 ml. |
| `qMaterial` | What is Ulei de cocos 500 ml made of? | Ce material are Ulei de cocos 500 ml? |
| `qDimensions` | What are the dimensions of Ulei de cocos 500 ml? | Ce dimensiuni are Ulei de cocos 500 ml? |
| `qSeats` | How many people does Ulei de cocos 500 ml seat? | Câte locuri are Ulei de cocos 500 ml? |
| `qIncludes` | What does Ulei de cocos 500 ml include? | Ce include Ulei de cocos 500 ml? |
| `qIncludesOrSeats` | What does Ulei de cocos 500 ml include or seat? | Ce include sau câte locuri are Ulei de cocos 500 ml? |
| `qRoom` | Where is Ulei de cocos 500 ml used? | Unde se folosește Ulei de cocos 500 ml? |
| `qSafety` | What precautions apply to Ulei de cocos 500 ml? | Ce precauții trebuie respectate pentru Ulei de cocos 500 ml? |
| `qUsage` | How do I use Ulei de cocos 500 ml? | Cum se folosește Ulei de cocos 500 ml? |
| `qComposition` | What does Ulei de cocos 500 ml contain? | Ce conține Ulei de cocos 500 ml? |
| `qStorage` | How should Ulei de cocos 500 ml be stored? | Cum se păstrează Ulei de cocos 500 ml? |
| `qCare` | How do I care for Ulei de cocos 500 ml? | Cum se întreține Ulei de cocos 500 ml? |
| `qCompatibility` | What is Ulei de cocos 500 ml compatible with? | Cu ce se poate folosi Ulei de cocos 500 ml? |
| `qSuitability` | Who is Ulei de cocos 500 ml for? | Pentru cine este Ulei de cocos 500 ml? |
| `qBenefits` | What are the benefits of Ulei de cocos 500 ml? | Ce avantaje are Ulei de cocos 500 ml? |
| `qFinish` | What finish does Ulei de cocos 500 ml have? | Ce finisaj are Ulei de cocos 500 ml? |
| `qOptions` | Which options is Ulei de cocos 500 ml available in? | Ce opțiuni sunt disponibile pentru Ulei de cocos 500 ml? |
| `qVendor` | Who makes Ulei de cocos 500 ml? | Cine produce Ulei de cocos 500 ml? |
| `aboutProduct` | Ulei de cocos 500 ml: Ce contine? | Ulei de cocos 500 ml: Ce contine? |
| `qDelivery` | How long does delivery take for Ulei de cocos 500 ml? | În cât timp se livrează Ulei de cocos 500 ml? |
| `aDelivery` | 1-2 zile. Delivery costs 15 RON. | 1-2 zile. Livrarea costă 15 RON. |
| `aDelivery (starting price)` | 1-2 zile. Delivery costs from 15 RON. | 1-2 zile. Livrarea costă de la 15 RON. |
| `qReturns` | Can I return Ulei de cocos 500 ml? | Pot returna Ulei de cocos 500 ml? |
| `aReturns` | Yes, within 14 days. | Da, în termen de 14 zile. |
| `qWarranty` | What warranty does Ulei de cocos 500 ml have? | Ce garanție are Ulei de cocos 500 ml? |
| `months` | 24 months | 24 de luni |
| `qPayment` | How can I pay? | Cum pot plăti? |
| `collectionCount` | Uleiuri has 12 products. | Uleiuri are 12 produse. |
| `collectionDiffer` | They differ by volum si origine. | Diferă prin volum si origine. |
| `andMore` | A, B, C and 4 more | A, B, C și încă 4 |
| `qCollectionCount` | How many products are in Uleiuri? | Câte produse sunt în Uleiuri? |
| `aCollectionCount` | 12 products. | 12 produse. |
| `qCollectionOptions` | What Volum options are there in Uleiuri? | Ce variante de Volum există în Uleiuri? |
| `mirror.attributeHeader` | | Attribute | Value | | | Atribut | Valoare | |
| `mirror.description` | ## Description | ## Descriere |
| `mirror.questions` | ## Questions | ## Întrebări |
| `mirror.whoItSuits` | ## Who it suits | ## Pentru cine este |
| `mirror.buyingIt` | ## Buying it | ## Cumpărare |
| `mirror.partOf` | ## Part of | ## Face parte din |
| `mirror.store` | ## Store | ## Magazin |
| `mirror.source` | Source: https://shop.example/products/x | Sursă: https://shop.example/products/x |
| `mirror.delivery` | Delivery | Livrare |
| `mirror.deliveryVaries` | Varies by product, stated on each product page | Diferă de la un produs la altul, este indicată pe pagina fiecărui produs |
| `mirror.deliveryCost` | Delivery cost | Cost livrare |
| `mirror.from` | From 15 RON | De la 15 RON |
| `mirror.returns` | Returns | Retur |
| `mirror.days` | 14 days | 14 zile |
| `mirror.warranty` | Warranty | Garanție |
| `mirror.payment` | Payment | Plată |

Two rows worth a second look:

- `isA`: English says "X is a supliment." and Romanian says "X face parte din
  categoria supliment." They are not translations of each other. The Romanian
  avoids gender agreement with the product type, which is why it is phrased
  that way, but it reads as a different claim.
- `aboutProduct`: identical in both languages ("Title: question"), because it
  wraps the merchant's own question and adds no words. That is deliberate.

---

## 2. The refund wording in SUPPORT.md, and the conflict it still carries

As it stands today, `_shopify/SUPPORT.md` line 71:

> **Can I get a refund?**
> Billing runs through Shopify. Write to us at hello@mrdigital.ro and we will
> answer within one working day.

**The conflict.** That answer states no policy, which was the point when it
was rewritten on 11 September: the previous wording stated a policy nobody
had decided. But six lines below it, the same document says:

> No phone or live chat support, and no custom development. This keeps the
> price at $99/year.

and BILLING-SPEC and CLAUDE.md both carry two prices, not one: **$99/year up
to 20,000 products and $149/year above**. A merchant on the larger plan reads
a support page that names a price they are not paying, in the same paragraph
that explains what their money buys.

So there are two decisions, not one:

a. Does the refund answer stay as it is - no policy, answer by email - or does
   it state one?
b. Does "$99/year" in the paragraph below become "$99 or $149/year depending
   on catalogue size", or is the price dropped from that sentence entirely?

---

## 3. The FAQ cap, and what it does

| | Value | Where |
|---|---|---|
| Default | **8** questions per product | `DEFAULT_FAQ_CAP`, app/engine/faq.ts:192 |
| Maximum a merchant may type | **20** | `MAX_FAQ_CAP`, app/services/faq-settings.ts:17 |
| Minimum | 1 | `validateCap`, app/services/faq-settings.ts |
| Where the merchant sets it | Dictionary screen, "Buyer questions" | |
| What happens to a bad value | falls back to 8 silently (`parseCap`) | |

**What it does.** `buildFaq` builds every question from every enabled source,
orders them, and then keeps the first `cap`. Anything past the cap is dropped.
It is a cap on what is PUBLISHED, not on what is built.

**Why it matters right now.** On Republica BIO the cap is doing something the
merchant did not ask for. Business questions rose from 445 to 565 when the
merchant and section sources were switched off, because they filled the room
the other sources would have taken (item 10). So the cap is currently the
mechanism by which this store publishes its shipping policy 189 times instead
of answering anything about a product. Raising or lowering it changes nothing
about that while the other two sources are off.

No change is proposed. The decision, if there is one, is whether the cap
should apply per source rather than to the merged list.

---

# 4. Batch 6, section D: the open decisions in one place

Nine of them. Three were already open, four are new from the doubt review, and
two are carried from batch 5's own list. Each says what is decided, what the
numbers are, and what I would do - the last is a reading, not a recommendation
you owe anything to.

## 4.1 Fixture C, and the merged-dimensions rule (carried, unchanged)

Amend WordPress fixture C so rule 3 can be switched on, or drop rule 3. The
rule is implemented, tested and off. The fixture asserts we publish a table
and its chairs merged into one Dimensions value, which is the defect the rule
stops; 309 errors of 4,091 carry that class. The rule cannot be narrowed to
spare the fixture without being narrowed to spare the errors. One line either
way: amend the fixture and document the port as deliberately diverging, or
delete the rule and its tests.

## 4.2 The abstention setting, 0 to 3 (carried, and now settled on numbers)

Batch 6 re-ran the whole sweep on the corrected engine, because items 1 and 2
touched groups inside the table. **Every figure is identical to the value.**

| Setting | Hold-out errors | Republica BIO errors | RB values per product |
|---|---|---|---|
| baseline (before item 6) | 49.0% (1067/2177) | 31.0% (795/2564) | 13.57 |
| 0 - what runs today | 42.4% (813/1918) | 29.5% (719/2438) | 13.48 |
| 1 | 40.9% (753/1839) | 28.8% (658/2285) | 13.17 |
| 2 | 39.2% (700/1786) | 28.8% (657/2284) | 13.16 |
| 3 | 38.8% (688/1772) | 30.1% (598/1990) | 11.12 |

My reading is unchanged: take none of them. Setting 1 buys 1.5 points on the
hold-out and costs 1.04 correct values per error removed. Setting 3 makes
Republica BIO worse on both counts at once - the error rate goes UP to 30.1%
while the store loses 2.36 values per product. Nothing is waiting on a
re-measurement any more.

## 4.3 What the 1 percent bar is for (carried, unchanged)

The bar is 1% per group and no mechanical setting reaches it: the best is
38.8% on the hold-out. Meanwhile the source that does meet the bar publishes
Republica BIO's shipping policy 189 times, and the two sources that would
answer questions about the products are the ones the bar holds back. A bar
that admits only the answer nobody asked for is measuring something other than
usefulness. This one is yours and nothing else moves until it is settled.

## 4.4 NEW. Should ourProductNode come from the aggregate scan?

Today one arbitrarily chosen page decides it, and batch 6 pinned which page
that is (`sortKey: ID`) without defending the design. On Republica BIO the
chosen page is `card-cadou-republica-bio`, it was broken, and the whole
catalogue lost `additionalProperty` for it. The app already holds better
evidence: the nightly page scan reads 182 pages and found our node on 179.

The single-page signal has no reconciliation against the aggregate and no
alert when the two disagree. Batch 6 adds the one thing that makes the failure
legible - the scan now says when our own block broke the page it read - but
that is a message, not a fix for where the number comes from.

My reading: source it from the aggregate when the aggregate has run, keep the
single page as the fallback for a store scanned for the first time, and raise
a finding when they disagree. That is a wave, not a patch, and it is not
started.

## 4.5 NEW. Should a re-scan trigger itself?

It depends on a manual click on the SEO screen. There is no reminder, no
staleness check on the metafield, and nothing that notices the value is older
than the deploy that invalidated it. The obvious candidates are a re-scan on
`shopify app deploy` and a re-scan off the nightly cron; a theme publish
already triggers one (`webhooks.themes.publish.tsx`), which is a precedent for
the mechanism, not for the schedule.

## 4.6 NEW. Should the block print a version marker?

Batch 6 item 7 asked for a staleness guard and found no general signal exists:
the page carries no version of ours and the headers carry nothing usable. The
only way to get one is for the block to print its own build or version into an
HTML comment, so any scan can compare what it fetched against what is
currently released. It is a few lines in the extension and one comparison in
the scan. It is also a new mechanism on a page that ships zero JavaScript and
is measured for performance impact, so it is yours, and nothing was invented
in its place.

## 4.7 NEW. Allergens, and whether the general rubric is enough

Rule 6 deliberately allows "contine gluten si lactoza" truncated to "contine
gluten", because the rubric names a true but partial statement as not an
error. On a food and supplement client that is a shopper allergic to milk
reading a statement that is true, incomplete, and indistinguishable from
complete. The rubric is right in general and this is the case where being
right in general is not obviously enough.

What a stricter bar would mean, concretely: under a safety label, publish only
when the merchant's statement reaches the end of its own clause, dropping the
partial ones rather than trusting them. It would cost coverage on exactly the
labels where coverage is least valuable and a wrong answer is most expensive.
I did not change it, because it is a product judgement about liability and not
a defect.

## 4.8 The five symbolic bounds that can never fire

`<`, `>`, the two inequality signs and `~` are listed as bounds in
`app/engine/delimit.ts` and none of them can ever match, because `normalize()`
strips every symbol before the pattern runs. So "greutate < 2 kg" publishes
"2 kg" today, which is the exact class rule 1 exists to stop, and the rule
silently does not cover it.

Making them fire is a small change and an unmeasured one: it would add values
across the corpus that no judge has seen. It is listed rather than shipped
because batch 6's standing rule is that a rule running on real data is derived
from the corpus, not written from memory.

## 4.9 Rule 4 reaches nothing, and rule 3 is off

Two of the six mechanical rules do no work on the corpus as wired. Rule 3 is
switched off pending 4.1. Rule 4's prefix-capture half is reached by zero
captures in 5,998 products, because two earlier guards take them first (batch 6
item 2 has the counts). Rule 4's other half, `atMostOneBareMeasurement`, does
fire and is unaffected.

Nothing is broken by this and nothing needs doing today. It is written down
because batch 5's own account credits rule 4 with removing errors at a call
site that never runs, and the next person to read that number should not trust
it.
