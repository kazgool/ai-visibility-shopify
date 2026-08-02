# DICTIONARY-PORT — exact behaviour the Shopify port must reproduce

Source of truth: `plugin/ai-visibility/includes/class-avw-attributes.php`
(WordPress 1.6.6) and `tests/smoke-test.php` in the `F:\AI Visibility`
folder. Written 2 August 2026 by reading both files line by line, not from
memory. Any difference between the port's output and the WordPress output
on the same input text is a bug in the port.

Target language is TypeScript (Remix backend). PHP-specific notes are
flagged `PORT NOTE`.

---

## 1. Scope

This spec covers the extraction engine only: dictionary parsing, term
matching, the measurement reader, the count reader, phrase hygiene,
deduplication, and output shape. Companion behaviours (summary builder,
alt text, schema enrichment) get their own specs; the one rule imported
from them here is in §10.

Input on Shopify: product `title` + `". "` + `descriptionHtml` stripped of
tags. (WordPress used title + content + excerpt; Shopify has no excerpt.)
Output: ordered list of `{ k: label, v: string }`, stored per PRD §5.4.

---

## 2. Dictionary format

Plain text, one attribute group per line:

```
Label: term, term, term
Label: term * , * term, #size | default: value
```

Parsing rules, in order:

1. Split input on `\r\n`, `\r`, or `\n`.
2. Trim each line. Skip empty lines and lines without a `:`.
3. If the line contains `|`: split on the **first** `|`, trim both parts.
   If the right part matches `/default\s*:\s*(.+)$/i`, the capture
   (trimmed) is the group's fallback value. Otherwise the right part is
   discarded silently.
4. Split the left part on the **first** `:` → label, terms. Trim both.
   Skip if either is empty.
5. Split terms on `,`, trim each, drop empties. Skip the line if nothing
   remains.
6. Result per line: `{ label, terms: string[], default: string }`.
   Later duplicate labels overwrite earlier ones (PHP array key
   behaviour — reproduce it).

An empty saved dictionary falls back to the built-in default list (§9).
The engine must also accept a **preview dictionary** passed for a one-off
test without saving — the dry-run must report on what is in the editor
box, not what is in the database (regression 1.6.4).

## 3. Term forms

Evaluated per term, in this order:

| Form | Trigger | Behaviour |
|---|---|---|
| `#size` | term, lowercased+trimmed, equals `#size` | run the measurement reader (§6) on the whole text |
| `* term` | term **starts** with `*` | count reader (§7). Checked before the prefix form |
| `term *` | term **ends** with `*` | prefix capture (§5) |
| plain | anything else | exact match (§4) |

Base term = the term with `*` stripped from both ends, trimmed. If the
base is empty, skip the term.

## 4. Exact match

Regex: `(?<![\p{L}\p{N}])` + diacritic-pattern(base) + `(?![\p{L}\p{N}])`,
Unicode mode, against the prepared text (§8). Word boundaries are the
lookarounds, not `\b` — so `tul` does not match inside `tulpina`, and
terms containing hyphens or spaces work.

On a hit, record **the dictionary term as written** (original casing and
diacritics from the dictionary, e.g. `dantelă Chantilly`), not the text's
spelling.

## 5. Prefix capture (`term *`)

Pattern: base + `\s+` + capture of **one to three words**, each word
`[\p{L}\p{N}-]+`, separated by single runs of whitespace:

```
(?<![\p{L}\p{N}])BASE\s+((?:[\p{L}\p{N}-]+\s+){0,2}[\p{L}\p{N}-]+)
```

Match **all** occurrences. For each captured phrase:

1. **First-word gate.** Normalize (§8) the first captured word.
   - If it is a stopword (§11): discard the whole capture. Rationale in
     the source: "masa are blatul din PAL" — the term was used in a
     sentence, not as a label; trimming the verb would leave "masa
     blatul", which is worse than admitting there is nothing here.
   - If it starts with a digit: discard. A number after the term is a
     measurement or a count; both have their own handling and belong
     under a different label.
2. **Phrase trim** (§5.1).
3. **Usable-phrase test** (§5.2). Fail → discard.
4. Hit = base + `" "` + trimmed phrase.

### 5.1 Phrase trim

Split the phrase on whitespace. Pop words off the **end** while the
normalized word is empty or a stopword. Then shift words off the
**front** the same way. Join with single spaces and trim the characters
`" ,.;:-"` from both ends.

### 5.2 Usable-phrase test

A phrase is unusable if any of:

