# Process audit: were our own rules followed?

3 September 2026. Scope narrowed on instruction to **work produced by this
assistant**, 1-3 September 2026, in `F:\ai-visibility-shopify` and the
Republica BIO deliverables under `F:\AI Visibility SHOPIFY\republicabio`.
`F:\AI Visibility\server` and the WordPress plugin are out of scope: no work
in this period came from here.

This audits HOW the work was done, not whether the product works.

## How this was produced, and its central limitation

Shell access (`mcp__workspace__bash`) was denied for the whole session, for
this model and for every subagent. So `git log`, `git checkout`, `check.bat`,
the suite with `.env` renamed away, and `scripts/audit-engine-run.ts` could
not be run. Every verdict below rests on file contents read directly, or is
marked UNVERIFIABLE with the command that would settle it.

That limitation is itself the finding this audit exists to examine, so it is
stated first rather than buried: **an audit written to check whether claims
were run, could not itself run anything.** Section 5 does not pretend
otherwise.

What was done: both `CLAUDE.md` files and the `_shopify` specs were read in
full and every imperative statement enumerated; two subagents were given the
grep and enumeration work; three of their load-bearing claims were re-checked
against the source by hand before being accepted (noted inline).

---

## 1. The rule checklist, with verdicts

### A. Hard rules (code)

**1. Nothing a human wrote is ever overwritten.** HELD.
`mayWrite` at `app/services/facts.server.ts:96-105`; the same shape
re-implemented for collections (`collections.server.ts:150-156`) and SEO
(`seo.server.ts:48-57`). Call sites at `facts.server.ts:237` and `:340-342`,
`collections.server.ts:256`, `seo.server.ts:166`. Alt text uses a separate
mechanism (`looksLikeMachineAlt`, `alt-text.server.ts:66`) because alt text
lives on shared media, documented in that file's header.

**2. Merchant data lives in Shopify metafields.** HELD, by inspection of the
writers above. Not independently verified against a live shop.

**3. GraphQL Admin API only; CI greps for it.** HELD.
The only Admin endpoint is `app/services/admin.server.ts:40`
(`/admin/api/${API_VERSION}/graphql.json`). No `.rest(` or `admin.rest`
anywhere. The other `fetch(` calls are non-Admin: bulk result download
(`catalogue.server.ts:290`), storefront and robots.txt reads
(`crawler-check.server.ts:77`, `theme-scan.server.ts:279,315,341`), IndexNow
(`indexnow.server.ts:70`).
**Checked by hand.** The CI grep the rule claims exists does exist, at
`.github/workflows/deploy.yml:15`. One correction to CLAUDE.md's wording: it
lives in the deploy guard, not in the test workflow. The distinction matters
because the guard runs only on push to main.

**4. The storefront block ships zero JavaScript.** HELD.
Three Liquid files under `extensions/`. All eleven `<script>` tags are
`type="application/ld+json"`, which is inert data. No `on*` attributes, no
`fetch`, no `javascript:` URLs. `extensions/product-panel/src/ProductPanel.jsx`
is an admin `ui_extension` and out of scope for this rule.

**5. Never a second complete Product node; `['$app']` not `.app.`.** HELD.
Zero literal `.app.` accessors in `extensions/`. Two `"@type": "Product"`
emissions in `ai-visibility.liquid` (`:156` full mode, `:244` extend mode) sit
in mutually exclusive Liquid branches, so only one renders.

**6. The engine stays pure.** HELD.
`app/engine/` greps clean for `@shopify`, `prisma`, `db.server`, `fetch(`,
`fs`, `process.env`. Every import is relative within the engine, or `vitest`.

**7. Never write an identical value.** HELD in all four writers.
`facts.server.ts:264-267` and `:345`; `alt-text.server.ts:90`;
`seo.server.ts:173-176`; `collections.server.ts:265-269`.

