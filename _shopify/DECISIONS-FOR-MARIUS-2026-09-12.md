# Three things for Marius to approve

Batch 5 item 13. **Nothing here was changed in this batch.** All three are
printed so they can be read once and decided.

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
