# Spec: attribute extraction quality (batch 5)

Status: draft for Marius to approve. Nothing is implemented until he does.

## Objective

The attributes this app extracts from product descriptions are wrong too often to publish. Measured by the batch 3 judge on Republica BIO (189 products, dev run 13): 22 of 25 groups above 1 percent, several far above, for example Valabilitate 13/13, Portie de referinta 79/81, Alergeni 39/54, Forma 105/168. The same values are already visible on live product pages and, after batch 4, are published as additionalProperty in the Product node. A wrong allergen line on a food shop is the worst case and it exists today.

Success is one number: every attribute group at or below 1 percent errors, on the hold-out stores and on Republica BIO, judged by the batch 3 facts rubric (rules 2 and 3: a value not present in the product's own data, or cut so its meaning changes or is lost).

Decided by Marius, 12 September 2026:
- Precision over coverage. Fewer attributes that are true beats more that are wrong. The merchant will add extras by hand; per-row protection from batch 4 keeps those safe.
- No group is switched off and no capability already delivered is withdrawn. Every group stays enabled on the page and in the markup.
- The merchant's dictionary is his. We do not rewrite his labels or his terms.

## Tech stack

Existing: TypeScript, the pure engine under app/engine (extract.ts and its dictionary matching), Vitest, the corpus and judge harness under _shopify/corpus. No new runtime dependency. No AI model call at runtime: extraction stays deterministic. Subagent judging stays a measurement tool only.

## Commands

```
Full check:       .\check.bat
Tests only:       npm test
Engine measure:   npx tsx scripts/audit-engine-run.ts
Facts judge:      the batch 3 judge harness, dev and hold-out, as used for run 13
```

## Project structure

```
app/engine/extract.ts      -> matching and value delimitation (the work happens here)
app/engine/__tests__/      -> unit tests, one per error class
_shopify/corpus/           -> stores, dev and hold-out split, rubrics, judge results
_shopify/audit-logs-*/     -> before and after measurements
```

## Code style

Rules are data, derived from the corpus, not written from memory. One example of the shape expected:

```ts
/**
 * A value that starts inside a negation or a comparison keeps the operator or
 * is not published at all. "poate contine urme de soia" cut at "urme" states
 * the opposite of the label; "<5%" cut to "5%" turns an upper bound into a
 * fact. Corpus counts for both classes in _shopify/corpus/facts-judge-dev.md.
 */
```

## The work

1. Classify before fixing. From the existing judge verdicts on Republica BIO and the hold-out stores, group every error into classes with counts and denominators. The classes visible today, to be confirmed against the data, not assumed: value cut before the words that carry its meaning (allergens, warnings, expiry); a bound or operator dropped (`<`, `>`, `de la`, `pana la`, `2-3`); a value taken from a neighbouring sentence about something else (diets, storage, packaging); several products' values merged on a multi-item pack; a unit or its subject lost (which figure belongs to which substance); a negation read as an affirmation. Report the table before writing a rule.

2. One rule per class, derived from the corpus. Each rule states the class, the corpus evidence, and the expected effect on both error rate and coverage. Rules are written against the dev set and measured on the hold-out.

3. Abstain rather than guess. When a value cannot be delimited with certainty, the app publishes nothing for that attribute on that product. Abstention is not an error under the rubric; a published wrong value is. Every abstention is counted and reported per group, so the cost is visible.

4. Multi-item packs. A pack listing several products is where merged and swapped values come from. Detect it from the product's own data, never from one merchant's wording, and treat every per-item value in it as not delimitable unless the description ties it to one item.

5. Safety first, as a rule not a hope. Allergens, warnings and expiry are never published from a cut fragment. Either the full statement or nothing.

6. Nothing human is touched. Values marked as written by a person are never changed, and the abstention path never removes them. Test it on a fixture.

## Testing strategy

Vitest, one test per error class, named for the class, using real strings from the corpus as fixtures. Test code DAMP. Plus the judge run: dev set for iteration, hold-out for the verdict. The bar applies per group on the hold-out total and to every group with at least 30 values. The full .\check.bat after each commit, with the test guard fixed.

## Boundaries

- Always: derive rules from the corpus with counts; report coverage lost alongside error rate; keep the engine pure and deterministic; measure before and after on the same data.
- Ask first: any change to what a merchant sees on his screens; any change to the dictionary format; anything that would make an existing stored value disappear on a store other than by the abstention rule.
- Never: switch a group off; rewrite the merchant's dictionary labels or terms; overwrite a human-written value; loosen the 1 percent bar or judge a rule by the dev set alone; call an AI model at runtime.

## Success criteria

1. Every group at or below 1 percent errors on the hold-out, and on Republica BIO, under the batch 3 facts rubric.
2. Zero published values in the safety classes (allergens, warnings, expiry) that are cut fragments, verified by reading every published value in those groups on Republica BIO.
3. Coverage reported honestly: values per product before and after, per group, with the abstention count. Expected to fall from 13.3; the number is measured, not promised.
4. No human-written value changed, proven by a test and by a count on Republica BIO.
5. .\check.bat green, with the test guard in place.

## Second module: the catalogue pass has a home of its own (decided by Marius)

Separate from extraction, same batch, its own commits. Today "Fill catalogue" exists only as a button inside step 4 of the dashboard checklist, so a merchant who has finished the checklist has no obvious way to run it again, and no way to watch it run.

- A card of its own on the dashboard, outside the checklist and always present: what the pass does in one sentence, when it last ran, what it wrote, and the button.
- While a pass is running, the card shows live progress from the JobRun record, which already stores progress and total (worker/tasks.ts writes both, heartbeat from batch 2 item 3): "Product 128 of 189", a progress bar, and the elapsed time. It refreshes on its own while the tab is open, without the merchant reloading.
- When it finishes, the card states the result in the merchant's words: written, skipped because a person wrote them, unchanged. Failure says what failed and what to do.
- The button inside step 4 stays and points at the same action, so the checklist is not broken; one action, two entry points, never two code paths.
- The one-job-at-a-time guard is unchanged: while a pass runs the button says so instead of queueing a second.
- Same treatment for the dry run, which stays next to it, not hidden.

## Open questions

1. Resolved by Marius, 12 September 2026: a group with too few values to prove the bar is not a special case. Too few values means too few attributes, and that is the merchant's description to improve. The group is reported with its denominator, judged on the combined set, and nothing is promised about it.
2. Stored values on the live store: after the rules change, the next pass rewrites auto values and removes the ones that now abstain. On Republica BIO that means attributes disappearing from pages the client has seen. Marius decides whether that pass runs immediately after deploy or after he has told the client.
