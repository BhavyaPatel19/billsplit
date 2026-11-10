import js from "@eslint/js";
import tseslint from "typescript-eslint";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// eslint-config-next ships its own typescript-eslint setup, so the Next.js app is linted
// with that preset and everything else with typescript-eslint's type-checked rules.
const WEB = ["apps/web/**/*.{ts,tsx,js,mjs}"];
const NODE = ["apps/api/**/*.ts", "apps/worker/**/*.ts", "packages/**/*.ts"];

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.turbo/**",
      "**/coverage/**",
      "**/next-env.d.ts",
    ],
  },
  { files: NODE, ...js.configs.recommended },
  ...tseslint.configs.recommendedTypeChecked.map((cfg) => ({ ...cfg, files: NODE })),
  {
    files: NODE,
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  ...[...nextVitals, ...nextTs].map((cfg) => ({ ...cfg, files: WEB })),
  {
    files: WEB,
    rules: {
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
);
