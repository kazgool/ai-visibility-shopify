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
    // The route tests import a Remix route inside the test body, which pulls
    // in Polaris and the whole service tree. With 70 files in parallel that
    // one import can pass five seconds on its own, and the test it is charged
    // to times out; the call it was awaiting then lands during a later test
    // and shows up there as a spy called twice. Three failures, none of them
    // a defect, and all of them absent when the same files run alone. The
    // wait is real work, not a hang, so the budget is the thing that was
    // wrong.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
