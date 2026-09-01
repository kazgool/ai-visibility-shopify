# AI Visibility All-in-One — working instructions

You are working on a Shopify app that reads product descriptions merchants
already wrote, extracts comparable attributes deterministically (regex, no
model calls), and publishes them where AI assistants can read them. It is a
sibling of a live WordPress plugin whose rules were paid for with real
failures on a live catalogue.

**Read first, in this order:** `_shopify/STATUS.md` (where things stand),
then the document relevant to your task: `_shopify/PRD.md` (what and why),
`_shopify/ARCHITECTURE.md` (how), `_shopify/DICTIONARY-PORT.md` (the engine
contract), `_shopify/BILLING-SPEC.md`, `_shopify/DESIGN-BRIEF.md`. These
documents win over your instincts. If reality contradicts them, stop and
say so rather than improvising.

For Shopify API specifics, prefer the Shopify AI Toolkit / official docs
over memory — APIs moved fast in 2025–2026.

---

## How to think (rules learned in this project, the hard way)

1. **"If I do A, what happens overall — not just causally?"** Before any
   new filter, rule, or write, list what else it catches or triggers. Two
   real cases: a UUID filter that would also have discarded `160x80` and
   `IP65` (real specifications); metafield writes that re-triggered our own
   webhooks and fed the app its own output for ever. Every layer can be
   correct alone and wrong together.

2. **A filter that removes noise and value together is worse than the
   noise**, because the loss is silent. When unsure, let the stray value
   through — the merchant can delete what they can see; they cannot see
   what never appeared. (`DICTIONARY-PORT.md` §10.1.)

3. **Never write an identical value.** Writing marks the product as
   updated, which triggers webhooks, which queues extraction, which writes
   again. The `unchanged` check in `facts.server.ts` is load-bearing; do
   not remove it, and follow the same principle in any new writer.

4. **Semantics matter more than labels.** "6 scaune" on a dining set is
   package contents, not seating capacity, and never an audience. Seats
   and Includes are separate labels for a reason. When generating anything
   (questions, schema, alt text), ask what the value *means*, not what its
   label is called.

5. **Distrust code comments, trust behaviour.** The WordPress source
   claimed trimPhrase turns "drept si bretele" into "drept"; it does not.
   Port behaviour, verify with tests, document corrections.

6. **When something breaks, regroup before patching.** One systematic
   audit found three bugs (a Liquid namespace that silently disabled the
   whole storefront output, the self-feed storm, an import mess) that
   reactive patching had missed. Read the whole file, not the diff.

## Hard rules (never break)

- **Nothing a human wrote is ever overwritten.** Enforced via the `state`
  metafield; a value with no state entry is treated as human. This is the
  product's core promise and its main differentiator.
- **Merchant data lives in Shopify metafields**, never only in our
  database. It must survive our uninstall.
- **GraphQL Admin API only.** One REST call is an App Store rejection.
  CI greps for it.
- **The storefront block ships zero JavaScript** and never fetches. Built
  for Shopify allows ≤10 points of performance impact.
- **Never a second complete Product node** in structured data. Extend mode
  references the theme's node by `@id`. In extension Liquid, our metafields
  are read as `product.metafields['$app'].key` — the literal `.app.` form
  silently returns nothing.
- **The engine (`app/engine/`) stays pure**: no Shopify, no Prisma, no I/O.
  That is what makes it testable against the WordPress original.
- **The three WordPress fixtures in `fixtures.test.ts` are a contract.**
  Fixture texts are byte-for-byte from the original suite. If one fails,
  the port has drifted — fix the code, never the fixture.
- **Product UI is English only.** Only dictionary *terms* are in the
  merchant's language.
- **Plain characters only in every text the app shows or writes.** No em
  or en dashes (use "-" or ";"), no HTML entities (`&#038;` becomes `&`),
  no curly quotes, no ellipsis character (use "..."). Every published
  string goes through `cleanOutput()` in `app/engine/normalize.ts`; new
  writers must use it too. Imported catalogues are full of entities, and
  a screen reader spelling out `&#8211;` is the failure this prevents.
- **No trial, no coupons.** $99/year (≤20k products), $149/year above. There is
  no time-limited access and nothing is ever taken away at the end.
  There is now one permanent, quantity-limited exception, decided 28 August
  2026 and specified in `FREE-TIER-SPEC.md`: the crawler check and the coverage
  score are free, and three merchant-chosen products are fully processed before
  payment. It is not a trial - nothing expires, and what was written stays
  written whether the merchant subscribes or not. Do not extend it, do not add
  a second free quantity, and do not add discounts.
- **Secrets never enter the repo.** `.env` locally, `fly secrets` in prod.

## Working with Marius

- He runs PowerShell commands and clicks UIs; **you write all files and
  code**. Give him commands one step at a time, exact and copy-pasteable,
  and tell him which terminal (dev running vs free).
- **Always start a command block with `cd F:\ai-visibility-shopify`.** He
  works in several PowerShell windows at once, so no block may assume the
  working directory it inherited from an earlier one.
