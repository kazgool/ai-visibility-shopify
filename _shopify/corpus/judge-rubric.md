# FAQ judge rubric

Written 11 September 2026, before any Q&A was judged (CC-PROMPT-AI-READABILITY-3
item 5). Every question and answer `app/engine/faq.ts` produces, on every
product of every corpus store, is judged against this page. The bar: at most
1 percent errors on the hold-out total, and on every hold-out store with at
least 50 Q&A.

## What the judge sees per product

- The store, its content language, and its set (dev or hold-out).
- The product's own data: title, the description as text (tags removed,
  headings kept on their own line), the facts the dictionary extracted
  (label: value), the options with their values, vendor, product type.
- The shop's business record when one was passed (delivery, returns,
  warranty, payment).
- Every Q&A the engine produced for the product, in order, each with its
  source (safety, section, merchant, mapping, preset, variants, vendor,
  business).

## A Q&A is an ERROR when any of these holds

1. **The answer does not answer the question.** A reader who asked the
   question would not have it answered by this text: a slogan under "How do
   I use X?", a shipping note under "What does X contain?", a list of
   benefits under "Who is X for?". An answer that answers the question and
   also says more is not an error.
2. **The answer states something not present in the product's own data**
   (description, facts, options, business record). Rephrasing the same
   content is fine; a claim, number, unit or name that is not there is an
   error. Text taken from a different product is an error.
3. **The answer is cut so that its meaning changes or is lost.** A list cut
   after its third item is fine when every item shown is whole and true. An
   error: a sentence ending mid-clause, a warning whose condition was cut off
   ("Do not use if" and nothing after), a number separated from its unit, a
   negation lost.
4. **The question is ungrammatical or unreadable in its language.** Wrong
   agreement, a label used as a noun where it is not one ("Ce fara are X?"), a
   question whose meaning cannot be understood without the page around it.
   Spelling as the merchant wrote it (missing diacritics, the merchant's own
   capitals) is not an error by itself.
5. **The question is about something else than this product.** A question
   about the store, the brand's mission, a gift card, a subscription offer or
   a different product, on a product's page. Store-wide text (delivery,
   returns, warranty, payment) is allowed only under the business questions.
6. **A safety or warning section exists in the description and no safety
   question was produced.** Judged once per product: if the description has a
   section that warns (warnings, cautions, contraindications, "keep out of
   reach of children", allergy warnings) and no Q&A of source safety carries
   it, the product counts one error under rule 6, logged with q = "(missing
   safety question)".
7. **Duplicate question or duplicate answer on the same product.** The second
   of two questions that ask the same thing, or two questions whose answers
   are the same text, is an error.

When two rules apply, the lowest-numbered is logged. When unsure whether a
Q&A is an error, it is logged as an error with the doubt in the reason: the
bar is on errors a buyer would see, and a doubt in the judge's favour hides
one.

## What is not an error

- A question the judge would have phrased differently, when it is readable
  and answered.
- An answer that repeats the description's own words, including its
  marketing tone, when it answers the question.
- A missing question that would have been useful (only a missing safety
  question is an error, rule 6).

## Logging

One JSON object per Q&A:
`{ "store", "product", "q", "a", "source", "verdict": "ok" | "error", "rule": 1-7 | null, "reason" }`.
Every error carries a one-sentence reason a person can check against the
product. Rule 6 errors carry `q: "(missing safety question)"` and the warning
text found in `reason`.

## Reporting

Per store and per source: produced, errors, error rate, with denominators.
Dev and hold-out totals apart. Every error listed. A hold-out store whose
products were opened to fix a rule moves to dev, and a reserve store of the
same language replaces it.
