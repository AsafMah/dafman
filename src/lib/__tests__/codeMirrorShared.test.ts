import { describe, expect, test } from 'bun:test';

import {
  codeMirrorDarkTheme,
  codeMirrorLightTheme,
  codeMirrorThemeExtensionFor,
} from '@/lib/codeMirrorShared';

describe('codeMirrorThemeExtensionFor', () => {
  test('uses the light CodeMirror theme when the app is not dark', () => {
    expect(codeMirrorThemeExtensionFor(false)).toBe(codeMirrorLightTheme);
  });

  test('uses oneDark only when the app is dark', () => {
    expect(codeMirrorThemeExtensionFor(true)).toBe(codeMirrorDarkTheme);
  });
});
