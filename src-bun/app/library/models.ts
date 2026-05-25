// Maps the SDK's verbose `ModelInfo` onto our slim wire `ModelSummary`.
//
// The old Rust `ModelSummary` derived `supports_reasoning_effort` from a
// nested `capabilities.supports.reasoning_effort` flag. The TS SDK
// expresses the same idea structurally: `supportedReasoningEfforts` is
// only present (and non-empty) when the model accepts a reasoning effort
// override.

import type { ModelInfo } from '../client/copilotSdk';
import type { ModelSummary } from '../rpc';

export function toModelSummary(model: ModelInfo): ModelSummary {
  const efforts = model.supportedReasoningEfforts ?? [];

  return {
    id: model.id,
    name: model.name,
    supportsReasoningEffort: efforts.length > 0,
    supportedReasoningEfforts: efforts.map(String),
    defaultReasoningEffort: model.defaultReasoningEffort ?? null,
  };
}
