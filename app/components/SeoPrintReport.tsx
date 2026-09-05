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
  type Readiness,
} from "../services/seo-readiness";
import {
  dashboardDerived,
  keyFigures,
  reportHeading,
  LISTING_UNMEASURED_SENTENCE,
  type DashboardSource,
} from "../services/seo-report";
import type { CheckRow } from "../services/seo-aggregate";
import {
  differenceLabel,
  figure,
  formatDay,
  ownerFigureLabel,
  ownerSinceRows,
  sinceHeading,
  sinceMethodLine,
  sinceTable,
  NO_SNAPSHOT_SENTENCE,
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
@page { margin: 14mm; }
@media print {
  .avp { max-width: none; padding: 0; font-size: 11px; }
  .avp .noprint { display: none !important; }
  .avp section { border: 1px solid #999; }
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

function Figures({ data }: { data: DashboardSource }) {
  const derived = dashboardDerived(data);
  const figures = keyFigures(data, derived);
  return (
    <section>
      <h2>Where this shop stands</h2>
      <div className="figrow">
        {figures.slice(0, 4).map((f) => (
          <div key={f.key}>
            <div className="fig">{f.value}</div>
            <div>{f.label}</div>
            {f.of === null ? null : <div className="sub">{f.of}</div>}
            <p className="method">{f.method}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function Groups({ readiness }: { readiness: Readiness }) {
  return (
    <section>
      <h2>What to do, by who does it</h2>
      <p className="sub">
        Every group is open here; on the screen they fold away. A product is counted once, under
        the owner of its most immediate problem.
      </p>
      {readiness.groups.map((group) => (
        <div key={group.group}>
          <h3>
            {group.title} - {group.count} of {group.denominator}
          </h3>
          <p className="sub">{group.summary}</p>
          {group.rows.length === 0 ? null : (
            <table>
              <thead>
                <tr>
                  <th>What we found</th>
                  <th className="num">Products</th>
                  <th>Whose it is</th>
                  <th>Why it matters, and where it is done</th>
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.code}>
                    <td>{row.label}</td>
                    <td className="num">
                      {row.count} of {row.denominator}
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
          {group.foot ? <p className="method">{group.foot}</p> : null}
        </div>
      ))}
    </section>
  );
}

function ShopWide({ data }: { data: DashboardSource }) {
  const derived = dashboardDerived(data);
  if (derived.wide.length === 0) return null;
  return (
    <section>
      <h2>Fixes that cover the whole shop</h2>
      <table>
        <thead>
          <tr>
            <th>The fix</th>
            <th>Whose it is</th>
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
        <p className="sub">{LISTING_UNMEASURED_SENTENCE}</p>
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
            <th>How much it asks</th>
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
                  : `${p.have}${p.of === null ? "" : ` of ${p.of}`}`}
              </td>
              <td>{p.basis === "measured" ? "Counted from your catalogue" : p.basis}</td>
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
        <p className="sub">{NO_SNAPSHOT_SENTENCE}</p>
      </section>
    );
  }
  const rows = ownerSinceRows(sinceTable(before, today));
  return (
    <section>
      <h2>{sinceHeading(before)}</h2>
      <p className="method">{sinceMethodLine(before, today)}</p>
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
                <td>{ownerFigureLabel(row)}</td>
                <td className="num">{figure(row.before, row.beforeDenominator)}</td>
                <td className="num">
                  {row.today === null ? "not read" : figure(row.today, row.todayDenominator)}
                </td>
                <td className="num">{differenceLabel(row)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
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
  return (
    <section>
      <h2>The detail behind those products</h2>
      {sides.map((side) => {
        const account = columnAccount({
          source: side.source,
          rows: data.findings.rows,
          clean: data.findings.clean,
          shopWideCodes: data.readiness.shopWideCodes,
        });
        return (
          <div key={side.source}>
            <h3>{side.title}</h3>
            {side.rows.length === 0 ? null : (
              <table>
                <thead>
                  <tr>
                    <th>What we looked for</th>
                    <th className="num">Products affected</th>
                    <th>Whose it is</th>
                  </tr>
                </thead>
                <tbody>
                  {side.rows.map((row) => (
                    <tr key={row.code}>
                      <td>{row.label}</td>
                      <td className="num">
                        {row.count} of {row.denominator}
                      </td>
                      <td>{groupWordFor(row.code)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {account.lines.map((line) => (
              <p key={line} className="method">
                {line}
              </p>
            ))}
          </div>
        );
      })}
    </section>
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
