// The printable report (PRD-SEO-FULL-ONPAGE section 4.3, build step 6).
//
// WHERE THIS PAGE LIVES, AND WHY IT IS NOT A NEW TAB.
//
// The obvious design is a standalone top-level document opened with
// target="_blank", which is what the CSV exports do. It is the wrong design
// here, and the evidence is in this repo rather than in a guess: app.tsx's
// loader keeps the query string on its own redirect with the comment
// "embedded requests carry shop/host/embedded there, and dropping them sends
// the next request to the login page". A route under /app reached without
// those parameters authenticates as a fresh visitor. A CSV survives that
// badly but visibly - the merchant gets a file that is not a file. A report
// would render a login screen, which is worse, because it looks like the
// report failed. So this page is an ordinary embedded route, reached by a
// normal in-app link, on exactly the authenticated path the dashboard itself
// uses.
//
// HOW IT IS PRINTED.
//
// Inside the admin the app is a cross-origin iframe, so printing is not the
// plain case. Two things are true and neither can be checked without a
// browser: window.print() called inside a frame prints that frame's document
// in Chrome, Edge and Firefox (this is the mechanism behind the browsers' own
// "Print frame" menu item), and a sandboxed frame needs allow-modals or Chrome
// ignores the call and logs "Ignored call to 'print()'". Shopify's sandbox
// attribute is not ours and is not visible from inside the frame.
//
// The page is therefore built so that the button is a convenience and never
// the mechanism: what is printed is this document, styled for paper by the
// @media print block below, and a line under the button names the browser's
// own path for the case where nothing happens. Nothing here claims a
// behaviour that was not observed.
//
// WHAT IS ON PAPER. The shop, both dates, and every figure with the method
// line that produced it. No navigation, no collapsible controls, no buttons:
// every group is already open, because paper has no disclosure triangle. Cards
// carry break-inside: avoid so a page break cannot land inside one.

import {
  columnAccount,
  groupWordFor,
  nothingGroupedSentence,
  type Readiness,
} from "../services/seo-readiness";
import {
  BASIS_WORD,
  dashboardDerived,
  keyFigures,
  listingUnmeasuredSentence,
  paperContext,
  reportHeading,
  rowScopeNote,
  shopWideHeading,
  stripSentence,
  type DashboardSource,
} from "../services/seo-report";
import { pagesReadSentence, type CheckRow } from "../services/seo-aggregate";
import { OWNER_LABEL } from "../services/seo-findings";
import { formatCount } from "../services/report-metrics";
import {
  differenceLabel,
  formatDay,
  ownerFigure,
  ownerNoSnapshotSentence,
  ownerSinceMethodLine,
  ownerSinceRows,
  ownerUnchangedLine,
  ownerWrittenLabel,
  sinceHeading,
  sinceTable,
  writtenRows,
  OWNER_WRITTEN_NOT_YET_SENTENCE,
  OWNER_WRITTEN_OMISSION_SENTENCE,
  WRITTEN_EMPTY_SENTENCE,
  type FactsRow,
} from "../services/seo-since";

export type SeoPrintData =
  | { unlocked: false }
  | (DashboardSource & { unlocked: true; producedAt: string });

/**
 * Black on white, A4, one column. No colour is used to carry anything: a
 * report is photocopied, faxed and printed on a mono laser, and the screen's
 * own rule - colour reinforces, never carries - is stricter still on paper.
 */
