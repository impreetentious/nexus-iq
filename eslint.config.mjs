import js from "@eslint/js";
import globals from "globals";

export default [
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "projects/**",
      "config/**",
      "vendor/**",
      "server/lexicons/**",
      "playwright-report/**",
      "test-results/**",
    ],
  },
  js.configs.recommended,
  {
    files: ["public/app/**/*.js", "pages/**/*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      parserOptions: {
        ecmaFeatures: {
          jsx: true,
        },
      },
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: [
      "server/**/*.js",
      "scripts/**/*.mjs",
      "tools/**/*.js",
      "tests/**/*.js",
      "demo/**/*.js",
      "*.config.mjs",
      "next.config.js",
    ],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.node,
      },
    },
  },
  {
    files: ["tests/a11y/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },
  {
    files: ["public/app/js/fixtures.js"],
    rules: {
      // Fixtures mode deliberately monkey-patches the API namespace in browser tests.
      "no-import-assign": "off",
    },
  },
];
