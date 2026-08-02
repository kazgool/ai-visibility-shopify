// Metafield definitions, created once per shop on install (PHASE-1-SPEC §4).
// Namespace $app resolves to our app-reserved namespace; definitions survive
// uninstall on purpose — the data belongs to the merchant (PRD §4.1).

const DEFINITIONS = [
  { key: "summary", type: "multi_line_text_field", name: "AI summary" },
  { key: "facts", type: "json", name: "Comparable attributes" },
  { key: "questions", type: "json", name: "Starter questions" },
  { key: "fit_for", type: "single_line_text_field", name: "Who it suits" },
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

const EXISTING = `#graphql
  query ExistingDefinitions {
    metafieldDefinitions(first: 20, ownerType: PRODUCT, namespace: "$app") {
      nodes { key }
    }
  }
`;

type AdminGraphql = (query: string, options?: { variables?: object }) => Promise<Response>;

export async function ensureMetafieldDefinitions(graphql: AdminGraphql) {
  const existingRes = await graphql(EXISTING);
  const existing = await existingRes.json();
  const have = new Set<string>(
    existing.data?.metafieldDefinitions?.nodes?.map((n: { key: string }) => n.key) ?? [],
  );

  for (const def of DEFINITIONS) {
    if (have.has(def.key)) continue;
    const res = await graphql(CREATE, {
      variables: {
        definition: {
          key: def.key,
          name: def.name,
          type: def.type,
          namespace: "$app",
          ownerType: "PRODUCT",
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
  }
}
