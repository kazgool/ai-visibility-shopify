# PRD: fix wave 1 - engine safety before the first paying catalogue

2 September 2026. Derived from `AUDIT-MODULE-2026-09-02.md` sections 2, 3
and 6, and `AUDIT-2026-09-02.md` sections 1.2 and 1.3.

## Why this wave and not the others

Republica BIO is the first paying catalogue. Today the engine publishes a
false allergen claim on 21 of their products, mangles their regulatory
notification number on 39, and cuts every quantity that carries a Romanian
decimal comma. None of it is visible in the admin, because the dashboard
correctly reports "189 of 189 readable".

Everything in this wave is engine or gate work, testable without Shopify,
and provable by re-running the engine on the real 189 products. The
onboarding ladder, the at-a-glance screen and the SEO snapshot are real
and are **not** in this wave: a dashboard over an engine that publishes
`contine gluten` on a gluten-free product is a dashboard over a liability.

## Non-goals

No UI work. No new screens. No schema migration. No change to the three
WordPress fixtures. No change to the published JSON-LD shape. No new
dictionary families. `_shopify/PRD.md` and `DICTIONARY-PORT.md` remain the
contract; this PRD extends the dictionary format, it does not replace it.

---

## E1. Negation window

**Problem.** `extract.ts:153-170` matches a plain term as a whole word with
no look-behind. `nu contine gluten` publishes `contine gluten`.

**Rule.** Before accepting a match for a plain term or a prefix term, look
at the tokens between the start of the sentence and the match, capped at
three tokens back. If any of them is a negator, drop that occurrence and
continue scanning for the next one. Measurements and counts are not
affected.

**Default negator list**, applied to every dictionary unless overridden:
`nu`, `fara`, `nu contine`, `no`, `not`, `without`, `free`, `free of`,
`sans`, `ohne`, `sin`, `zonder`, `bez`.

**Dictionary extension.** A line `negators: x, y, z` anywhere in the
dictionary replaces the default list for that shop. A line
`negators+: x, y` adds to it. Absent line means default. The dictionary
parser must ignore an unknown leading keyword rather than treating it as a
family, so old dictionaries keep working and a future keyword does not
break a shop.

**Acceptance, exact.** With the Republica BIO dictionary:

| input (verbatim from the catalogue) | must NOT produce | must still produce |
|---|---|---|
| `nu contine gluten sau organisme modificate genetic, fiind ideala pentru femei` (SKIN GLOW) | `Alergeni: contine gluten` | `Fara: fara gluten` if that term is also present in the text |
| `produsul nu contine gluten, lactoza, soia` (Discovery Pack Latte) | `Alergeni: contine gluten` | - |
| `contine gluten` with no negator in the three preceding tokens | - | `Alergeni: contine gluten` |
| `fara gluten` | - | `Fara: fara gluten` (the negator is part of the term itself and must not suppress it) |

That last row is the trap: the negator check must run on the tokens
**before** the matched span, not inside it, or every `fara *` term in the
dictionary stops matching.

Across the 189 products, `Alergeni: contine gluten` must fall from 21
products to whatever number genuinely states it, and the run must print
that number.

---

## E2. Dotted abbreviations, and no single-letter captures

**Problem.** `notificat de S.N.P.M.A.P.S. 1378/2023` publishes
`notificat de s` on 39 products, `notificat de m` on 9.

**Rule, two parts.**

1. In `prepareText` and `prepareTextCased`, collapse a run of two or more
   single letters each followed by a dot into one token with the dots
   removed: `S.N.P.M.A.P.S.` becomes `snpmaps`, `M.S.` becomes `ms`. Only
   when every element of the run is a single letter, so `1.5` and
   `www.example.com` are untouched.
2. In `isUsablePhrase` (`phrase.ts:66`), reject a capture whose first word
   is a single character.

**Acceptance, exact.**

| input | must produce |
|---|---|
| `notificat de S.N.P.M.A.P.S. 1378/2023` (MACA FORTE COMPLETE PROTOCOL) | `Notificare: notificat de snpmaps 1378/2023` |
| `notificat de CRSP Iasi 4543/2023` | `Notificare: notificat de crsp iasi 4543` or better; must not regress |
| `1,5 l` | unchanged, `Gramaj: 1,5 l` |

Across the 189 products, no `Notificare` value may be one or two
characters.

---

## E3. Decimal and thousands separators in counts

**Problem.** `counts.ts:7` uses `\b(\d+)\s+`. `60 capsule (29,7 g)`
publishes `Gramaj: 7 g`; `7.000mg` publishes `Concentratie: 0 mg`.

**Rule.** The number group becomes `(\d+(?:[.,]\d+)*)`, and the match must
not start in the middle of a number: add a look-behind rejecting a
preceding digit, comma or dot. The published value keeps the separator as
the merchant wrote it.

**Acceptance, exact.**

| input (verbatim) | must produce | must NOT produce |
|---|---|---|
| `60 capsule (29,7 g)` (ASHWAGANDHA COMPLETE PROTOCOL) | `Gramaj: 29,7 g` | `7 g` |
| `90 tablete, 40,5 g` | `Gramaj: 40,5 g` | `5 g` |
| `7.000mg` | `Concentratie: 7.000 mg` or no match | `0 mg` |
| `60 capsule` | `Cantitate pachet: 60 capsule` | - |

Across the 189 products, no `Gramaj` or `Concentratie` value may begin
with `0` followed by a space, and the value `05 g` must disappear.