**8. The three WordPress fixtures are a contract.** HELD.
`fixtures.test.ts` carries exactly three, and they were compared line for
line against `F:\AI Visibility\tests\smoke-test.php`: `:31-35` against
`smoke-test.php:706-711`, `:68` against `:867`, `:94-100` against `:896-903`.
Identical, diacritics included. No edit markers.
Whether they *pass* is UNVERIFIABLE without a run.

**9. Plain characters only in every text the app shows or writes.** HELD.
Every hit for em dash, en dash, curly quotes, ellipsis and HTML entities is
exempt: the `NAMED_ENTITIES` decode table inside `cleanOutput` itself
(`normalize.ts:21-22,49-53`), `{% comment %}` blocks, `//` comments, or test
fixtures that carry dirty input by design. Zero violations in a string that
reaches a merchant.
One open item, not a violation: `app/services/business.server.ts` writes
`BusinessInfo` JSON without importing `cleanOutput` and without a traceable
upstream cleaner. Every other writer delegates to an engine module that
imports it. Worth deciding whether the business-info form can carry pasted
entities.

**10. Entitlement gates on every write path.** HELD, and the class is now
closed. Twenty-six write paths were enumerated (table in section 2). Every
paid-write path has a live check. The five with no check are deliberate:
crawler check and diagnostics are free by `FREE-TIER-SPEC` section 2,
withdrawal is never gated, `prune_crawler_hits` deletes our own retention
data, and the billing routes *are* the entitlement mechanism.
**Checked by hand.** `app/routes/app.business.tsx:51` now calls
`hasPaidAccess`. That was one of the two gaps named in `AUDIT-2026-09-02.md`
section 1.2. It is fixed; `app.dictionary.tsx:70` is the other, also fixed.

**11. No trial, no coupons; the free tier is not extended.** HELD by
inspection: one free quantity, no second, no discount path in the routes.

**12. Secrets never enter the repo.** UNVERIFIABLE without
`git log -p -S` over the history. `.env` is gitignored; that is all that was
checked.

### B. Workflow rules

**13. Nothing is handed over that has not been run, and the handover carries
the last lines of the run.** BROKEN, three times in three days.
- Wave A of the 1.7.8 port was written and handed over having never been
  executed, because shell access was lost mid-session. `STATUS.md:29-32` now
  records this. It is still uncommitted and still unrun.
- The `CatalogueRead` change was handed over with two TypeScript errors in
  it. `check.bat` would have caught both.
- The CHANGELOG entry for the engine wave described behaviour nobody had
  observed.
This rule was *written* on 2 September in response to the first two. It was
broken again on 3 September, by me, in the same repository.

**14. A change to an exported type is not made until every construction site
is listed.** BROKEN, once, by me, on 3 September.
`objectsMatch` was added as a required field to `CatalogueRead` in
`app/services/catalogue.server.ts`. Two test files construct that type as a
literal and were not updated: `mirror-reconcile.test.ts` (the `read()` helper
and the `short` literal at `:144`) and `catalogue-read.test.ts:124`.
A single grep for the type name returns 7 hits and would have found both.
Cost: one failed `check.bat` run for Marius, one correction round.

**15. Green locally is not green; run the suite with `.env` renamed away.**
BROKEN once (2 September, the red CI at 15:01: `extract.server.test.ts`
imported through `admin.server.ts`, which calls `shopifyApp()` at import time
and throws where there is no `.env`). Fixed by moving
`hasWithdrawableAutoValues` into `facts.server.ts`.
Current state UNVERIFIABLE: the check cannot be repeated in this session.

**16. A wave that fixes a class closes the class.** HELD as of today, after
four passes. Entitlement gates took four separate passes across 1-2
September because each fixed the instances in front of it. The enumeration
in section 2 is the first complete one, and it comes clean. The rule was
written after the fourth pass, not before the first.

