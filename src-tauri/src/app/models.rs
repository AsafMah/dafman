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

#[cfg(test)]
mod tests {
    use super::*;
    use github_copilot_sdk::{Model, ModelCapabilities, ModelCapabilitiesSupports};

    fn base_model() -> Model {
        Model {
            id: "test-model".into(),
            name: "Test Model".into(),
            capabilities: ModelCapabilities::default(),
            supported_reasoning_efforts: vec![],
            default_reasoning_effort: None,
            ..Default::default()
        }
    }

    #[test]
    fn supports_reasoning_effort_defaults_to_false_when_supports_field_is_none() {
        let m = base_model();
        let s = ModelSummary::from(m);
        assert!(!s.supports_reasoning_effort);
    }

    #[test]
    fn supports_reasoning_effort_defaults_to_false_when_inner_flag_is_none() {
        let mut m = base_model();
        m.capabilities.supports = Some(ModelCapabilitiesSupports {
            reasoning_effort: None,
            ..Default::default()
        });
        let s = ModelSummary::from(m);
        assert!(!s.supports_reasoning_effort);
    }

    #[test]
    fn supports_reasoning_effort_reflects_inner_flag_when_present() {
        let mut m = base_model();
        m.capabilities.supports = Some(ModelCapabilitiesSupports {
            reasoning_effort: Some(true),
            ..Default::default()
        });
        let s = ModelSummary::from(m);
        assert!(s.supports_reasoning_effort);
    }

    #[test]
    fn carries_id_name_efforts_and_default_verbatim() {
        let mut m = base_model();
        m.id = "claude-sonnet-4.5".into();
        m.name = "Claude Sonnet 4.5".into();
        m.supported_reasoning_efforts = vec!["low".into(), "high".into()];
        m.default_reasoning_effort = Some("low".into());
        let s = ModelSummary::from(m);
        assert_eq!(s.id, "claude-sonnet-4.5");
        assert_eq!(s.name, "Claude Sonnet 4.5");
        assert_eq!(s.supported_reasoning_efforts, vec!["low", "high"]);
        assert_eq!(s.default_reasoning_effort.as_deref(), Some("low"));
    }
}