---

## E4. Prefix captures stop at a preposition or a second label

**Problem.** `produs in Franta per portie` is published as one origin value
on 9 products.

**Rule.** The one-to-three word capture stops before a token that is a
stopword-class connector (`per`, `cu`, `si`, `sau`, `pentru`, `din`, `de`,
`la`, `for`, `with`, `and`, `or`) **when at least one word has already been
captured**. It also stops at a comma, semicolon, colon or bracket.

Careful: `din` and `de` are legitimate inside `faina din seminte de
dovleac`. The stop must apply only after the first captured word, and the
existing `isUsablePhrase` rejection of phrases containing a stopword must
be relaxed accordingly - today it drops the whole phrase instead of
truncating it. Truncating is the §10.1-correct behaviour: keep the part
that is a value, drop the part that is prose.

**Acceptance, exact.**

| input | must produce | must NOT produce |
|---|---|---|
| `produs in Franta per portie, de origine bovina` | `Origine geografica: produs in franta` | `produs in franta per portie` |
| `faina din seminte de dovleac coapte` | `Ingrediente: faina din seminte de dovleac` (unchanged from today) | a truncation to `faina din seminte` |
| `square neckline finished with delicate lace` | `Neckline: square neckline` or `square` | nothing at all (today it produces nothing) |

The three WordPress fixtures must stay green. If any of them changes, the
fixture wins and the rule is wrong.

---

## E5. Alt text needs two junk signals before overwriting

**Problem.** `alt-text.ts:78` treats any 8-digit run as machine junk, and
`alt-text.server.ts:66` uses that as permission to overwrite a human alt
text. `Masa extensibila, cod 20260527, stejar natural` is replaced.

**Rule.** `looksLikeMachineAlt` returns true only when a junk signal is
present **and** the value contains no word of four or more letters outside
the junk token. A filename pattern, a UUID or an HTML entity on its own
still counts as junk, because those never appear in a sentence a person
typed.

**Acceptance, exact.**

| existing alt text | overwrite? |
|---|---|
| `Masa extensibila, cod 20260527, stejar natural` | no |
| `IMG_20260527_120033.jpg` | yes |
| `20260527120033` | yes |
| `photoroom_1748.png` | yes |
| `Fotoliu gri, vedere laterala` | no |

---

## G1. Entitlement on the two ungated actions

`app/routes/app.business.tsx:42` and `app/routes/app.dictionary.tsx:57`
write without checking access. Add the same check
`app/routes/app.collections.tsx:104` uses, returning the same shape the
screen already renders. No UI change beyond the existing error banner.

Acceptance: a POST to either route from a shop with no subscription and no
comp writes nothing and returns the refusal.

---

## G2. Entitlement inside the two ungated worker tasks

`worker/tasks.ts:48` (`bulk_extract`) and `:408` (`bulk_alt_text`) do not
re-check at execution. Add `mayProcessAutomatically` and the `refused`
JobRun status exactly as `bulk_collections` does at `:623`.

Acceptance: a job enqueued while paid and executed after access is removed
sets `status: "refused"` and writes nothing.

---

## S1. A product's values and its state are written in one call

`facts.server.ts:230-237` slices all metafields into groups of 24 without
regard to product boundaries, so a product's values can land in one call
and its `state` in the next. If the second fails, the value exists with no
provenance and is treated as human for ever.

**Rule.** Build the slices per product: never split one product's
metafields across two calls. A product with more than 24 fields, which
cannot occur today, goes in a call of its own.

This is the cheap half of the race in audit 6.1. The read-modify-write
race between `writeFacts` and `writeSeo` is **not** in this wave; it needs
a design decision about per-key state metafields and gets its own PRD.

Acceptance: a unit test asserting that for a batch of products whose
combined field count crosses 24, every emitted slice contains, for each
product it touches, either all of that product's fields or none.

---

## Tests

Add to the existing suite, not replacing anything:

1. `app/engine/__tests__/negation.test.ts` - the four E1 rows plus the
   `fara gluten` trap.
2. `app/engine/__tests__/abbreviations.test.ts` - the three E2 rows.
3. Extend `units.test.ts` with the four E3 rows.
4. Extend the prefix tests with the three E4 rows.
5. Extend `alt-text.test.ts` with the five E5 rows.
6. `app/services/__tests__/facts.server.slices.test.ts` for S1.
7. `app/services/__tests__/billing-gates.test.ts` for G1 and G2, asserting
   the refusal path, not the happy path.

**The three WordPress fixtures in `fixtures.test.ts` are a contract and do
not change.** If a rule here breaks one, the rule is wrong.

## Corpus check, not a test

After the code lands, run `scripts/audit-engine-run.ts` against the 189
Republica BIO products with their dictionary and record, in the CHANGELOG
entry, the before and after for:

- products publishing `Alergeni: contine gluten`
- shortest `Notificare` value
- count of `Gramaj` or `Concentratie` values starting with `0 `
- total facts, median facts per product

Numbers that move in the wrong direction are a failed wave, whatever the
unit tests say.

## Definition of done

- `check.bat` green, all existing tests still passing, new tests passing.
- The corpus check recorded with before and after numbers.
- `_shopify/CHANGELOG.md` updated under Unreleased.
- No change to the Liquid blocks, so `npx shopify app deploy` is not
  required for correctness; it is still run, per the standing rule, to date
  the release.
