/** @type {import('@types/eslint').Linter.BaseConfig} */
module.exports = {
  root: true,
  extends: [
    "@remix-run/eslint-config",
    "@remix-run/eslint-config/node",
    "prettier",
  ],
  globals: {
    shopify: "readonly"
  },
  overrides: [
    {
      // Vitest exposes these globals when tests opt into globals mode. Keep
      // the config Jest-free: this project does not depend on Jest and the
      // Remix Jest preset reports false positives for Vitest files.
      files: ["**/*.test.{js,jsx,ts,tsx}", "**/*.spec.{js,jsx,ts,tsx}", "**/tests/**/*.{js,jsx,ts,tsx}", "**/__tests__/**/*.{js,jsx,ts,tsx}"],
      globals: {
        afterAll: "readonly",
        afterEach: "readonly",
        beforeAll: "readonly",
        beforeEach: "readonly",
        describe: "readonly",
        expect: "readonly",
        it: "readonly",
        test: "readonly",
        vi: "readonly",
      },
      rules: {
        // Vitest setup files intentionally import modules after mock
        // declarations. These exceptions apply only to tests.
        "import/first": "off",
        "import/no-duplicates": "off",
      },
    },
  ],
};
