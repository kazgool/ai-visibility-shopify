// DICTIONARY-PORT §12. The contract with the WordPress engine.
// Fixture texts are copied byte-for-byte from tests/smoke-test.php.
// A failure here means the port has drifted from proven behaviour.

import { describe, expect, it } from "vitest";
import { extractFromText } from "../extract";
import { DEFAULT_DICTIONARY } from "../dictionary";
import { normalize, prepareText } from "../normalize";

function valuesOf(facts: { k: string; v: string }[]) {
  return Object.fromEntries(facts.map((f) => [f.k, f.v]));
}

describe("Fixture A — bridal, built-in English dictionary", () => {
  const text = prepareText(
    "Lidia — short wedding dress with appliqué",
    "Price 1800 lei. A mini civil ceremony dress made entirely of Chantilly lace, with " +
      "hand-sewn 3D flowers. Fitted silhouette, spaghetti straps and a square neckline. Open back with a " +
      "lace-up corset. Ivory, with a detachable train.",
  );
  const values = valuesOf(extractFromText(text, DEFAULT_DICTIONARY));

  it("finds the material", () => {
    expect(values.Material).toBeDefined();
  });

  it("longer term wins over shorter", () => {
    expect(values.Material.toLowerCase()).toContain("chantilly");
  });

  it("finds the neckline through a wildcard", () => {
    expect(values.Neckline).toBeDefined();
  });

  it("wildcard captures the following words", () => {
    expect(values.Neckline.toLowerCase()).toContain("square");
  });

  it("finds the back through a wildcard", () => {
    expect(values.Back).toBeDefined();
  });
});

describe("Fixture B — Romanian dictionary, diacritics both ways", () => {
  const dictionary = [
    "Material: dantelă, dantelă Chantilly, tul, satin",
    "Croială: croială *, siluetă *, cambrată",
    "Decolteu: decolteu *",
  ].join("\n");

  const text = prepareText(
    "Nicolette",
    "Rochie din dantela Chantilly, siluetă cambrată, decolteu drept. Pret 3900 lei.",
  );
  const values = valuesOf(extractFromText(text, dictionary));

  it("a translated dictionary matches translated content", () => {
    expect(values.Material).toBeDefined();
  });

  it("diacritics are ignored in both directions", () => {
    expect(values["Croială"]).toBeDefined();
  });

  it("wildcards work in any language", () => {
    expect(values.Decolteu?.toLowerCase()).toContain("drept");
  });
});

describe("Fixture C — live furniture copy, the hard one", () => {
  const dictionary = [
    "Material: PAL, sticlă securizată, inox, piele ecologică, plastic, burete",
    "Tip: masă *, scaun *, set *",
    "Dimensiuni: #size",
    "Capacitate: * scaune, * persoane, * locuri",
    "Funcționalitate: extensibil, extensibilă, pliabil, mecanism *",
  ].join("\n");

  const text = prepareText(
    "Set Masa extensibila & 6 Scaune",
    "Masa are blatul din PAL Laminat peste care s-a fixat sticla securizata de 4 mm. " +
      "Extinderea mesei se face prin tragerea extensiei pe un mecanism mecanic aflat sub blatul mesei. " +
      "Scaunele au cadru din inox, sezutul este tapitat cu burete si piele ecologica. " +
      "Dimensiuni: -Masa: l 80, L 130, h 79 cm -Scaune: adancime 50, h scaun 94 cm. " +
      "Setul se livreaza demontat, instructiunile de montaj se gasesc in interiorul coletului.",
  );
  const facts = extractFromText(text, dictionary);
  const values = valuesOf(facts);

  it("exact terms still match inside prose", () => {
    expect(values.Material?.toLowerCase()).toContain("inox");
  });

  it("diacritic duplicates are collapsed", () => {
    const occurrences = normalize(values.Material ?? "").split("piele ecologica").length - 1;
    expect(occurrences).toBeLessThanOrEqual(1);
  });

  it("measurements are read as measurements", () => {
    expect(values.Dimensiuni).toContain("130");
  });

  it("a count before the noun is captured", () => {
    expect(values.Capacitate?.toLowerCase()).toContain("6 scaune");
  });

  it("sentence fragments are never published as attributes", () => {
    const junk = ["are blatul", "cat si", "se gasesc", "aflat sub", "se face"];
    const leaks: string[] = [];
    for (const fact of facts) {
      for (const fragment of junk) {
        if (normalize(fact.v).includes(normalize(fragment))) {
          leaks.push(`${fact.k}: ${fact.v}`);
        }
      }
    }
    expect(leaks).toEqual([]);
  });
});
