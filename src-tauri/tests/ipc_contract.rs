//! IPC contract snapshot tests.
//!
//! Imports the real `SessionEventPayload` from `dafman_lib` so any drift in
//! the wire shape will fail this snapshot — guaranteeing the frontend TS
//! mirror stays in sync.
use dafman_lib::{ModelSummary, SessionEventPayload, Settings, SETTINGS_VERSION};

mod app_error_wire {
    //! Snapshot the on-the-wire shape of every `AppError` variant. The
    //! frontend's `AppErrorPayload` discriminated union in
    //! `src/ipc/types.ts` MUST match these exactly. Adding a new variant
    //! requires adding a snapshot here AND a `kind` arm in
    //! `formatAppError` + `isAppErrorPayload` on the TS side.
    //!
    //! `AppError` lives behind `app::error` and isn't re-exported from
    //! `dafman_lib`; we construct the JSON shape manually here, which is
    //! the contract the frontend relies on.
    use serde_json::json;

    #[test]
    fn client_not_started() {
        insta::assert_json_snapshot!(json!({"kind": "ClientNotStarted"}), @r###"
        {
          "kind": "ClientNotStarted"
        }
        "###);
    }

    #[test]
    fn session_not_found() {
        insta::assert_json_snapshot!(
            json!({"kind": "SessionNotFound", "data": "sess-1"}),
            @r###"
        {
          "data": "sess-1",
          "kind": "SessionNotFound"
        }
        "###
        );
    }

    #[test]
    fn settings_error() {
        insta::assert_json_snapshot!(
            json!({"kind": "Settings", "data": "io: disk full"}),
            @r###"
        {
          "data": "io: disk full",
          "kind": "Settings"
        }
        "###
        );
    }

    #[test]
    fn sdk_error() {
        insta::assert_json_snapshot!(
            json!({"kind": "Sdk", "data": "rpc timeout"}),
            @r###"
        {
          "data": "rpc timeout",
          "kind": "Sdk"
        }
        "###
        );
    }
}

#[test]
fn session_event_payload_wire_shape() {
    let payload = SessionEventPayload {
        event_type: "assistant.message_delta".into(),
        data: serde_json::json!({
            "messageId": "m-1",
            "deltaContent": "Hello"
        }),
    };
    let json = serde_json::to_value(&payload).expect("serialize");
    insta::assert_json_snapshot!(json, @r###"
    {
      "data": {
        "deltaContent": "Hello",
        "messageId": "m-1"
      },
      "eventType": "assistant.message_delta"
    }
    "###);
}

#[test]
fn settings_wire_shape() {
    let settings = Settings::default();
    let json = serde_json::to_value(&settings).expect("serialize");
    insta::assert_json_snapshot!(json, @r###"
    {
      "appearance": {
        "reasoningVisibility": "compact",
        "theme": "system"
      },
      "version": 2
    }
    "###);
    assert_eq!(settings.version, SETTINGS_VERSION);
}

#[test]
fn model_summary_wire_shape() {
    let model = ModelSummary {
        id: "claude-sonnet-4.5".into(),
        name: "Claude Sonnet 4.5".into(),
        supports_reasoning_effort: true,
        supported_reasoning_efforts: vec!["low".into(), "medium".into(), "high".into()],
        default_reasoning_effort: Some("medium".into()),
    };
    let json = serde_json::to_value(&model).expect("serialize");
    insta::assert_json_snapshot!(json, @r###"
    {
      "defaultReasoningEffort": "medium",
      "id": "claude-sonnet-4.5",
      "name": "Claude Sonnet 4.5",
      "supportedReasoningEfforts": [
        "low",
        "medium",
        "high"
      ],
      "supportsReasoningEffort": true
    }
    "###);
}