const CSS = `
.avp { max-width: 900px; margin: 0 auto; padding: 16px; color: #111; background: #fff;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 13px; line-height: 1.45; }
.avp h1 { font-size: 20px; margin: 0 0 4px; }
.avp h2 { font-size: 15px; margin: 0 0 6px; }
.avp h3 { font-size: 13px; margin: 12px 0 4px; }
.avp p { margin: 0 0 6px; }
.avp .sub { color: #555; }
.avp .method { color: #555; font-size: 11px; margin: 4px 0 0; }
.avp section { border: 1px solid #ccc; border-radius: 6px; padding: 12px; margin: 0 0 12px;
  break-inside: avoid; page-break-inside: avoid; }
.avp table { border-collapse: collapse; width: 100%; font-size: 12px; }
.avp th, .avp td { border-bottom: 1px solid #ddd; padding: 4px 6px; text-align: left;
  vertical-align: top; }
.avp th { font-weight: 600; }
.avp .num { text-align: right; white-space: normal; }
.avp .fig { font-size: 22px; font-weight: 600; }
.avp .figrow { display: flex; flex-wrap: wrap; gap: 16px; }
.avp .figrow > div { flex: 1 1 200px; }
.avp .noprint { margin: 0 0 12px; }
.avp .lead { margin: 0 0 8px; }
@page { margin: 12mm; }
@media print {
  /* Tighter on paper than on screen, and each section its own unsplittable
     unit. Nothing splits; what changed is that the units are small enough to
     pack two or three to a page instead of one. */
  .avp { max-width: none; padding: 0; font-size: 9.5pt; line-height: 1.3; }
  .avp .noprint { display: none !important; }
  .avp h1 { font-size: 15pt; }
  .avp h2, .avp h3 { font-size: 10.5pt; margin: 0 0 4px; }
  .avp p { margin: 0 0 4px; }
  .avp .method { font-size: 8pt; }
  .avp .fig { font-size: 16pt; }
  .avp table { font-size: 8.5pt; }
  .avp th, .avp td { padding: 2px 4px; }
  .avp section { border: 1px solid #999; padding: 7px; margin: 0 0 7px; }
  /* A heading may not be the last thing on a page, and a paragraph may not
     leave one line behind. Neither rule splits a card; both stop a page
     ending on something that reads as an accident. */
  .avp h1, .avp h2, .avp h3 { break-after: avoid; page-break-after: avoid; }
  .avp p { orphans: 2; widows: 2; }
}
`;

/** The button and the sentence that has to stand in for it when it is ignored. */
function PrintControls() {
  return (
    <div className="noprint">
      <button type="button" onClick={() => window.print()}>
        Print this report, or save it as a PDF
      </button>
      <p className="method">
        This app runs inside a frame in your Shopify admin, and some browsers refuse a print
        dialog started from inside one. If nothing happens: right-click anywhere on this report
        and choose "Print frame", or open this page in its own tab from your browser menu. The
        page you are looking at is the report; nothing else has to run for it to print.
      </p>
    </div>
  );
}

/**
 * The headline strip. The same rule as the screen: tiles only once a product
 * has been fully checked, one sentence otherwise. It used to print
 * `figures.slice(0, 4)`, which on an empty store was four tiles of "0 of 0"
 * and on a store with no page read was three of the four groups (R2-09,
 * R2-10).
 */
