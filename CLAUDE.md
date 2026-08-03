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
- **No trial, no free tier.** $99/year (≤20k products), $149/year above.
  Do not add trials, coupons, or gating beyond the single entry gate.
- **Secrets never enter the repo.** `.env` locally, `fly secrets` in prod.

## Working with Marius

- He runs PowerShell commands and clicks UIs; **you write all files and
  code**. Give him commands one step at a time, exact and copy-pasteable,
  and tell him which terminal (dev running vs free).
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
- `dev.bat` = `shopify app dev`. While it runs, app URLs point at the
  laptop tunnel; the app proxy (mirror) dies when it stops. Production
  serving requires `fly deploy` + `npx shopify app deploy` with dev OFF
  (dev rewrites URLs back to the tunnel while running).
- Commit early with meaningful messages. Marius pushes.
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

Known accepted imperfections (do not "fix" without asking): mirror cache
rewrites on every pass; alt-text editor state does not resync after save
without refresh; poll iterates shops sequentially (fine at this scale).

## What is next (see STATUS.md §7 for detail)

Billing per BILLING-SPEC, onboarding that refuses success until the app
embed is verified active, collections with comparison tables, IndexNow,
variant-level attributes, listing assets. LAUNCH-PLAN.md remains the
roadmap; App Store submission requirements are in PRD §5–§8.
