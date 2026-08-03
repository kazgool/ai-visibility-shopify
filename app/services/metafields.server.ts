// Metafield definitions, created once per shop on install (PHASE-1-SPEC §4).
// Namespace $app resolves to our app-reserved namespace; definitions survive
// uninstall on purpose — the data belongs to the merchant (PRD §4.1).
//
// Storefront access matters: with PUBLIC_READ the merchant's theme (and the
// Storefront API, and Shopify's own agent surfaces) can read our data without
// this app running. That is the whole "your data stays yours" promise, so it
// is repaired on every install, not only on the first one.

const DEFINITIONS = [
  { key: "summary", type: "multi_line_text_field", name: "AI summary" },
  { key: "facts", type: "json", name: "Comparable attributes" },
  { key: "questions", type: "json", name: "Starter questions" },
  { key: "fit_for", type: "single_line_text_field", name: "Who it suits" },
  { key: "state", type: "json", name: "AI Visibility state" },
] as const;

// Collections carry the listing-page answer: what kinds exist and how to
// choose between them (PRD §4.8). Same namespace, same public read access.
const COLLECTION_DEFINITIONS = [
  { key: "summary", type: "multi_line_text_field", name: "AI summary" },
  { key: "criteria", type: "json", name: "How to choose" },
  { key: "questions", type: "json", name: "Starter questions" },
  { key: "table", type: "json", name: "Comparison table" },
  { key: "state", type: "json", name: "AI Visibility state" },
] as const;

const CREATE = `#graphql
  mutation CreateDefinition($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition { id key }
      userErrors { field message code }
    }
  }
`;

const UPDATE_ACCESS = `#graphql
  mutation UpdateDefinition($definition: MetafieldDefinitionUpdateInput!) {
    metafieldDefinitionUpdate(definition: $definition) {
      updatedDefinition { id key }
      userErrors { field message code }
    }
  }
`;

const EXISTING = `#graphql
  query ExistingDefinitions($ownerType: MetafieldOwnerType!) {
    metafieldDefinitions(first: 20, ownerType: $ownerType, namespace: "$app") {
      nodes {
        key
        access { storefront }
      }
    }
  }
`;

type AdminGraphql = (query: string, options?: { variables?: object }) => Promise<Response>;

// Variants hold only what distinguishes them from their siblings (PRD §5.4):
// the option pairs as facts, plus provenance.
const VARIANT_DEFINITIONS = [
  { key: "facts", type: "json", name: "Comparable attributes" },
  { key: "state", type: "json", name: "AI Visibility state" },
] as const;

export async function ensureMetafieldDefinitions(graphql: AdminGraphql) {
  await ensureFor(graphql, "PRODUCT", DEFINITIONS);
  await ensureFor(graphql, "COLLECTION", COLLECTION_DEFINITIONS);
  await ensureFor(graphql, "PRODUCTVARIANT", VARIANT_DEFINITIONS);
}

async function ensureFor(
  graphql: AdminGraphql,
  ownerType: "PRODUCT" | "COLLECTION" | "PRODUCTVARIANT",
  definitions: readonly { key: string; type: string; name: string }[],
) {
  const existingRes = await graphql(EXISTING, { variables: { ownerType } });
  const existing = await existingRes.json();
  const nodes: { key: string; access?: { storefront?: string } }[] =
    existing.data?.metafieldDefinitions?.nodes ?? [];
  const byKey = new Map(nodes.map((n) => [n.key, n]));

  for (const def of definitions) {
    const found = byKey.get(def.key);

    if (!found) {
      const res = await graphql(CREATE, {
        variables: {
          definition: {
            key: def.key,
            name: def.name,
            type: def.type,
            namespace: "$app",
            ownerType,
            access: { storefront: "PUBLIC_READ" },
          },
        },
      });
      const json = await res.json();
      const errors = json.data?.metafieldDefinitionCreate?.userErrors ?? [];
      // TAKEN = created concurrently; anything else is a real problem.
      const real = errors.filter((e: { code?: string }) => e.code !== "TAKEN");
      if (real.length) {
        throw new Error(`metafieldDefinitionCreate ${def.key}: ${JSON.stringify(real)}`);
      }
      continue;
    }

    // Repair a definition created before storefront access was requested.
    if (found.access?.storefront !== "PUBLIC_READ") {
      const res = await graphql(UPDATE_ACCESS, {
        variables: {
          definition: {
            key: def.key,
            namespace: "$app",
            ownerType,
            access: { storefront: "PUBLIC_READ" },
          },
        },
      });
      const json = await res.json();
      const errors = json.data?.metafieldDefinitionUpdate?.userErrors ?? [];
      if (errors.length) {
        // Not fatal: the app still works, the theme just cannot read directly.
        console.warn(`metafieldDefinitionUpdate ${def.key}: ${JSON.stringify(errors)}`);
      }
    }
  }
}
