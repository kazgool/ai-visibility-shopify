import type { LoaderFunctionArgs } from "@remix-run/node";
import { Link, useLoaderData, useSearchParams, useNavigation } from "@remix-run/react";
import {
  Page,
  Card,
  IndexTable,
  Thumbnail,
  Text,
  Badge,
  Box,
  BlockStack,
  InlineStack,
  Button,
  Banner,
  Pagination,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { cleanOutput } from "../engine";

// Results nobody can see do not exist (Marius, 3 Aug 2026). The dashboard
// says how much of the catalogue is covered; this screen says which products
// those numbers are made of, one row each, with filters for the three
// questions a merchant actually asks: what is missing, what did I edit, and
// where is alt text still absent.

const PRODUCTS = `#graphql
  query ProductsOverview($cursor: String, $before: String, $query: String) {
    products(first: 25, after: $cursor, before: $before, query: $query, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage hasPreviousPage startCursor endCursor }
      nodes {
        id
        title
        handle
        status
        featuredMedia { preview { image { url } } }
        images(first: 50) { nodes { id altText } }
        metafields(namespace: "$app", first: 6) { nodes { key value } }
      }
    }
  }
`;

type Row = {
  id: string;
  title: string;
  handle: string;
  status: string;
  image: string | null;
  attributes: number;
  questions: number;
  hasSummary: boolean;
  described: number;
  images: number;
  edited: boolean;
  readable: boolean;
};

function parseCount(value: string | undefined): number {
  if (!value) return 0;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin } = await authenticate.admin(request);
  const url = new URL(request.url);
  const cursor = url.searchParams.get("after");
  const before = url.searchParams.get("before");
  const filter = url.searchParams.get("filter") ?? "all";

  const res = await admin.graphql(PRODUCTS, {
    variables: { cursor, before, query: null },
  });
  const json = await res.json();
  const page = json.data?.products;

  const rows: Row[] = (page?.nodes ?? []).map((p: any) => {
    const mf = new Map<string, string>(
      (p.metafields?.nodes ?? []).map((m: any) => [m.key, m.value]),
    );
    let state: Record<string, { source?: string }> = {};
    try {
      state = JSON.parse(mf.get("state") ?? "{}");
    } catch {
      state = {};
    }
    const images = p.images?.nodes ?? [];
    const attributes = parseCount(mf.get("facts"));

    return {
      id: p.id,
      title: cleanOutput(p.title),
      handle: p.handle,
      status: p.status,
      image: p.featuredMedia?.preview?.image?.url ?? null,
      attributes,
      questions: parseCount(mf.get("questions")),
      hasSummary: Boolean(mf.get("summary")),
      described: images.filter((i: any) => (i.altText ?? "").trim() !== "").length,
      images: images.length,
      // Any field a person wrote makes the product theirs, not ours.
      edited: Object.values(state).some((s) => s?.source === "human"),
      // Published means an assistant has something to read on this product.
      readable: attributes > 0 && Boolean(mf.get("summary")),
    };
  });

  const filtered = rows.filter((r) => {
    if (filter === "no_attributes") return r.attributes === 0;
    if (filter === "edited") return r.edited;
    if (filter === "missing_alt") return r.images > 0 && r.described < r.images;
    return true;
  });

  return {
    rows: filtered,
    total: rows.length,
    filter,
    pageInfo: page?.pageInfo ?? null,
  };
};

const FILTERS = [
  { key: "all", label: "All" },
  { key: "no_attributes", label: "Without attributes" },
  { key: "edited", label: "Edited by hand" },
  { key: "missing_alt", label: "Missing image descriptions" },
];

export default function ProductsOverview() {
  const { rows, total, filter, pageInfo } = useLoaderData<typeof loader>() as {
    rows: Row[];
    total: number;
    filter: string;
    pageInfo: any;
  };
  const [params, setParams] = useSearchParams();
  const nav = useNavigation();
  const busy = nav.state !== "idle";

  const setFilter = (key: string) => {
    const next = new URLSearchParams(params);
    if (key === "all") next.delete("filter");
    else next.set("filter", key);
    // A filter applies to the whole catalogue, so paging starts again.
    next.delete("after");
    next.delete("before");
    setParams(next);
  };

  const move = (dir: "after" | "before") => {
    const next = new URLSearchParams(params);
    next.delete("after");
    next.delete("before");
    next.set(dir, dir === "after" ? pageInfo.endCursor : pageInfo.startCursor);
    setParams(next);
  };

  return (
    <Page
      title="Products"
      subtitle="What the app has published for each product, and what it has not."
    >
      <BlockStack gap="400">
        <InlineStack gap="200" wrap>
          {FILTERS.map((f) => (
            <Button
              key={f.key}
              pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
              disabled={busy}
            >
              {f.label}
            </Button>
          ))}
        </InlineStack>

        {rows.length === 0 ? (
          <Banner tone="info">
            <Text as="p">
              {filter === "all"
                ? "No products on this page yet. Run Fill catalogue from the dashboard."
                : "Nothing on this page matches that filter. Try another page or another filter."}
            </Text>
          </Banner>
        ) : (
          <Card padding="0">
            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={rows.length}
              selectable={false}
              headings={[
                { title: "" },
                { title: "Product" },
                { title: "Attributes" },
                { title: "Questions" },
                { title: "Summary" },
                { title: "Image text" },
                { title: "State" },
              ]}
            >
              {rows.map((row, i) => (
                <IndexTable.Row id={row.id} key={row.id} position={i}>
                  <IndexTable.Cell>
                    <Thumbnail source={row.image ?? ""} alt="" size="small" />
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Link to={`/app/products/${row.id.split("/").pop()}`}>
                      <Text as="span" fontWeight="semibold">
                        {row.title}
                      </Text>
                    </Link>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.attributes > 0 ? (
                      <Text as="span">{row.attributes}</Text>
                    ) : (
                      <Text as="span" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.questions > 0 ? (
                      <Text as="span">{row.questions}</Text>
                    ) : (
                      <Text as="span" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    {row.hasSummary ? (
                      <Text as="span">Yes</Text>
                    ) : (
                      <Text as="span" tone="subdued">
                        -
                      </Text>
                    )}
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <Text as="span" tone={row.described < row.images ? "subdued" : undefined}>
                      {row.images === 0 ? "-" : `${row.described}/${row.images}`}
                    </Text>
                  </IndexTable.Cell>
                  <IndexTable.Cell>
                    <InlineStack gap="100">
                      {row.edited ? <Badge tone="attention">Edited</Badge> : null}
                      {row.readable ? (
                        <Badge tone="success">Readable</Badge>
                      ) : (
                        <Badge>Nothing published</Badge>
                      )}
                    </InlineStack>
                  </IndexTable.Cell>
                </IndexTable.Row>
              ))}
            </IndexTable>
          </Card>
        )}

        {pageInfo ? (
          <InlineStack align="center">
            <Pagination
              hasPrevious={pageInfo.hasPreviousPage}
              hasNext={pageInfo.hasNextPage}
              onPrevious={() => move("before")}
              onNext={() => move("after")}
            />
          </InlineStack>
        ) : null}

        <Box paddingBlockStart="200">
          <Text as="p" tone="subdued" variant="bodySm">
            {filter === "all"
              ? `${total} products on this page.`
              : `${rows.length} of ${total} products on this page match.`}
            {" Counts come from the metafields on each product, so they show what is published right now."}
          </Text>
        </Box>
      </BlockStack>
    </Page>
  );
}
