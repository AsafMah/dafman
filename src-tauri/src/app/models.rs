//! Model catalog — a slim mirror of `github_copilot_sdk::Model` for the
//! frontend's model picker.
//!
//! Wire-shape stability is guarded by `tests/ipc_contract.rs`; the SDK's
//! own type carries a lot of billing/policy detail we don't need yet.

use serde::Serialize;

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSummary {
    /// Model identifier (e.g. `"claude-sonnet-4.5"`).
    pub id: String,
    /// Display name.
    pub name: String,
    /// True when the model accepts a `reasoning_effort` override.
    pub supports_reasoning_effort: bool,
    /// Allowed effort levels (e.g. `["low", "medium", "high"]`). Empty
    /// when `supports_reasoning_effort` is false.
    pub supported_reasoning_efforts: Vec<String>,
    /// Backend-suggested default effort, if any.
    pub default_reasoning_effort: Option<String>,
}

impl From<github_copilot_sdk::Model> for ModelSummary {
    fn from(model: github_copilot_sdk::Model) -> Self {
        let supports_reasoning_effort = model
            .capabilities
            .supports
            .as_ref()
            .and_then(|s| s.reasoning_effort)
            .unwrap_or(false);
        Self {
            id: model.id,
            name: model.name,
            supports_reasoning_effort,
            supported_reasoning_efforts: model.supported_reasoning_efforts,
            default_reasoning_effort: model.default_reasoning_effort,
        }
    }
}
