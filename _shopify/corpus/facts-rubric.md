# Facts judge rubric

Written 11 September 2026 for CC-PROMPT-AI-READABILITY-3 item 7: the facts
list as the product page's visible block shows it (label: value), judged on
the same stores as the FAQ, by rubric rules 2 and 3 only. It measures; it
changes no default.

## What the judge sees per product

The product's title, its description as the engine reads it ("## " marks a
heading), and every fact pair the page would show, each with an id.

## A pair is an ERROR when either holds

2. **The pair states something the product's own data does not support.**
   The value, read under its label as a statement about this product, is not
   what the title or description says of it: "Material: metal" on a fabric
   sofa whose metal is only the legs; "Forma: ceai" on a honey; a value taken
   from a different product in the text, from a sentence about something
   else ("Ingredients: with two d-ring placements"), or from a negation
   ("Contine: gluten" where the text says gluten-free).
3. **The pair is cut so that its meaning changes or is lost.** A number with
   no unit or no way to know what it measures ("Dimensions: 10 CM" on a sofa
   when that is the foam thickness; "l 80, L 130, h 79 cm, L 170" with two
   lengths and nothing saying which is which), a word torn from a phrase so
   that it means something else.

When unsure, it is an error with the doubt in the reason.

## Not an error

- A value in the merchant's own spelling, language or capitals.
- A value that is true but partial (one of several materials, when the label
  and value do not claim to be the whole).
- A label the judge would have named differently.

## Logging

As the FAQ judge: one JSON object per pair, `{ "id", "verdict": "ok" | "error",
"rule": 2 | 3 | null, "reason" }`, joined to store, product, label and value by
`scripts/faq-judge-merge.ts`.
