Batch 5. Everything still open on this app, in this order, one commit per item, nothing pushed until Marius says so. Same hard rules as the four earlier prompts in _shopify/. Run scripts/queue-unstick.ts before the push. Read _shopify/SPEC-EXTRACTION-QUALITY.md first: items 4 to 7 implement it and it is approved.

Standing rules for this batch: no group, source or capability is switched off or withdrawn; nothing a person wrote is overwritten; every figure carries its denominator; a rule that will run on real data is derived from the corpus, never written from memory; the 1 percent bar is never loosened, and a check is never silenced to make a run go green. If an item cannot meet its bar, stop on that item, report the number, and carry on with the next one. Report progress per item as you go.

## A. Live truth on the merchant's screens

1. themeNodeAdvice in app/services/seo-aggregate.ts (line 818) recommends "switch the app embed to Full mode" whenever the theme emits no Product node, without ever looking at the mode the store is already in. On Republica BIO, which is in Full, the Structured data card shows an Attention badge telling the merchant to do what is already done. Fix it from data the aggregate already holds: theme == 0 with appOnly > 0 proves the app is already emitting the complete node, so the advice becomes "Keep Full mode", the badge is not Attention, and the Diagnostics action (app/routes/app.diagnostics.tsx line 525) stops offering the switch. Tests for every combination: pagesRead 0; theme 0 and appOnly 0; theme 0 and appOnly > 0; theme > 0. Grep every caller of themeNodeAdvice and of the badge, list them with counts.

2. The 3 pages on Republica BIO counted as "none" (neither the theme's Product node nor ours). Read the stored scan rows, list the 3 product handles with exactly what the scan saw, and say which it is: our block not rendering, a template without the embed, a redirect, or a page that is not a product page being counted as one. Fix only if the cause is ours; if it is not, report it and change nothing.

3. Audit every other sentence on the merchant screens the same way, once, without prejudice: for each, does it state what is true of THIS store right now, and is every count shown with its denominator. Report a table of every sentence you changed and every one you left, with the reason. This is a read of all of them, not only the ones I named.

## B. The catalogue pass gets a home of its own

4. A card of its own on the dashboard, outside the checklist, always present: one sentence on what the pass does, when it last ran, what it wrote, and the button. The dry run sits next to it, equally visible. Today "Fill catalogue" exists only inside step 4 of the checklist (app/services/dashboard-steps.ts line 532), so a merchant who finished the checklist cannot find it or watch it.
   - While a pass runs, the card shows live progress from the JobRun row, which already stores progress and total (worker/tasks.ts writes both): "Product 128 of 189", a progress bar, elapsed time, refreshing on its own while the tab is open, with no reload. Use the framework's own revalidation, no new dependency; stop when the tab is hidden or the job ends.
   - On finish: written, skipped because a person wrote them, unchanged, in the merchant's words. On failure: what failed and what to do.
   - The step 4 button stays and triggers the same action. One action, two entry points, never two code paths. Grep every caller and count them.
   - The one-job-at-a-time guard is unchanged; while a pass runs both entry points say so.
   - Tests: idle, running with progress, finished, failed, guard.

## C. Extraction quality, the spec

5. Classify before fixing. From the existing judge verdicts on Republica BIO (dev run 13) and the hold-out stores, group every facts error into classes with counts and denominators. Classes to confirm against the data, not assume: value cut before the words that carry its meaning (allergens, warnings, expiry); a bound or operator dropped (`<`, `>`, "de la", "pana la", "2-3"); a value taken from a neighbouring sentence about something else (diets, storage, packaging); several products' values merged on a multi-item pack; a unit or its subject lost; a negation read as an affirmation. Report the table before writing any rule.

6. One rule per class, derived from the corpus, each with its evidence and its expected effect on error rate AND on coverage. Written against the dev set, measured on the hold-out. Plus:
   - Abstain rather than guess: when a value cannot be delimited with certainty, publish nothing for that attribute on that product. Count every abstention per group and report it.
   - Multi-item packs: detect from the product's own data, never from one merchant's wording; every per-item value in such a pack is not delimitable unless the description ties it to one item.
   - Safety: allergens, warnings and expiry are published in full or not at all. Never a fragment.
   - Human values are never touched, and the abstention path never removes them. Test it.

7. Bar: every group at or below 1 percent errors on the hold-out and on Republica BIO, under the batch 3 facts rubric. A group with too few values to prove it is reported with its denominator and nothing is promised about it; it is not a special case. Report before and after: values per product overall and per group, error rate per group, abstentions per group. Say plainly, with the number: bar met or not met.

## D. The two question sources that are switched off

8. Merchant questions (2.19 percent combined, 2.41 on Republica BIO) are off. Five of the seven errors are the merchant's own garbled heading published verbatim as a question. Fix the class, not the instances: a heading that is not a well formed question in its language produces nothing. Derive the test for "well formed" from the corpus headings, not from memory. Re-judge every merchant Q&A on Republica BIO and on the hold-out. Switch the source on only if the combined rate and the Republica BIO rate are both at or below 1 percent; otherwise leave it off and report the number.

9. Section intents (9.76 percent, and section:safety 9.86) are off. Two error classes are known from the hold-out: a dropped "<" or ">" before a number, which turns an upper bound into a stated value, and a safety heading answered with text from an unrelated section. Fix both classes, re-judge, and switch the source on only at or below 1 percent per store with at least 50 Q&A and on the hold-out total. Otherwise leave it off and report.

10. After 8 and 9, report questions per product on Republica BIO, by source, before and after, and 20 sample Q&A in Romanian.

## E. Verifications still owed on the batch 4 deploy

11. Run the per-row facts migration dry run on Republica BIO, report how many products and rows it touches, then the real run, then the dry run again, which must read 0. Confirm with a count that no human-written value changed.

12. Read the live product page of m31 True Collagen Creamer with the app's own reader (scripts/read-ld-visible.ts) and report: how many Product nodes, whether additionalProperty is present and how many entries, whether transitTimeLabel is gone, whether Organization carries hasShippingService, and whether the shipping conditions show a transit time of 1 to 2 days. Two Product nodes or a Product without a name means the fragment did not merge: stop and report, ship no workaround.

## F. Decisions Marius still owes, do not decide them yourself

13. Print, in the handover, ready for him to approve in one read: the engine phrase table in en and ro side by side; the current refund wording in SUPPORT.md with the conflict it still carries; and the current FAQ cap setting with what it does. No changes to any of the three in this batch.

## G. Close

14. Docs and handover as before: CHANGELOG per item in house style, STATUS.md updated, the spec marked implemented with today's date. Full .\check.bat after every commit, with the test guard. In the handover, one line per item of this prompt: done, with the number, or not done, with the number and the reason. Nothing reported as green without saying what was run and what was not.
