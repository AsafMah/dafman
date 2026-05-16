//! IPC contract snapshot tests.
//!
//! Imports the real `SessionEventPayload` from `dafman_lib` so any drift in
//! the wire shape will fail this snapshot — guaranteeing the frontend TS
//! mirror stays in sync.
use dafman_lib::SessionEventPayload;
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
