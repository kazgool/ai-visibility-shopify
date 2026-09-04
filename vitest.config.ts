import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "app/**/__tests__/**/*.test.ts",
      // The card is a component and its test renders it, so .tsx has to be in
      // the glob; without it the file is silently never run.
      "app/**/__tests__/**/*.test.tsx",
      // The worker's tasks had no test of their own until the unlock moved
      // into one (build step 2). The pattern is the same as app's.
      "worker/**/__tests__/**/*.test.ts",
    ],
    environment: "node",
  },
});