- empty after trimming;
- matches `^[\d\s.,-]+$` (a bare number with no unit);
- **any** word in it, normalized, is a stopword. Note this is stricter
  than the trim: a stopword in the middle ("masă are blatul") kills the
  phrase entirely — a fragment in structured data is worse than a gap.

## 6. Measurement reader (`#size`)

Three patterns against the prepared text, in order. The third runs
**only if the first two produced nothing** (within this reader — hits
from other terms in the group don't count):

1. Dimension chains: `\b\d+(?:[.,]\d+)?(?:\s*[x×]\s*\d+(?:[.,]\d+)?){1,2}\s*(?:cm|mm|m|inch|in|")\b`
   — captures `80x200 cm`, `80 x 200 x 75 cm`. Whole match is the hit.
2. Named dimensions: `\b(NAMES)\s*[:=]?\s*(\d+(?:[.,]\d+)?)\s*(cm|mm|m|inch|in|")?`
   where NAMES = `l|L|h|H|w|W|d|D|lungime|latime|lățime|inaltime|înălțime|adancime|adâncime|diametru|length|width|height|depth|diameter`.
   Hit = name + `" "` + number + (unit ? `" "` + unit : ``), trimmed.
   The unit is optional: `adancime 50` is a valid hit.
3. Fallback, bare value with unit: `\b\d+(?:[.,]\d+)?\s*(?:cm|mm|kg|g|ml|l)\b`
   — `4 mm`, `1.5 kg`, `250 ml`. Whole match.

PORT NOTE: the text is already lowercased (§8), so `l|L`, `h|H` in NAMES
are redundant in practice but harmless; keep the pattern verbatim.

## 7. Count reader (`* term`)

Pattern: `\b(\d+)\s+` + diacritic-pattern(base) + `(?![\p{L}\p{N}])`.
Match all. Hit = number + `" "` + base (base as written in the
dictionary). `6 scaune`, `4 persoane`.

## 8. Text preparation, normalization, diacritics

**Prepared text** (the string all matching runs against):
title + `". "` + body, tags stripped, whitespace collapsed to single
spaces, trimmed, lowercased with a Unicode-aware lowercase. Diacritics
are **kept** — matching is diacritic-blind through the regex, so what we
capture can be shown as written.

**normalize(s)** (used for stopword comparison, dedup keys, subsumption):

1. strip tags;
2. map diacritics to ASCII: `ă â → a`, `î → i`, `ș ş → s`, `ț ţ → t`
   (both cases), plus `á→a é→e í→i ó→o ú→u ü→u ö→o ñ→n`;
3. lowercase (Unicode-aware);
4. replace every character that is not letter, digit, whitespace or `-`
   with a space;
5. collapse whitespace, trim.

**diacritic-pattern(term)** (builds the match regex from a dictionary
term): per character, lowercased —

- `a ă â` → `[aăâ]` ; `i î` → `[iî]` ; `s ș ş` → `[sșş]` ;
  `t ț ţ` → `[tțţ]`
- space → `\s+`
- anything else → the lowercased character, regex-escaped.

So `croiala` in the dictionary matches `croială` in the text and the
other way round.

PORT NOTE: all regexes need Unicode mode (`u` flag in JS). PHP's
`mb_strtolower` → `toLocaleLowerCase('ro')` is close enough; verify with
the fixtures. In `drop_subsumed` PHP compares `strlen` on **normalized**
strings (byte length); after normalization the strings are ASCII-safe, so
JS `.length` is equivalent.

## 9. Assembly per dictionary group

For each group, in dictionary line order:

1. Run every term (§3–§7), concatenating hits in term order, then match
   order within a term.
2. **Dedup on the normalized form.** First occurrence wins, so `piele
   ecologica` and `piele ecologică` never both appear.
3. If there are no hits and the group has a default: emit
   `{ k: label, v: default }` and move on.
4. If there are no hits and no default: emit nothing for this group.
5. **Drop subsumed terms**: remove any hit whose normalized form is a
   substring of a strictly longer normalized hit. `Chantilly lace` wins
   over `lace`.
6. Value = the first **4** surviving hits joined with `", "`.

Output: array of `{ k, v }` in dictionary order. Price is never an
attribute (1.6.6) — the offer owns it; the port must not add a price
group to any preset or default.

**Presets.** Five starter dictionaries ship verbatim from the WordPress
source (fashion, furniture, electronics, services, food), in English,
with the same UI warning: terms must be edited into the language the
descriptions are written in. The built-in default list (bridal) also
ports verbatim, with the same "wrong list for most shops" warning.

**Coverage report.** Before any bulk write, sample up to 60 products,
run extraction, report: sampled count, products with zero facts, hit
count per label, sorted descending. This is the dry-run's data.

## 10. The one imported rule: never overwrite

From the schema/meta modules, enforced wherever extraction output lands:
a value a human wrote is never replaced. On Shopify this is the `state`
metafield (PRD §5.4): every write records source `auto`; a value whose
state is `human` is read-only to the engine. The editor shows auto as
placeholder, override on top, reset back to auto (PRD §4.10). Clearing an
override falls back to auto (tested behaviour).

Equally: when enriching an existing JSON-LD node, existing
`additionalProperty` entries and an existing `brand` are never
overwritten (tested by reflection in the suite; same rule applies to the
theme-node merge in PRD §4.2).

---

## 11. Stopwords, verbatim

Merchant-extensible per shop (the WordPress filter becomes a settings
field). Comparison is on **normalized** forms. The shipped list:

Romanian connectors, articles, prepositions:
`si și cu iar dar care pentru din la in în pe ce sau a al ale ai de ca
cat cât un o unei unui cel cea prin sub peste intre între dupa după
catre către fara fără lui lor sa sa- se isi își nu mai foarte atat atât`

Romanian verbs that glue to terms mid-sentence:
`este e sunt era au are aveti aveți fi fost face fac realizat realizata
realizată fixat fixata fixată aflat aflata aflată gasesc găsesc gaseste
găsește poate pot va vor contine conține livreaza livrează ambalat
montat demontat`

English:
`and or with the a an of for from to in on at by is are was were be been
has have had it its this that which made comes come`

---

## 12. Acceptance fixtures — port the tests, keep them green

Port these from `tests/smoke-test.php` exactly; they are the contract.
Fixture texts must be copied byte-for-byte from the suite.

**Fixture A — bridal, English dictionary (built-in), post 101:**
title `Lidia — short wedding dress with appliqué`, body: "Price 1800
lei. A mini civil ceremony dress made entirely of Chantilly lace, with
hand-sewn 3D flowers. Fitted silhouette, spaghetti straps and a square
neckline. Open back with a lace-up corset. Ivory, with a detachable
train."

- finds `Material`; its value contains `chantilly` (longer term won over
  `lace`)
- finds `Neckline` via wildcard; value contains `square`
- finds `Back` via wildcard

**Fixture B — Romanian dictionary, diacritics both ways, post 102:**
dictionary `Material: dantelă, dantelă Chantilly, tul, satin` /
`Croială: croială *, siluetă *, cambrată` / `Decolteu: decolteu *`;
text: "Rochie din dantela Chantilly, siluetă cambrată, decolteu drept.
Pret 3900 lei."

- `Material` matches although the text writes `dantela` without
  diacritics
- `Croială` matches (dictionary has diacritics, matching is blind)
- `Decolteu` captures `drept` through the wildcard

**Fixture C — live furniture copy, the hard one, post 103:**
dictionary `Material: PAL, sticlă securizată, inox, piele ecologică,
plastic, burete` / `Tip: masă *, scaun *, set *` / `Dimensiuni: #size` /
`Capacitate: * scaune, * persoane, * locuri` / `Funcționalitate:
extensibil, extensibilă, pliabil, mecanism *`; text: "Masa are blatul
din PAL Laminat peste care s-a fixat sticla securizata de 4 mm.
Extinderea mesei se face prin tragerea extensiei pe un mecanism mecanic
aflat sub blatul mesei. Scaunele au cadru din inox, sezutul este tapitat
cu burete si piele ecologica. Dimensiuni: -Masa: l 80, L 130, h 79 cm
-Scaune: adancime 50, h scaun 94 cm. Setul se livreaza demontat,
instructiunile de montaj se gasesc in interiorul coletului."

- `Material` contains `inox`
- `piele ecologica` appears **at most once** in the normalized value
  (diacritic dedup)
- `Dimensiuni` contains `130` (the named-dimension reader worked)
- `Capacitate` contains `6 scaune` (count read from the title)
- **No published value contains any of:** `are blatul`, `cat si`,
  `se gasesc`, `aflat sub`, `se face`. The whole point of the 1.6.6
  rework: sentence fragments are never published as attributes.

**Also port:** normalize(`Croială`) = `croiala`; dictionary parse
produces terms + default per group; default fallback fires only on zero
hits; override save/clear falls back to auto; the enrich-node
never-overwrite pair (§10).

Exit test for Phase 2 stays as the launch plan states: run against the
seeded store and compare product by product with the WordPress plugin on
the same descriptions. Any difference is a bug in the port.
