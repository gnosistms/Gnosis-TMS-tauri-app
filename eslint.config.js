import js from "@eslint/js";
import globals from "globals";

export default [
  // Ignore vendored libraries and generated output
  {
    ignores: ["src-ui/lib/vendor/**", "dist/**", "src-tauri/gen/**"],
  },
  // App source and screen modules
  {
    files: ["src-ui/app/**/*.js", "src-ui/screens/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.browser,
        __TAURI__: "readonly",
      },
    },
    rules: {
      "prefer-const": "error",
      "no-var": "error",
      // Allow == null (intentional null/undefined coercion is common here)
      "eqeqeq": ["error", "always", { null: "ignore" }],
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "no-eval": "error",
    },
  },
  // Test files — node test runner globals, relax unused-vars (mocks/stubs)
  {
    files: ["src-ui/**/*.test.js", "src-ui/test/**/*.js"],
    ...js.configs.recommended,
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
    rules: {
      "prefer-const": "error",
      "no-var": "error",
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
    },
  },
];