function Figures({ data }: { data: DashboardSource }) {
  const derived = dashboardDerived(data);
  const figures = keyFigures(data, derived).filter((f) => f.strip);
  const sentence = stripSentence(data);
  if (sentence !== null || figures.length === 0) {
    return (
      <section>
        <h2>Where this shop stands today</h2>
        <p className="sub">{sentence ?? nothingGroupedSentence("paper")}</p>
      </section>
    );
  }
  return (
    <section>
      <h2>Where this shop stands today</h2>
      <div className="figrow">
        {figures.map((f) => (
          <div key={f.key}>
            {/* The count and what it is out of on one line, as the screen's
                tile prints them, so "24 of 50" is a token on both surfaces. */}
            <div>
              <span className="fig">{f.value}</span>
              {f.of === null ? null : <span className="sub"> {f.of}</span>}
            </div>
            <div>{f.label}</div>
            <p className="method">{f.method}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Groups({ readiness }: { readiness: Readiness }) {
  // No read set, no groups: the screen prints one sentence in this state and
  // the report used to print four empty groups headed "0 of 0" (R2-09).
  if (readiness.readSet === 0) {
    return (
      <section>
        <h2>What to do, and who does it</h2>
        <p className="sub">{nothingGroupedSentence("paper")}</p>
      </section>
    );
  }
  return (
    <>
      <p className="lead">
        <b>What to do, and who does it.</b> Every group is open here; on the screen they fold
        away. A product is counted once, under the owner of its most immediate problem.
      </p>
      {readiness.groups.map((group) => (
        // One section per group rather than one section around all four. The
        // rule that a card is never split down the middle is right and stays,
        // but a single unsplittable block the height of four groups cannot
        // share a page with anything, so it takes a fresh page and leaves
        // whatever was above it half empty. Smaller unsplittable units pack.
        <section key={group.group}>
          <h3>
            {group.title} - {formatCount(group.count)} of {formatCount(group.denominator)}
          </h3>
          <p className="sub">{group.summary}</p>
          {group.rows.length === 0 ? null : (
            <table>
              <thead>
                <tr>
                  <th>What we found</th>
                  <th className="num">Products</th>
                  <th>Who does it</th>
                  <th>Why it matters, and where it is done</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.code}>
                    <td>{row.label}</td>
                    <td className="num">
                      {formatCount(row.count)} of {formatCount(row.denominator)}
                    </td>
                    <td>{groupWordFor(row.code)}</td>
                    <td>
                      {row.what} {row.where}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {group.scope ? <p className="method">{group.scope}</p> : null}
          {group.foot ? <p className="method">{group.foot}</p> : null}
        </section>
      ))}
    </>
  );
}

function ShopWide({ data }: { data: DashboardSource }) {
  const derived = dashboardDerived(data);
  if (derived.wide.length === 0) return null;
  return (
    <section>
      <h2>{shopWideHeading(derived.wide.length)}</h2>
      <table>
        <thead>
          <tr>
            <th>The fix</th>
            <th>Who does it</th>
            <th>Why it matters, why it is happening, and where it is done</th>
            <th>What it covers</th>
          </tr>
        </thead>
        <tbody>
          {derived.wide.map((item) => (
            <tr key={item.key}>
              <td>{item.title}</td>
              <td>{item.ownerNote}</td>
              <td>
                {item.what} {item.why ?? ""} {item.where}
              </td>
              <td>{item.appliesTo}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Listing({ data }: { data: DashboardSource }) {
  const derived = dashboardDerived(data);
  const listing = derived.listing;
  const figures = keyFigures(data, derived);
  const method = figures.find((f) => f.key === "listing");
  if (listing.unmeasured) {
    // The same sentence the screen shows, from the same constant. Ten rows of
    // "not counted yet" would be ten fabricated rows on a page somebody hands
    // to a developer.
    return (
      <section>
        <h2>What Google asks for on a product listing</h2>
        <p className="sub">{listingUnmeasuredSentence("paper")}</p>
      </section>
    );
  }
  return (
    <section>
      <h2>What Google asks for on a product listing</h2>
      <table>
        <thead>
          <tr>
            <th>What Google asks for</th>
            <th>How strongly Google asks for it</th>
            <th className="num">Products that have it</th>
            <th>Where the figure comes from</th>
          </tr>
        </thead>
        <tbody>
          {listing.properties.map((p) => (
            <tr key={p.key}>
              <td>{p.label}</td>
              <td>{p.requirement}</td>
              <td className="num">
                {p.have === null
                  ? (p.note ?? "Not counted yet")
                  : `${formatCount(p.have)}${p.of === null ? "" : ` of ${formatCount(p.of)}`}`}
              </td>
              {/* BASIS_WORD is a Record over the basis union, so a value it
                  does not cover fails typecheck. This cell printed
                  "byConstruction" and "notPublished" because it translated one
                  value and passed the rest through. */}
              <td>{BASIS_WORD[p.basis]}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {method ? <p className="method">{method.method}</p> : null}
    </section>
  );
}

function Since({ before, today }: { before: FactsRow | null; today: FactsRow | null }) {
  if (!before) {
    return (
      <section>
        <h2>What has changed since we started</h2>
        <p className="sub">{ownerNoSnapshotSentence("paper")}</p>
      </section>
    );
  }
  const table = sinceTable(before, today);
  const rows = ownerSinceRows(table);
  const unchanged = ownerUnchangedLine(table);
  const written = writtenRows(before, today);
  const namedWritten =
    written === null
      ? null
      : written
          .map((row) => ({ row, label: ownerWrittenLabel(row) }))
          .filter((r): r is { row: (typeof written)[number]; label: string } => r.label !== null);
  return (
    <section>
      <h2>{sinceHeading(before)}</h2>
      <p className="method">{ownerSinceMethodLine(before, today)}</p>
      {rows.length === 0 ? (
        <p className="sub">Nothing has moved yet.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Products that have</th>
              <th className="num">Then</th>
              <th className="num">Now</th>
              <th className="num">Change</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.ownerLabel}</td>
                <td className="num">{ownerFigure(row.before, row.beforeDenominator)}</td>
                <td className="num">
                  {row.today === null ? "not read" : ownerFigure(row.today, row.todayDenominator)}
                </td>
                <td className="num">{differenceLabel(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {/* The screen says how many figures did not move and what this app
          wrote since the start; the report printed the moved rows and nothing
          else, so a reader could not tell whether a lone row was the only
          figure or the only one that moved (R2-29). */}
      {unchanged ? <p className="sub">{unchanged}</p> : null}
      <h3>Written by this app since then</h3>
      {namedWritten === null ? (
        <p className="sub">{OWNER_WRITTEN_NOT_YET_SENTENCE}</p>
      ) : namedWritten.length === 0 ? (
        <p className="sub">{WRITTEN_EMPTY_SENTENCE}</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>What this app wrote</th>
              <th className="num">Count</th>
            </tr>
          </thead>
          <tbody>
            {namedWritten.map(({ row, label }) => (
              <tr key={row.key}>
                <td>{label}</td>
                <td className="num">{formatCount(row.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="method">{OWNER_WRITTEN_OMISSION_SENTENCE}</p>
    </section>
  );
}

/**
 * What the rows in one column are normally counted against: the catalogue read
 * for the admin side, the pages that answered for the page side. A row whose
 * own denominator differs says so on its own line - see rowScopeNote.
 */
function columnDenominator(source: "A" | "B", data: DashboardSource): number {
  return source === "A" ? data.findings.bulkRead : data.findings.pagesRead;
}

/** The two columns of the findings card, as one table each, with the accounting. */
function Checks({ data }: { data: DashboardSource }) {
  const shopWide = new Set<string>(data.readiness.shopWideCodes);
  const found = data.findings.rows.filter(
    (r) => r.state === "found" && !shopWide.has(r.code),
  );
  const sides: { source: "A" | "B"; title: string; rows: CheckRow[] }[] = [
    {
      source: "A",
      title: "Found in your Shopify admin",
      rows: found.filter((r) => r.source === "A"),
    },
    {
      source: "B",
      title: "Found by reading your pages",
      rows: found.filter((r) => r.source === "B"),
    },
  ];
  const ctx = paperContext(data, dashboardDerived(data));
  return (
    <>
      <p className="lead">
        <b>Every check, and what it found.</b> Two reads, counted apart: what your Shopify admin
        holds, and what a crawler sees when it opens a page.
      </p>
      {sides.map((side) => {
        const account = columnAccount({
          source: side.source,
          rows: data.findings.rows,
          clean: data.findings.clean,
          shopWideCodes: data.readiness.shopWideCodes,
          // On paper the shop-wide table is above these lines, the counts
          // with no verdict are not printed, and neither collections nor blog
          // posts have a total here.
          ctx: { ...ctx, shopWide: ctx.shopWide ? "above" : null },
        });
        return (
          <section key={side.source}>
            <h3>{side.title}</h3>
            {side.rows.length === 0 ? null : (
              <table>
                <thead>
                  <tr>
                    <th>What we looked for</th>
                    <th className="num">Products affected</th>
                    <th>Who does it</th>
                  </tr>
                </thead>
                <tbody>
                  {side.rows.map((row) => (
                    <tr key={row.code}>
                      {/* OWNER_LABEL, never row.label. row.label is
                          CHECK_LABEL, the operator's wording, and this table
                          printed "Open Graph tags absent" and "The first image
                          on the page is lazy-loaded" on a document a merchant
                          hands to a client. The group tables above always read
                          this record; this one did not. */}
                      <td>{OWNER_LABEL[row.code]}</td>
                      <td className="num">
                        {formatCount(row.count)} of {formatCount(row.denominator)}
                      </td>
                      <td>{groupWordFor(row.code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {side.rows
              .map((row) => rowScopeNote(row, columnDenominator(side.source, data)))
              .filter((note): note is string => note !== null)
              .map((note) => (
                <p key={note} className="method">
                  {note}
                </p>
              ))}
            {account.lines.map((line) => (
              <p key={line} className="method">
                {line}
              </p>
            ))}
          </section>
        );
      })}
    </>
  );
}

export function SeoPrintReport({ data }: { data: SeoPrintData }) {
  if (!data.unlocked) {
    return (
      <div className="avp">
        <style>{CSS}</style>
        <p>
          This report is part of the SEO module, which is switched on per shop. It is not enabled
          for this one.
        </p>
      </div>
    );
  }

  return (
    <div className="avp">
      <style>{CSS}</style>
      <h1>Your shop, as a search engine reads it</h1>
      <p className="sub">{reportHeading(data, new Date(data.producedAt))}</p>
      <p className="method">
        {data.readiness.lastPageReadAt
          ? `Product pages last read ${formatDay(data.readiness.lastPageReadAt)}.`
          : "No product page has been read yet."}{" "}
        {/* The cause, when the shop's own settings are it: the document a
            merchant hands to a developer used to omit the one fact the
            developer needs (R2-19). */}
        {data.blockedBy
          ? `${pagesReadSentence(data.findings, 0, data.blockedBy, "merchant")} `
          : ""}
        {data.published.at
          ? `The theme was last read ${formatDay(data.published.at)}.`
          : "The theme has not been read yet."}{" "}
        Every figure below carries the denominator it was measured over, and a check that could
        not run says so rather than showing a zero.
      </p>

      <PrintControls />

      <Figures data={data} />
      <Groups readiness={data.readiness} />
      <ShopWide data={data} />
      <Listing data={data} />
      <Checks data={data} />
      <Since before={data.since.before} today={data.since.today} />
    </div>
  );
}
