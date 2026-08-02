/** The minimum an engine caller must supply. Deliberately not a Shopify type. */
export type ProductLike = {
  title: string;
  descriptionHtml?: string | null;
};