**17. A specification that describes what existing code computes runs that
code first.** BROKEN, at least once with traceable cost.
`scripts/audit-engine-run.ts` was not run before the Report screen
specification was written. The consequence recorded in CLAUDE.md: a false
method line reached a merchant-facing screen, and a duplicate of an existing
figure was threaded through six files.

**18. A cheap read that would settle a specification question is run before
the specification is written.** BROKEN, and still broken at the time of
writing.
`scripts/read-forwarding.ts` is read-only, prints no addresses, and has been
available since 22 August. `PRD-PORT-1.7.8.md` is 1,953 lines and declares
four features blocked on its answer. Twelve days, one command, never run.
This is the single clearest instance in the period.

**19. An acceptance criterion that is not met is a failed wave until the PRD
is amended.** UNVERIFIABLE. Settling it needs the delivery notes checked
against each PRD's acceptance section commit by commit, which needs git.

**20. A decision recorded in the CHANGELOG binds the next audit.** BROKEN,
once. An audit contradicted a CHANGELOG decision without quoting it; the
cost recorded in CLAUDE.md is one decision, one contradicting audit, one fix
and one correction in a third document, for a two-line change.
Separately and by me: the CHANGELOG sentence describing what `complete`
compares was left wrong after the code changed, and corrected only when the
same edit's typecheck errors surfaced.

**21. `check.bat` before declaring anything done.** BROKEN; see 13 and 14.

**22. `check.bat` passing is not the feature working; account for the second
render.** UNVERIFIABLE for the Report screen. It has not been opened in a
browser since deploy. The specific unpressed things: CSV export inside the
embedded iframe, the crawler card after an action, the before/after
highlights.

**23. Keep the CHANGELOG current with every change.** HELD in volume, BROKEN
in accuracy. Every wave has an entry. One entry described unobserved
behaviour (13) and one described superseded arithmetic (20).

