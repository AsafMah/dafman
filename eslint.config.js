import globals from 'globals';
import gts from 'gts';
import tseslint from 'typescript-eslint';
import pluginVue from 'eslint-plugin-vue';
import stylistic from '@stylistic/eslint-plugin';

export default tseslint.config(
  // ── Google TypeScript Style (base) ───────────────────────────
  ...gts,

  // ── Ignores ──────────────────────────────────────────────────
  {
    ignores: [
      'dist/**',
      'build/**',
      'node_modules/**',
      '**/__tests__/**',
      'e2e/**',
      'tools/**',
      'src/dev/**',
      '*.config.*',
      '**/*.d.ts',
    ],
  },

  // ── Type-checked TS rules ────────────────────────────────────
  ...tseslint.configs.strictTypeChecked,

  // ── Vue support ──────────────────────────────────────────────
  ...pluginVue.configs['flat/recommended'],

  {
    languageOptions: {
      parserOptions: {
        project: null, // override gts's project setting — projectService takes precedence
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
        extraFileExtensions: ['.vue'],
      },
    },
  },

  {
    files: ['**/*.vue'],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
      },
    },
  },

  // ── Browser globals for renderer code ──────────────────────────
  {
    files: ['src/**/*.{ts,vue}'],
    languageOptions: {
      globals: {
        ...globals.browser,
      },
    },
  },

  // ── Project rules (layered on top of gts) ────────────────────
  {
    plugins: {
      '@stylistic': stylistic,
    },
    rules: {
      // Code quality
      complexity: ['warn', 15],
      'max-depth': ['warn', 4],
      'max-lines-per-function': ['warn', { max: 200, skipBlankLines: true, skipComments: true }],
      'no-duplicate-imports': 'warn',

      // TS strictness tweaks
      // SDK interaction code uses `any`-typed values extensively; these
      // produce hundreds of false positives. Disabled for the whole repo
      // since the SDK boundary permeates most modules.
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-call': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-unsafe-argument': 'off',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': [
        'warn',
        { ignorePrimitives: { string: true, boolean: true } },
      ],
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/restrict-template-expressions': ['warn', { allowNumber: true }],
      // Defensive runtime checks are fine — SDK shapes drift and external
      // data can surprise us. Keep this off to allow `if (x)` guards.
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/require-await': 'off', // async interface implementations don't need await
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', destructuredArrayIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-confusing-void-expression': 'off',
      '@typescript-eslint/unbound-method': 'off',
      '@typescript-eslint/unified-signatures': 'warn',
      '@typescript-eslint/no-redundant-type-constituents': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/no-dynamic-delete': 'warn',
      '@typescript-eslint/no-invalid-void-type': 'warn',
      '@typescript-eslint/use-unknown-in-catch-callback-variable': 'warn',
      'no-control-regex': 'off', // ANSI escape sequence regexes are legitimate

      // gts uses single quotes — keep it
      quotes: ['warn', 'single', { avoidEscape: true }],

      // Vue
      'vue/multi-word-component-names': 'off',
      'vue/no-v-html': 'off',
      'vue/max-attributes-per-line': 'off',
      'vue/singleline-html-element-content-newline': 'off',
      'vue/html-self-closing': 'off',
      'vue/html-closing-bracket-newline': 'off',
      'vue/html-indent': 'off',
      'vue/one-component-per-file': 'off', // test helpers / barrel exports
      'vue/require-default-prop': 'off', // TypeScript handles defaults

      // Spacious style — blank lines around control flow and returns
      '@stylistic/padding-line-between-statements': [
        'warn',
        // Blank line before return
        { blankLine: 'always', prev: '*', next: 'return' },
        // Blank line after variable declarations
        { blankLine: 'always', prev: ['const', 'let', 'var'], next: '*' },
        { blankLine: 'any', prev: ['const', 'let', 'var'], next: ['const', 'let', 'var'] },
        // Blank line before and after control flow
        { blankLine: 'always', prev: '*', next: ['if', 'for', 'while', 'do', 'switch', 'try'] },
        { blankLine: 'always', prev: ['if', 'for', 'while', 'do', 'switch', 'try'], next: '*' },
        // Blank line before and after function declarations
        { blankLine: 'always', prev: '*', next: ['function'] },
        { blankLine: 'always', prev: ['function'], next: '*' },
        // Blank line after import block
        { blankLine: 'always', prev: 'import', next: '*' },
        { blankLine: 'any', prev: 'import', next: 'import' },
      ],
    },
  },
  // ── Architecture boundary gates (AGENTS.md) ──────────────────
  //
  // Mechanize two prose rules that kept getting violated: src-bun/app/
  // must stay unit-testable (only src-bun/index.ts touches the electrobun
  // runtime), and renderer code must reach the backend through the typed
  // src/ipc/invoke.ts layer — never raw electrobun.rpc.
  {
    files: ['src-bun/app/**/*.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electrobun', 'electrobun/*'],
              message:
                'src-bun/app/ must not import electrobun — only src-bun/index.ts touches the runtime so `bun test` can exercise app/ directly. Inject the dependency instead.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/**/*.{ts,vue}'],
    rules: {
      '@typescript-eslint/no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['electrobun', 'electrobun/*'],
              message:
                'Renderer code must not import electrobun directly — go through the typed src/ipc/invoke.ts layer. Only src/ipc/electrobunBridge.ts adapts the raw Electroview bridge.',
            },
          ],
        },
      ],
    },
  },
  {
    // The single sanctioned adapter for the raw Electroview bridge.
    files: ['src/ipc/electrobunBridge.ts'],
    rules: {
      '@typescript-eslint/no-restricted-imports': 'off',
    },
  },

  // ── max-lines-per-function overrides ──────────────────────────
  //
  // Pinia `defineStore` callbacks ARE the whole store body — splitting
  // them into helpers just hides the structure behind named imports.
  // Same for `registerBuiltinCommands` which is a flat per-command
  // declaration list. Per CODE_AUDIT §8 / 2026-05-26: rule disabled
  // for these specific surfaces, kept at 200 everywhere else.
  {
    files: ['src/stores/**/*.ts', 'src/lib/registerBuiltinCommands.ts'],
    rules: {
      'max-lines-per-function': 'off',
    },
  },
);