- **Batch files are invoked as `.\check.bat`, `.\dev.bat`, `.\shell.bat`.**
  PowerShell does not run a script from the current directory without the
  leading `.\`, so the bare name fails.
- **Every delivery ends with `npx shopify app deploy` and a tag**, even when
  no extension changed. The deploy is what dates the release in the Developer
  Dashboard, so the CHANGELOG headings keep matching the version numbers
  Shopify shows; the tag is what a revert starts from. Give both commands
  every time, without being asked.
- Explain what a change does and why before or as you make it — he
  supervises, catches real bugs (he found the self-feed loop and the
  audience semantics), and decides product questions. Bring him decisions,
  not mysteries.
- Do not run ahead: when he says wait, wait. When a preference conflicts
  with a spec, surface the conflict; his call wins and gets documented.
- Answer in the language he writes in (usually Romanian). Code, comments,
  commits and docs are English.

## Workflow

- `check.bat` = install + prisma generate + typecheck + tests. Run it (or
  its steps) before declaring anything done. 65+ tests must stay green.
  (EPERM on prisma generate means dev.bat is running — stop it first.)
- **`check.bat` passing is not the same as the feature working.** Typecheck,
  unit tests and the build all inspect code in isolation; none of them opens
  the screen. For anything with state — a queue, a job, a write, a wizard —
  the verification is not finished until the *second* render is accounted
  for: what does the screen show after the action, not merely that the
  action succeeded. Two bugs shipped this way. The free-tier cap was enforced
  in the spec and in the route, and bypassed by three background jobs. The
  SEO queue built correctly and applied correctly, then kept showing the
  pre-write proposals and computed its headline figures from them, so a
  store with every field written read "0 of 50". In both cases every test
  was green. State the post-action state explicitly when reporting work
  done, and when a browser is available, press the button.
- `dev.bat` = `shopify app dev`. While it runs, app URLs point at the
  laptop tunnel; the app proxy (mirror) dies when it stops. Production
  serving requires `fly deploy` + `npx shopify app deploy` with dev OFF
  (dev rewrites URLs back to the tunnel while running).
- Commit early with meaningful messages. Marius pushes.
- **While a submission is under review, do not run `npx shopify app deploy`.**
  It releases a new version and activates it, so the reviewer may test
  something other than what was submitted, and the change can be treated as
  an amendment that sends the app back down the queue. Server changes (CI on
  push to main) are safe and do not create versions. Pending extension work
  waits for the verdict and then ships in one deploy. The app was approved on
  7 Aug 2026 and is published as MRDigital AI Visibility AiO; the rule
  applies again to any future resubmission.
- **Keep `_shopify/CHANGELOG.md` current with every change.** New work goes
  under "Unreleased"; when a deploy happens, that section becomes the new
  version number, matching the app version Shopify shows in the Developer
  Dashboard. It is what Marius sends the reviewer if asked what changed.
- **Tag every deploy** (`deploy-YYYY-MM-DD-N`, annotated, message says what
  shipped) and push with `git push --tags`. Reverting is then one line per
  layer: code `git revert` or redeploy from the tag; Fly
  `fly releases -a ai-visibility-all-in-one` + `fly deploy -i <old image>`;
  extensions: Developer Dashboard - Versions - release the previous one;
  database: Neon point-in-time restore (Console - Branches - Restore).
  Postgres schema changes additionally need a down path thought out before
  the migration runs, not after.
- The Fly worker and a local `npm run worker` share the same Neon queue;
  after changing worker tasks, either `fly deploy` or run the worker
  locally, otherwise jobs sit queued for ever (the dashboard says so after
  three minutes without movement).
- Progress lives in `JobRun` rows, not in the browser. Never build UI that
  implies otherwise.

## Environment facts

Dev store `mrdigital-dev.myshopify.com` (355 real furniture products,
Romanian descriptions; storefront password `massive`, cannot be disabled
on dev stores — the crawler check correctly reports it). App id
405463269377, org 229253428. Fly app `ai-visibility-all-in-one` (ams+iad
web, ams worker). Neon `ai-visibility-shopify`, Frankfurt. Repo
`github.com/kazgool/ai-visibility-shopify`, branch `main`.

Neon is on the paid Launch plan since 20 Aug 2026, after the free plan's
compute quota ran out and took the whole app down: `prisma migrate deploy`
failed on boot with "exceeded the compute time quota", the container exited
with code 1, and Fly restarted it in a loop, so every screen was blank while
`fly status` showed the machines started with the health check on warning.
Launch has no quota to hit, only a bill, so the free plan's cap is no longer
acting as a brake. The 15-minute poll is what keeps the database awake and is
the main driver of compute cost. If a blank app ever returns, read the boot
logs before anything else: `fly logs -a ai-visibility-all-in-one --no-tail`.

fit_for is by design broader than people: rooms and spaces ("kitchen",
"dining room", "small apartments") are valid values, because "suits a small
kitchen" is exactly what a furniture seller states about a piece. It is
published as audienceType, which reads oddly against schema.org's own
definition, but the value semantics are Marius's call (20 Aug 2026) - do
not "fix" room values out of fit_for.

Known accepted imperfections (do not "fix" without asking): mirror cache
rewrites on every pass; alt-text editor state does not resync after save
without refresh; poll iterates shops sequentially (fine at this scale).

## What is next (see STATUS.md §7 for detail)

Billing per BILLING-SPEC, onboarding that refuses success until the app
embed is verified active, collections with comparison tables, IndexNow,
variant-level attributes, listing assets. LAUNCH-PLAN.md remains the
roadmap; App Store submission requirements are in PRD §5–§8.
