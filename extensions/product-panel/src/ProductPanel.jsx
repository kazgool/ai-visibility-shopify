// The WP metabox, translated to Shopify: a card on the product page in the
// admin showing what this app has published for the product - attributes,
// summary, buyer questions - and whether each field is automatic or a
// person's work. Read only: editing happens in the app's own editor, one
// click away, where the protection rules are enforced and explained.

import {
  reactExtension,
  useApi,
  AdminBlock,
  BlockStack,
  InlineStack,
  Text,
  Badge,
  Link,
} from "@shopify/ui-extensions-react/admin";
import { useEffect, useState } from "react";

const TARGET = "admin.product-details.block.render";

export default reactExtension(TARGET, () => <ProductPanel />);

const QUERY = `#graphql
  query PanelData($id: ID!) {
    product(id: $id) {
      metafields(namespace: "$app", first: 6) {
        nodes { key value }
      }
    }
  }
`;

function parse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ProductPanel() {
  const { data } = useApi(TARGET);
  const [state, setState] = useState({ loading: true });

  const productId = data?.selected?.[0]?.id;

  useEffect(() => {
    if (!productId) return;
    (async () => {
      try {
        const res = await fetch("shopify:admin/api/graphql.json", {
          method: "POST",
          body: JSON.stringify({ query: QUERY, variables: { id: productId } }),
        });
        const json = await res.json();
        const nodes = json.data?.product?.metafields?.nodes ?? [];
        const byKey = new Map(nodes.map((n) => [n.key, n.value]));
        setState({
          loading: false,
          facts: parse(byKey.get("facts") ?? "[]", []),
          questions: parse(byKey.get("questions") ?? "[]", []),
          summary: byKey.get("summary") ?? "",
          fitFor: byKey.get("fit_for") ?? "",
          fieldState: parse(byKey.get("state") ?? "{}", {}),
        });
      } catch {
        setState({ loading: false, error: true });
      }
    })();
  }, [productId]);

  if (state.loading) {
    return (
      <AdminBlock title="AI Visibility">
        <Text>Reading what is published for this product...</Text>
      </AdminBlock>
    );
  }

  if (state.error) {
    return (
      <AdminBlock title="AI Visibility">
        <Text>Could not read this product's data. Open the app and try again.</Text>
      </AdminBlock>
    );
  }

  const { facts, questions, summary, fitFor, fieldState } = state;
  const productNumericId = String(productId).split("/").pop();

  if (!facts.length && !summary && !questions.length) {
    return (
      <AdminBlock title="AI Visibility">
        <BlockStack gap="base">
          <Text>
            Nothing published yet. If the description mentions material, size or
            colour, a catalogue pass will pick them up.
          </Text>
          <Link to={`app://app/products/${productNumericId}`}>Open in AI Visibility</Link>
        </BlockStack>
      </AdminBlock>
    );
  }

  // A value whose state entry says "human" is a person's work; the app will
  // never overwrite it. Everything else is automatic and refreshes with the
  // description.
  const human = (key) => fieldState?.[key]?.source === "human";

  return (
    <AdminBlock title="AI Visibility">
      <BlockStack gap="base">
        {facts.length > 0 ? (
          <BlockStack gap="small">
            <InlineStack gap="small" blockAlignment="center">
              <Text fontWeight="bold">Attributes</Text>
              <Badge tone={human("facts") ? "attention" : "success"}>
                {human("facts") ? "Edited by you" : "Automatic"}
              </Badge>
            </InlineStack>
            <Text>{facts.map((f) => `${f.k}: ${f.v}`).join(" - ")}</Text>
          </BlockStack>
        ) : null}

        {summary ? (
          <BlockStack gap="small">
            <InlineStack gap="small" blockAlignment="center">
              <Text fontWeight="bold">Summary</Text>
              <Badge tone={human("summary") ? "attention" : "success"}>
                {human("summary") ? "Edited by you" : "Automatic"}
              </Badge>
            </InlineStack>
            <Text>
              {/* The admin gives blocks a height budget; the full text lives
                  one click away in the app. */}
              {summary.length > 180 ? `${summary.slice(0, 180)}...` : summary}
            </Text>
          </BlockStack>
        ) : null}

        {questions.length > 0 ? (
          <BlockStack gap="small">
            <Text fontWeight="bold">Buyer questions</Text>
            {questions.map((qa, i) => {
              const line = `${qa.q} ${qa.a}`;
              return (
                <Text key={i}>{line.length > 90 ? `${line.slice(0, 90)}...` : line}</Text>
              );
            })}
          </BlockStack>
        ) : null}

        {fitFor ? <Text>{`Suits: ${fitFor}`}</Text> : null}

        <Link to={`app://app/products/${productNumericId}`}>
          Edit in AI Visibility
        </Link>
      </BlockStack>
    </AdminBlock>
  );
}