**24. Every delivery ends with `npx shopify app deploy` and a tag.** BROKEN,
once, and caught by Marius rather than by me: the rule was dropped from a
delivery and he had to ask for it ("dar veau eu nxp sa avem versiune
curenta, ai uitta?").

**25. Every command block starts with `cd F:\ai-visibility-shopify`.**
HELD in this period, as far as the transcript shows. The rule itself was
written on 1 September after a failure of exactly this kind.

**26. `STATUS.md` is the read-first document.** BROKEN for a month.
It was last updated 3 August and described production day. Every session
since was instructed by `CLAUDE.md:9` to read it first. It was brought
current on 3 September, in this session. A month of decisions, including the
free tier and the SEO workspace, were invisible to any session that obeyed
the read order.

### C. Client-facing voice rules (Republica BIO deliverables)

**27. Never volunteer the exit clause or the duplicate-node defence.**
BROKEN once, on 1 September, in a Republica BIO mockup footer. Both appeared
unprompted. The rule was written into `F:\AI Visibility\CLAUDE.md` as a
result. No instance survives in the current deliverables.

**28. No em dashes, curly quotes, entities in client material.** HELD. The
Republica BIO PDF, dictionary and email were grepped clean.

**29. "Nu mai folosi termeni de masini."** HELD after correction; one
instance existed and was fixed the same day.

---

## 2. The broken-rule table

| # | Rule | Times | Worst instance | Traceable cost |
|---|---|---|---|---|
| 13 | Handover without a run | 3 | Wave A handed over never executed | still uncommitted, unverified |
| 14 | Type widened without listing call sites | 1 | `objectsMatch` on `CatalogueRead` | Marius's `check.bat` failed; one correction round |
| 15 | Suite not run without `.env` | 1 | red CI 2 Sept 15:01 | one CI failure, one refactor |
| 17 | Spec written without running the code | 1 | Report screen method line | false line on a merchant screen; duplicate figure in six files |
| 18 | Cheap read deferred into the spec | 1, ongoing | `read-forwarding.ts`, 12 days | four features declared blocked in a 1,953-line PRD |
| 20 | CHANGELOG decision ignored / left stale | 2 | audit contradicting a decision | one fix plus a correction in a third document |
| 24 | Deploy and tag dropped from a delivery | 1 | caught by Marius | one round trip |
| 26 | Read-first document stale | 1, for 30 days | `STATUS.md` | every session since 3 Aug read a false starting state |
| 27 | Exit clause volunteered | 1 | Republica BIO mockup footer | one client-facing correction |
| 16 | Class declared closed while open | 4 passes | entitlement gates | two days, four passes; now closed |

**Ten rules broken, sixteen instances, in three days.** Note what is *not* in
this table: not one hard rule about the product's behaviour was broken. Every
honesty rule, every never-overwrite rule, every plain-character rule holds in
the code. The failures are entirely in the process that surrounds the code.

---

## 3. Root causes

Four, each with at least three instances.

### 3.1 The artefact handed over is prose, and prose cannot fail

Instances: 13 (three times), 17, 18, 23.
In three days roughly 3,800 lines of audit and specification were written and
none of it was deployed. The documents are well-argued and mostly correct.
None of them can fail the way a command fails. A document that says the code
computes X is accepted on its reasoning; a run that prints Y is not
negotiable. Every one of these six instances is the same substitution: an
argument put where an execution belonged.

The economics are stark and worth stating once:

| Method | Defects found | Cost |
|---|---|---|
| Two adversarial reading rounds | ~20 | two full review passes |
| What both rounds missed | 1 red CI | one command, run after handover |
| Running the engine on the real catalogues | 3 blocking, 8 more | seconds |

The three blocking defects were the ones that would have ended the Republica
BIO engagement: `contine gluten` published on 21 products whose text says
`nu contine gluten`; the notification number mangled on 39 of 71 products;
decimal commas turning `29,7 g` into `7 g`. No reader found any of them. One
run found all three.

### 3.2 Shared contracts are changed from the definition, never from the call sites

Instances: 14, 15, 16 (four passes).
The pattern is identical each time: the change is correct where it is
written, and the set of places that depend on it is never enumerated. A type
gains a field; the four literals that construct it are not looked for. A gate
is added to the routes; the three background jobs that reach the same
resource are not looked for. The fix in each case was one grep, and the grep
was not run because the change felt local.

### 3.3 Reviewer and implementer share the same bias

Instances: 15, 17, 20.
Two adversarial QA rounds read the same file and neither ran it; the defect
was a module that throws only where there is no `.env`, which no amount of
reading surfaces. An audit contradicted a CHANGELOG decision it had not read.
A specification described arithmetic it had not executed. Adding a second
reader multiplies reading. It does not add execution, so it cannot catch
anything execution catches, and it produces confidence proportional to the
number of readers rather than to the evidence.

### 3.4 Documents accumulate faster than they are reconciled

Instances: 20, 23, 26, plus 30 markdown files in `_shopify` of which several
specify unimplemented work.
`STATUS.md` sat a month stale while being the mandated first read. The
CHANGELOG carried a sentence about `complete` that the code had already
contradicted. The rule set in `CLAUDE.md` grew by eight entries in one day.
There is no mechanism that makes a stale document noisy, so staleness is
free, and the documents that new sessions trust most are the ones nobody
reopens.

---

## 4. One hard check per cause

Each is a check that fails loudly, not a reminder to be careful. None of them
is implemented; this section is a proposal, per the audit's own instruction
not to fix anything.

**For 3.1.** Add a `handover` job to `.github/workflows/deploy.yml` that
fails when the diff touches `app/`, `worker/` or `extensions/` and the
CHANGELOG's Unreleased section does not contain a fenced block whose first
line is the last line of a `check.bat` run with a test count. A prose entry
alone stops being mergeable. The guard job already exists at `deploy.yml:8`
and already runs `npx tsc --noEmit` at `:21`, so this is one more step in a
place that is proven to run.

**For 3.2.** A pre-commit or CI step that lists every exported type, constant
and function signature changed in the diff, greps each name across `app`,
`worker`, `scripts`, `extensions` and every `__tests__` directory, and prints
the hit count per name into the run output. It does not need to judge
anything. Making the number visible is enough; the four entitlement passes
and the `CatalogueRead` break both happened while the number was invisible.

**For 3.3.** No review round counts as a round unless it attaches command
output. A round that only reads is a reading, recorded as such. Concretely:
a QA round's report begins with the last lines of the run it performed, or it
begins with the word "unverified".

**For 3.4.** A dated freshness header in every document `CLAUDE.md` names as
a required read, and a CI step that fails when a document older than 21 days
is still listed as read-first. `STATUS.md` would have gone red on 24 August.

---

## 5. What could not be verified, and the command for each

Shell access was granted after this section was first written, so the top four
rows were answered by execution. Their results are recorded here rather than in
prose elsewhere, because that is the point of the section.

### Answered by running, 3 September, 10:22-10:46

| Question | Result |
|---|---|
| Typecheck clean after the two test fixes? | **YES.** `npx tsc --noEmit`, exit 0, no output. |
| Whole suite green? | **YES. 40 test files, 485 tests, 0 failures.** Run in four groups because each shell call is capped at ~178s and the repo is on a network mount (`prepare` alone costs 15-33s per invocation). |
| Does the suite pass without `.env`? | **YES**, for all 24 non-engine files: 277 tests across three groups, plus the 16 engine files (208 tests) run separately without `.env`. This is the condition that produced the red CI on 2 September; `extract.server.test.ts` is in the first group and passes. |
| Do the three WordPress fixtures still pass? | **YES.** `fixtures.test.ts`, 13 tests, inside the 208 engine tests. Rule A.8 moves from HELD-by-reading to HELD-by-running. |

Method note, so the numbers can be reproduced: `node_modules` is installed on
Windows, so the Linux sandbox is missing `@rollup/rollup-linux-x64-gnu` and
`@esbuild/linux-x64@0.25.12`. Both were installed into `/tmp` and supplied via
`NODE_PATH` and `ESBUILD_BINARY_PATH`. Nothing was written into the repo:
`package.json` and `package-lock.json` are unmodified, and every `.env` move was
guarded by a `trap ... EXIT INT TERM` that restores it, verified after each run.

### Still open

| Question | Command |
|---|---|
| Did every code commit leave the suite green? | `cd F:\ai-visibility-shopify; git log --since="14 days ago" --oneline` then per commit `git stash; git checkout <sha>; .\check.bat` |
| Do the figures in the audits match what the code computes? | `cd F:\ai-visibility-shopify; npx tsx scripts/audit-engine-run.ts` |
| Does a real client IP survive Shopify's edge and Fly? | `cd F:\ai-visibility-shopify; npx tsx scripts/read-forwarding.ts` |
| Have secrets ever entered the repo? | `cd F:\ai-visibility-shopify; git log -p -S "SHOPIFY_API_SECRET" --all` |
| Does the Report screen work on its second render? | open `/app/report` on the live app and press CSV export, the crawler card action, and the before/after toggle |
| Was every delivery tagged? | `cd F:\ai-visibility-shopify; git tag --list "deploy-*" --sort=-creatordate` |
| Is Wave A sound? | `cd F:\ai-visibility-shopify; .\check.bat` with Wave A in the tree |

The last one is the only one that blocks a commit. The rest are diagnostic.

---

## 6. The shortest true summary

The code obeys its rules. The process around the code does not, and the
single failure mode behind ten broken rules is that an argument was accepted
where an execution was required. The rigour in this project is real where it
reads semantics and gates, and it is theatre where it stands in for running
something. It stood in for running something at least six times in three
days, including in the document that was written to stop it happening.
