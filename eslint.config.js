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
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      '@typescript-eslint/no-unsafe-argument': 'warn',
      '@typescript-eslint/no-unnecessary-type-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-misused-promises': 'warn',
      '@typescript-eslint/restrict-template-expressions': 'warn',
      '@typescript-eslint/no-unnecessary-condition': 'warn',
      '@typescript-eslint/require-await': 'off', // async interface implementations don't need await
      '@typescript-eslint/no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
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
);
