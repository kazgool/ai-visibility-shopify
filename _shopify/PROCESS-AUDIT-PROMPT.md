# Internal process audit: were our own rules followed?

Reusable prompt. Paste as-is into a fresh session. Written 3 September 2026,
after two days in which the same class of failure (prose handed over instead
of a run) produced a red CI, two typecheck errors and a duplicated metric
threaded through six files.

---

You are auditing HOW work was done in this project, not whether the product
works. The question is: we wrote rules for ourselves, and evidence suggests we
break them repeatedly. Find where, how often, and why.

## Scope

Three trees, all on disk, all readable:
- F:\ai-visibility-shopify        (Shopify app, git repo)
- F:\AI Visibility                (WordPress plugin + GTM, git repo)
- F:\AI Visibility SHOPIFY        (marketing assets, not a repo)

Period: the last 14 days. Use `git log --since` for the two repos and file
mtimes for the third. If a claim needs older context, take it, but say so.

## The rules to audit against

They are written down, not inferred. Read all of these first and build an
explicit checklist of every imperative statement in them:
- F:\ai-visibility-shopify\CLAUDE.md          (hard rules, workflow, working with Marius)
- F:\AI Visibility\CLAUDE.md                  (voice rules, positioning, how to work)
- F:\ai-visibility-shopify\_shopify\CHANGELOG.md   (decisions recorded there bind later work)
- any *.md in _shopify\ that states an acceptance criterion or a spec rule

Produce the checklist as a numbered list before auditing anything. A rule you
did not enumerate is a rule you did not audit.

## Method: evidence, not impression

For every rule, one of three verdicts, and nothing else:
- HELD, with the evidence that proves it (a command output, a grep count, a
  commit range).
- BROKEN, with file and line, or commit hash, or the exact document sentence
  that contradicts another document.
- UNVERIFIABLE, and say precisely which command would settle it.

Rules that can only be checked by running something must be checked by running
something. Specifically:
- Did every commit that touched code leave the suite green? Check out the
  commit and run the tests, or at minimum check whether CI ran and passed.
- Does the suite pass with .env absent? Rename it away and run once.
- Do the numbers quoted in specs and audits match what the code computes?
  Run the code (scripts/audit-engine-run.ts and similar) and compare.
- Do the commands written in handovers actually work as written, starting from
  a fresh shell in the stated directory?

If a tool is unavailable and a check is impossible, write UNVERIFIABLE. Never
substitute reasoning for a run, and never describe a check you did not perform.

## Specific classes to look for

1. Prose-to-execution ratio. Count lines of specification, audit and changelog
   written in the period against lines of shipped code, commits and deploys.
   Name every document that specifies work that has not been implemented.
2. Handovers whose claims were not run. Search commits and documents for
   "done", "shipped", "verified", "green" and check each against evidence at
   that date.
3. Contract changes made without listing call sites. For every changed exported
   type, shared constant or function signature in the period, grep the name
   across app, worker, scripts, extensions and every __tests__ directory, and
   say whether all sites were updated in the same commit.
4. Classes of defect declared closed while instances remained. For each fix
   wave, enumerate every instance of that class in the repo now.
5. Documents contradicting each other, and stale documents that a session is
   instructed to read first.
6. Voice and formatting rules in customer-facing strings: em/en dashes, curly
   quotes, ellipsis characters, HTML entities, forbidden claims. Grep for the
   characters; give counts and file paths.
7. Standing deliverable rules that were skipped: the deploy plus tag at the end
   of a delivery, the CHANGELOG entry, the cd line at the head of a command
   block.
8. Commands that were specified as prerequisites and never run.

## Output

One file: _shopify/PROCESS-AUDIT-<date>.md

- The checklist of rules, numbered, each with its verdict and evidence.
- A table of every broken rule: rule, how many times, worst instance, cost in
  rework where it can be traced to a later fix.
- Root causes, at most five, each supported by at least three instances. A root
  cause with one instance is an anecdote, not a cause.
- For each root cause, one change that would make the failure impossible or
  visible rather than a reminder to be careful. Prefer a check that fails loudly
  over a rule that asks for discipline.
- A closing section listing what you could not verify and the command for each.

## Constraints

- Do not fix anything. Do not edit code, specs or documents other than the one
  audit file you write.
- Do not soften. If the same rule broke five times, say five.
- Quote sources exactly; if a quote is approximate, mark it.
- Delegate bulk grepping and counting to subagents; verify their output against
  the source yourself before including it. Unverified subagent output does not
  go in the file.
- English throughout.
