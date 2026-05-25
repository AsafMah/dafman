import gts from "gts";
import tseslint from "typescript-eslint";
import pluginVue from "eslint-plugin-vue";

export default tseslint.config(
  // ── Google TypeScript Style (base) ───────────────────────────
  ...gts,

  // ── Ignores ──────────────────────────────────────────────────
  {
    ignores: [
      "dist/**",
      "build/**",
      "node_modules/**",
      "**/__tests__/**",
      "e2e/**",
      "tools/**",
      "src/dev/**",
      "*.config.*",
    ],
  },

  // ── Type-checked TS rules ────────────────────────────────────
  ...tseslint.configs.strictTypeChecked,

  // ── Vue support ──────────────────────────────────────────────
  ...pluginVue.configs["flat/recommended"],

  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: [".vue"],
      },
    },
  },

  {
    files: ["**/*.vue"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // ── Project rules (layered on top of gts) ────────────────────
  {
    rules: {
      // Code quality
      complexity: ["warn", 15],
      "max-depth": ["warn", 4],
      "max-lines-per-function": [
        "warn",
        { max: 200, skipBlankLines: true, skipComments: true },
      ],
      "no-duplicate-imports": "warn",

      // TS strictness tweaks
      "@typescript-eslint/no-unsafe-assignment": "warn",
      "@typescript-eslint/no-unsafe-member-access": "warn",
      "@typescript-eslint/no-unsafe-call": "warn",
      "@typescript-eslint/no-unsafe-return": "warn",
      "@typescript-eslint/no-unsafe-argument": "warn",
      "@typescript-eslint/no-unnecessary-type-assertion": "warn",
      "@typescript-eslint/prefer-nullish-coalescing": "warn",
      "@typescript-eslint/no-misused-promises": "warn",
      "@typescript-eslint/restrict-template-expressions": "warn",
      "@typescript-eslint/no-unnecessary-condition": "warn",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
      "@typescript-eslint/no-confusing-void-expression": "off",
      "@typescript-eslint/unbound-method": "off",

      // gts uses single quotes — keep it
      quotes: ["warn", "single", { avoidEscape: true }],

      // Vue
      "vue/multi-word-component-names": "off",
      "vue/no-v-html": "off",
      "vue/max-attributes-per-line": "off",
      "vue/singleline-html-element-content-newline": "off",
      "vue/html-self-closing": "off",
    },
  },
);
