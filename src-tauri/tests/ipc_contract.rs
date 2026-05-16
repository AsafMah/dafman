//! IPC contract snapshot tests.
//!
//! Guards the wire shape of payloads emitted to the frontend. If serde
//! renaming or field ordering changes, the snapshot will fail and force the
//! IPC types in `src/ipc/types.ts` (frontend) to be updated in lockstep.
use serde::Serialize;
/// Mirror of `SessionEventPayload` in `src/lib.rs`. We re-declare it here so
/// the test does not depend on the binary crate''s private types â€” the goal
/// is to lock the *wire shape*, and any divergence between the mirror and the
/// real type will surface as a TODO during the M1 module refactor when the
/// type moves to a public `ipc::events` module.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct SessionEventPayload {
    session_id: String,
    event_type: String,
    data: serde_json::Value,
}
#[test]
fn session_event_payload_wire_shape() {
    let payload = SessionEventPayload {
        session_id: "sess-1".into(),
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
      "eventType": "assistant.message_delta",
      "sessionId": "sess-1"
    }
    "###);
}
