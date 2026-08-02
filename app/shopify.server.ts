import "@shopify/shopify-app-remix/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-remix/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { ensureMetafieldDefinitions } from "./services/metafields.server";

// PHASE-1-SPEC §1: GraphQL Admin API 2026-07 only.
const API_VERSION = "2026-07" as ApiVersion;

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: API_VERSION,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: AppDistribution.AppStore,
  hooks: {
    // Runs after OAuth completes: record the shop, create metafield
    // definitions once (idempotent — PHASE-1-SPEC §4).
    afterAuth: async ({ session, admin }) => {
      const shop = await prisma.shop.upsert({
        where: { domain: session.shop },
        create: { domain: session.shop },
        update: { uninstalledAt: null },
      });
      if (!shop.metafieldsInit) {
        await ensureMetafieldDefinitions(admin.graphql);
        await prisma.shop.update({
          where: { id: shop.id },
          data: { metafieldsInit: true },
        });
      }
    },
  },
  future: {
    unstable_newEmbeddedAuthStrategy: true,
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = API_VERSION;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
export const authenticate = shopify.authenticate;
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
