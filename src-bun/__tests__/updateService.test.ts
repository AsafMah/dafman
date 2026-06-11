// updateService — focused unit tests for the security-critical helpers
// introduced in the #254 hardening pass.
//
// `isSecureBaseUrl` is a pure function; no Electrobun mocking needed.
// The higher-level `checkForUpdate` / `downloadAndApplyUpdate` integration
// behaviour relies on the real Electrobun `Updater` (not available outside a
// packaged build) and is therefore not exercised here — the guard path is
// fully covered by the pure-function tests below.

import { describe, expect, test } from 'bun:test';
import { isSecureBaseUrl } from '../updateService';

describe('isSecureBaseUrl', () => {
  // ---- passes the guard ----

  test('accepts https:// (lowercase)', () => {
    expect(isSecureBaseUrl('https://releases.example.com/dafman')).toBe(true);
  });

  test('accepts HTTPS:// (uppercase — case-insensitive check)', () => {
    expect(isSecureBaseUrl('HTTPS://releases.example.com/dafman')).toBe(true);
  });

  test('accepts https:// with a trailing path', () => {
    expect(isSecureBaseUrl('https://cdn.example.com/dafman/v2/')).toBe(true);
  });

  // ---- rejected by the guard ----

  test('rejects empty string', () => {
    expect(isSecureBaseUrl('')).toBe(false);
  });

  test('rejects plain http://', () => {
    expect(isSecureBaseUrl('http://releases.example.com/dafman')).toBe(false);
  });

  test('rejects HTTP:// (uppercase — still plaintext)', () => {
    expect(isSecureBaseUrl('HTTP://releases.example.com/dafman')).toBe(false);
  });

  test('rejects a bare hostname with no scheme', () => {
    expect(isSecureBaseUrl('releases.example.com')).toBe(false);
  });

  test('rejects a string that merely CONTAINS "https://" but does not start with it', () => {
    // e.g. a URL-in-URL or accidental config value
    expect(isSecureBaseUrl('ftp://mirror?redirect=https://safe.example.com')).toBe(false);
  });

  test('rejects ftp://', () => {
    expect(isSecureBaseUrl('ftp://releases.example.com')).toBe(false);
  });
});
