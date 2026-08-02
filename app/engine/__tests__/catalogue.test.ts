// PHASE-2-SPEC §8.4 — a real-catalogue smoke run.
//
// 20 descriptions sampled from the 355 furniture products loaded into
// mrdigital-dev. No network: the sample is checked in. The point is not to
// assert exact values (prose varies), it is to prove the engine never
// publishes a sentence fragment on copy nobody wrote for it.

import { describe, expect, it } from "vitest";
import catalogue from "./catalogue.fixture.json";
import { extractFromText } from "../extract";
import { normalize, prepareText } from "../normalize";
import { stopwordSet } from "../stopwords";

// A Romanian furniture dictionary — terms must match the language the
// descriptions are written in, which is exactly what onboarding will ask for.
const DICTIONARY = [
  "Material: PAL, PAL melaminat, MDF, lemn masiv, stejar, nuc, fag, sticla securizata, sticla, metal, inox, otel, marmura, piele ecologica, piele, textil, catifea, burete, plastic",
  "Finisaj: lacuit, vopsit, mat, lucios, natural, periat, auriu, argintiu, cromat",
  "Stil: modern, scandinav, industrial, clasic, rustic, minimalist, vintage, retro, contemporan",
  "Dimensiuni: #size",
  "Capacitate: * scaune, * persoane, * locuri, * sertare, * rafturi, * usi",
  "Functionalitate: extensibil, extensibila, pliabil, pliabila, rabatabil, reglabil, modular, mecanism *",
  "Camera: sufragerie, dormitor, bucatarie, living, birou, hol, baie, terasa",
].join("\n");

const stops = stopwordSet();

const results = (catalogue as { title: string; body: string }[]).map((p) => ({
  title: p.title,
  facts: extractFromText(prepareText(p.title, p.body), DICTIONARY),
}));

describe("real furniture catalogue", () => {
  it("extracts something from most products", () => {
    const withFacts = results.filter((r) => r.facts.length > 0).length;
    expect(withFacts).toBeGreaterThanOrEqual(results.length * 0.8);
  });

  it("never publishes a value containing a stopword", () => {
    const leaks: string[] = [];
    for (const { title, facts } of results) {
      for (const fact of facts) {
        // #size values are measurements, not phrases: "l 80" legitimately
        // contains no words at all, so only phrase-bearing labels are checked.
        if (fact.k === "Dimensiuni") continue;
        for (const value of fact.v.split(", ")) {
          for (const word of normalize(value).split(" ")) {
            if (stops.has(word)) leaks.push(`${title} → ${fact.k}: ${value}`);
          }
        }
      }
    }
    expect(leaks).toEqual([]);
  });

  it("never publishes an empty or punctuation-only value", () => {
    const bad = results.flatMap((r) =>
      r.facts.filter((f) => f.v.trim() === "" || /^[\s,.;:-]+$/.test(f.v)),
    );
    expect(bad).toEqual([]);
  });

  it("caps every label at four values", () => {
    for (const { facts } of results) {
      for (const fact of facts) {
        expect(fact.v.split(", ").length).toBeLessThanOrEqual(4);
      }
    }
  });

  it("reads dimensions where the copy states them", () => {
    const withDimensions = results.filter((r) =>
      r.facts.some((f) => f.k === "Dimensiuni" && /\d/.test(f.v)),
    ).length;
    expect(withDimensions).toBeGreaterThan(0);
  });
});
