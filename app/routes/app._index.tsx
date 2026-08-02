import type { LoaderFunctionArgs } from "@remix-run/node";
import { useLoaderData } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Thumbnail,
  Text,
  Badge,
  EmptyState,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";

// PHASE-1-SPEC §5: one page, first 50 products, no actions. Proves embedded
// auth + GraphQL work. Everything else comes in later phases.

const PRODUCTS = `#graphql
  query FirstProducts {
    products(first: 50) {
      nodes {
        id
        title
        status
        featuredMedia {
          preview { image { url altText } }
        }
      }
    }
  }
`;

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const res = await admin.graphql(PRODUCTS);
  const json = await res.json();
  return { products: json.data?.products?.nodes ?? [] };
};

type ProductRow = {
  id: string;
  title: string;
  status: string;
  featuredMedia?: { preview?: { image?: { url: string; altText?: string } } };
};

export default function Index() {
  const { products } = useLoaderData<typeof loader>() as { products: ProductRow[] };

  return (
    <Page title="Products">
      <Card padding="0">
        {products.length === 0 ? (
          <EmptyState
            heading="No products yet"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <p>Import a catalogue to get started.</p>
          </EmptyState>
        ) : (
          <IndexTable
            resourceName={{ singular: "product", plural: "products" }}
            itemCount={products.length}
            selectable={false}
            headings={[{ title: "" }, { title: "Title" }, { title: "Status" }]}
          >
            {products.map((p, i) => (
              <IndexTable.Row id={p.id} key={p.id} position={i}>
                <IndexTable.Cell>
                  <Thumbnail
                    source={p.featuredMedia?.preview?.image?.url ?? ""}
                    alt={p.featuredMedia?.preview?.image?.altText ?? ""}
                    size="small"
                  />
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Text as="span" variant="bodyMd" fontWeight="semibold">
                    {p.title}
                  </Text>
                </IndexTable.Cell>
                <IndexTable.Cell>
                  <Badge tone={p.status === "ACTIVE" ? "success" : "info"}>
                    {p.status.toLowerCase()}
                  </Badge>
                </IndexTable.Cell>
              </IndexTable.Row>
            ))}
          </IndexTable>
        )}
      </Card>
    </Page>
  );
}
