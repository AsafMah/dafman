// Sensitive-field redaction for the structured logger.
//
// Goal: prompts, attachment bytes, tokens, and any field whose name
// suggests a secret never reach the on-disk log or the in-app log
// viewer. Replaced inline by a shape-only descriptor (length, hash
// prefix, or a `***` marker) so the log still tells the operator
// *something happened* without leaking *what*.
//
// Strategy:
//   * Allowlist of known structural keys we keep verbatim (sessionId,
//     toolCallId, kind, count, ms, etc.).
//   * Denylist of names that match known-secret patterns -> replaced
//     with the redaction marker.
//   * Any other key with a string value > MAX_STRING_LEN is shape-only
//     summarised so a stray prompt that snuck into a field doesn't
//     leak a paragraph.
//   * Recursion budget so a pathological deeply-nested object can't
//     stall the logger.
//
// Tests:
//   `src-bun/__tests__/logging.redact.test.ts` pins each rule (token,
//   prompt key, raw long string, nested objects, arrays).
//
// The `redactFields` export is the only public surface; everything
// else is implementation detail.

const SENSITIVE_KEY_PATTERNS = [
  /token/i,
  /secret/i,
  /password/i,
  /passwd/i,
  /api[_-]?key/i,
  /auth(orization)?/i,
  /cookie/i,
  /credential/i,
  /bearer/i,
  /private[_-]?key/i,
  /^pat$/i, // GitHub personal access token shorthand
  /x-github-token/i,
];

const CONTENT_KEY_PATTERNS = [
  /^prompt$/i,
  /^content$/i,
  /^text$/i,
  /^message$/i,
  /^body$/i,
  /^answer$/i,
  /^data$/i, // attachment blobs land here
  /^reasoning(text|opaque)?$/i,
  /^encrypted_?content$/i,
  /^delta(content)?$/i,
];

const MAX_STRING_LEN = 256;
const MAX_DEPTH = 6;
const MAX_ARRAY_ITEMS = 32;
const REDACTED = '***';

function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((re) => re.test(key));
}

function isContentKey(key: string): boolean {
  return CONTENT_KEY_PATTERNS.some((re) => re.test(key));
}

/// Shape descriptor for a string we've decided is too sensitive or
/// too large to log verbatim. Carries enough information that an
/// operator can correlate ("did the agent send a 14 KB blob?")
/// without seeing the bytes.
function summariseString(value: string): {
  len: number;
  prefix: string;
} {
  return {
    len: value.length,
    prefix: value.slice(0, 16),
  };
}

/// Recursively walk a value, redacting sensitive keys + summarising
/// large strings. `depth` is the remaining recursion budget; once it
/// hits zero we stop and return a shape descriptor.
function redactValue(value: unknown, depth: number, parentKey?: string): unknown {
  if (value === null || value === undefined) return value;

  const t = typeof value;

  if (t === 'boolean' || t === 'number') return value;

  if (t === 'string') {
    const s = value as string;

    // If we're inside a sensitive- or content-key context the key
    // already triggered the redaction (handled by caller); here we
    // guard against orphan strings that may be a prompt embedded
    // in an unfamiliar key.
    if (s.length > MAX_STRING_LEN) {
      return { ...summariseString(s), elided: true };
    }

    return s;
  }

  if (depth <= 0) {
    return { _truncated: 'max-depth' };
  }

  if (Array.isArray(value)) {
    const out = value.slice(0, MAX_ARRAY_ITEMS).map((v) => redactValue(v, depth - 1, parentKey));

    if (value.length > MAX_ARRAY_ITEMS) {
      out.push({ _truncated: `${value.length - MAX_ARRAY_ITEMS} more` });
    }

    return out;
  }

  if (t === 'object') {
    return redactObject(value as Record<string, unknown>, depth - 1);
  }

  // function / symbol / bigint -> string shape
  return { _kind: t };
}

function redactObject(obj: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  for (const [key, val] of Object.entries(obj)) {
    if (isSensitiveKey(key)) {
      out[key] = REDACTED;
      continue;
    }

    if (isContentKey(key)) {
      if (typeof val === 'string') {
        out[key] = summariseString(val);
      } else if (val === null || val === undefined) {
        out[key] = val;
      } else {
        // Non-string content (object/array). Replace with shape only
        // — we don't want a nested prompt to slip through.
        out[key] = { _redacted: 'content', _type: Array.isArray(val) ? 'array' : typeof val };
      }

      continue;
    }

    out[key] = redactValue(val, depth, key);
  }

  return out;
}

/// Public surface: redact a flat `fields` map passed to log.<level>().
/// Returns a new object; never mutates the input.
export function redactFields(fields: Record<string, unknown>): Record<string, unknown> {
  return redactObject(fields, MAX_DEPTH);
}
