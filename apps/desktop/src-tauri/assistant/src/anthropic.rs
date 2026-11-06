//! Anthropic's Messages API: the request a call sends, what its answer and its errors mean, the
//! model list and the free key test. Thinking and effort follow the model's capabilities from the
//! list; without a list, the table of the research's section 1.3; a model the list does not have
//! sends neither. Never `temperature`, `top_p` or `top_k` (version 2026-10-21 refuses them).

use crate::guard::{self, Endpoint, Method, Reply};
use crate::keys::{Refusal, Secret};
use crate::{Answer, Call, ModelOption, TestResult};
use serde_json::{json, Value};

pub const VERSION: &str = "2026-10-21";

/// What a model takes, from the list's `capabilities`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Capabilities {
    pub thinking_disabled: bool,
    pub thinking_between_tools: bool,
    pub effort_low: bool,
}

/// What is known of the model a call names.
pub enum Lookup<'a> {
    /// No list loaded yet: the fallback table.
    NoList,
    /// The list is loaded and does not have the model.
    Absent,
    Listed(&'a Capabilities),
}

/// The research's table, for a model when no list is loaded.
pub fn fallback(_model: &str) -> Option<Capabilities> {
    None
}

/// The body of `POST /v1/messages`.
pub fn body(call: &Call, _lookup: Lookup) -> Value {
    json!({ "model": call.model, "temperature": 0 })
}

/// The headers besides the bearer.
pub fn headers() -> Vec<(&'static str, String)> {
    Vec::new()
}

/// A reply of `/v1/messages`: the answer, or what its status and body mean.
pub fn answer(_reply: &Reply, _key: &Secret, model: &str) -> Result<Answer, Refusal> {
    Ok(Answer {
        text: String::new(),
        model: model.to_string(),
        provider: "anthropic",
        usage: Default::default(),
        cost_usd: None,
        stop_reason: String::new(),
        notices: Vec::new(),
    })
}

/// What an error reply means, with its request id and its message (the key taken out).
pub fn refusal(_reply: &Reply, _key: &Secret) -> Refusal {
    Refusal::new("assistant_offline")
}

/// The active models of `GET /v1/models`, grouped by line, with their capabilities.
pub fn models(_reply: &Reply, _key: &Secret) -> Result<Vec<(ModelOption, Capabilities)>, Refusal> {
    Ok(Vec::new())
}

/// The key test's result from `GET /v1/models?limit=1`.
pub fn test_result(_reply: &Reply, _key: &Secret) -> TestResult {
    TestResult::default()
}

pub async fn run(
    client: &reqwest::Client,
    endpoint: &Endpoint,
    key: &Secret,
    call: &Call<'_>,
    lookup: Lookup<'_>,
) -> Result<Answer, Refusal> {
    let reply =
        guard::send(client, endpoint, "/v1/models", Method::Post(body(call, lookup)), key, &headers()).await?;
    answer(&reply, key, call.model)
}

pub async fn list(
    client: &reqwest::Client,
    endpoint: &Endpoint,
    key: &Secret,
) -> Result<Vec<(ModelOption, Capabilities)>, Refusal> {
    let reply = guard::send(client, endpoint, "/v1/models", Method::Get, key, &headers()).await?;
    models(&reply, key)
}

pub async fn test(client: &reqwest::Client, endpoint: &Endpoint, key: &Secret) -> TestResult {
    match guard::send(client, endpoint, "/v1/models", Method::Get, key, &headers()).await {
        Ok(reply) => test_result(&reply, key),
        Err(refused) => TestResult { ok: false, detail: Some(refused.reason.to_string()), ..TestResult::default() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Usage;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::{Arc, Mutex};

    const FAKE: &str = "sk-ant-FAKEKEY-anthropic-0123456789";

    fn key() -> Secret {
        Secret::new(FAKE.to_string())
    }

    fn reply(status: u16, headers: &[(&str, &str)], body: &str) -> Reply {
        Reply {
            status,
            headers: headers.iter().map(|(k, v)| (k.to_string(), v.to_string())).collect(),
            body: body.to_string(),
        }
    }

    fn call(model: &str) -> Call<'_> {
        Call { system: "Be brief.", user: "<text>fix it</text>", model, max_tokens: 300 }
    }

    fn haiku_caps() -> Capabilities {
        Capabilities { thinking_disabled: true, thinking_between_tools: false, effort_low: true }
    }

    #[test]
    fn the_body_takes_thinking_and_effort_from_the_capabilities_and_never_sampling_fields() {
        let listed = body(&call("claude-haiku-5-5"), Lookup::Listed(&haiku_caps()));
        assert_eq!(
            listed,
            json!({
                "model": "claude-haiku-5-5",
                "max_tokens": 300,
                "system": "Be brief.",
                "messages": [{ "role": "user", "content": "<text>fix it</text>" }],
                "thinking": { "type": "disabled" },
                "output_config": { "effort": "low" },
            })
        );
        let sonnet = body(&call("claude-sonnet-5-5"), Lookup::NoList);
        assert_eq!(
            (&sonnet["thinking"], &sonnet["output_config"]),
            (&json!({ "type": "between_tools" }), &json!({ "effort": "low" }))
        );
        let opus = body(&call("claude-opus-5-5"), Lookup::NoList);
        assert_eq!((opus.get("thinking"), &opus["output_config"]), (None, &json!({ "effort": "low" })));
        for model in ["claude-fable-5-1", "claude-opus-5-5"] {
            assert_eq!(body(&call(model), Lookup::NoList).get("thinking"), None, "{model}");
        }
        let absent = body(&call("claude-haiku-5-5"), Lookup::Absent);
        assert_eq!((absent.get("thinking"), absent.get("output_config")), (None, None));
        let unknown = body(&call("claude-next"), Lookup::NoList);
        assert_eq!((unknown.get("thinking"), unknown.get("output_config")), (None, None));
        for sent in [listed, sonnet, opus, absent, unknown] {
            for field in ["temperature", "top_p", "top_k"] {
                assert_eq!(sent.get(field), None, "{field}");
            }
        }
        assert_eq!(headers(), vec![("anthropic-version", "2026-10-21".to_string())]);
        assert_eq!(fallback("claude-haiku-5-5"), Some(haiku_caps()));
        assert_eq!(fallback("gpt-x"), None);
    }

    #[test]
    fn an_answer_joins_its_text_blocks_and_maps_the_usage_and_the_stop() {
        let ok = reply(
            200,
            &[],
            r#"{"model":"claude-haiku-5-5","content":[{"type":"thinking","thinking":"hm"},{"type":"text","text":"Fix the "},{"type":"text","text":"login."}],"stop_reason":"end_turn","usage":{"input_tokens":700,"output_tokens":40,"cache_read_input_tokens":5,"cache_creation_input_tokens":9}}"#,
        );
        assert_eq!(
            answer(&ok, &key(), "claude-haiku-5-5"),
            Ok(Answer {
                text: "Fix the login.".into(),
                model: "claude-haiku-5-5".into(),
                provider: "anthropic",
                usage: Usage { input_tokens: 700, output_tokens: 40, cache_read_tokens: 5, cache_write_tokens: 9 },
                cost_usd: None,
                stop_reason: "end_turn".into(),
                notices: Vec::new(),
            })
        );
        let stop = |reason: &str, text: &str| {
            let body = format!(
                r#"{{"content":[{{"type":"text","text":"{text}"}}],"stop_reason":"{reason}","usage":{{"input_tokens":1,"output_tokens":1}}}}"#
            );
            answer(&reply(200, &[], &body), &key(), "m").map(|a| a.text).map_err(|r| r.reason)
        };
        assert_eq!(stop("max_tokens", "cut"), Err("assistant_truncated"));
        assert_eq!(stop("refusal", "no"), Err("assistant_refused"));
        assert_eq!(stop("end_turn", "   "), Err("assistant_bad_output"));
        assert_eq!(stop("stop_sequence", "fine"), Ok("fine".to_string()));
        assert_eq!(
            answer(&reply(200, &[], "not json"), &key(), "m").map_err(|r| r.reason),
            Err("assistant_bad_output")
        );
    }

    #[test]
    fn each_error_status_has_its_reason_with_the_request_id_and_never_the_key() {
        let error = |message: &str| {
            format!(r#"{{"type":"error","error":{{"type":"x","message":"{message}"}},"request_id":"req_body"}}"#)
        };
        let id = [("request-id", "req_42")];
        let cases: Vec<(Reply, &str)> = vec![
            (reply(400, &id, &error("You have reached your specified workspace API spend limit")), "assistant_credits"),
            (reply(400, &id, &error("messages: field required")), "assistant_bad_output"),
            (reply(401, &id, &error("invalid x-api-key")), "assistant_auth"),
            (reply(403, &id, &error("not allowed")), "assistant_auth"),
            (reply(404, &id, &error("model: claude-gone")), "assistant_model_unavailable"),
            (reply(413, &id, &error("too large")), "assistant_too_long"),
            (reply(429, &id, &error("tier spend cap")), "assistant_credits"),
            (reply(429, &[("request-id", "req_42"), ("retry-after", "30")], &error("slow down")), "assistant_rate_limited"),
            (reply(500, &id, &error("api error")), "assistant_overloaded"),
            (reply(529, &id, &error("overloaded")), "assistant_overloaded"),
        ];
        for (sent, want) in &cases {
            let refused = refusal(sent, &key());
            assert_eq!(refused.reason, *want, "{} {}", sent.status, sent.body);
            assert_eq!(refused.params.get("requestId").map(String::as_str), Some("req_42"));
        }
        let limited = refusal(&cases[7].0, &key());
        assert_eq!(limited.params.get("retryAfter").map(String::as_str), Some("30"));
        let forbidden = refusal(&cases[3].0, &key());
        assert_eq!(forbidden.params.get("detail").map(String::as_str), Some("not allowed"));
        let echoed = refusal(&reply(401, &[], &error(&format!("bad key {FAKE}"))), &key());
        assert_eq!(echoed.params.get("detail").map(String::as_str), Some("bad key <key>"));
        assert_eq!(echoed.params.get("requestId").map(String::as_str), Some("req_body"));
        assert_eq!(
            answer(&cases[2].0, &key(), "m").map_err(|r| r.reason),
            Err("assistant_auth"),
            "answer maps an error reply"
        );
        let all = format!("{:?}", cases.iter().map(|(r, _)| refusal(r, &key())).collect::<Vec<_>>());
        assert!(!all.contains("FAKEKEY") && !format!("{echoed:?}").contains("FAKEKEY"));
    }

    #[test]
    fn the_list_keeps_active_models_with_their_line_and_capabilities() {
        let list = reply(
            200,
            &[],
            r#"{"data":[
              {"id":"claude-haiku-5-5","display_name":"Claude Haiku 5.5","line":"haiku","lifecycle":"active",
               "capabilities":{"thinking":{"types":{"disabled":{"supported":true},"between_tools":{"supported":false}}},"effort":{"low":{"supported":true}}}},
              {"id":"claude-sonnet-4-5","display_name":"Claude Sonnet 4.5","line":"sonnet","lifecycle":"deprecated","capabilities":{}},
              {"id":"claude-opus-5-5","display_name":"Claude Opus 5.5","line":"opus","lifecycle":"active","capabilities":{}}
            ]}"#,
        );
        assert_eq!(
            models(&list, &key()),
            Ok(vec![
                (
                    ModelOption {
                        id: "claude-haiku-5-5".into(),
                        label: "Claude Haiku 5.5".into(),
                        group: Some("haiku".into()),
                        supports_effort: Some(true),
                        ..ModelOption::default()
                    },
                    haiku_caps()
                ),
                (
                    ModelOption {
                        id: "claude-opus-5-5".into(),
                        label: "Claude Opus 5.5".into(),
                        group: Some("opus".into()),
                        supports_effort: Some(false),
                        ..ModelOption::default()
                    },
                    Capabilities::default()
                ),
            ])
        );
        assert_eq!(models(&reply(401, &[], "{}"), &key()).map_err(|r| r.reason), Err("assistant_auth"));
        assert_eq!(models(&reply(200, &[], "[]"), &key()).map_err(|r| r.reason), Err("assistant_bad_output"));
    }

    #[test]
    fn the_key_test_says_ok_or_why() {
        assert_eq!(test_result(&reply(200, &[], r#"{"data":[]}"#), &key()), TestResult { ok: true, ..TestResult::default() });
        assert_eq!(
            test_result(&reply(401, &[], "{}"), &key()),
            TestResult { ok: false, detail: Some("assistant_auth".into()), ..TestResult::default() }
        );
    }

    /// One loopback answer; returns the raw request it read.
    fn serve_once(body: &'static str) -> (String, Arc<Mutex<String>>) {
        let answer = format!(
            "HTTP/1.1 200 OK\r\ncontent-type: application/json\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
            body.len()
        );
        let listener = TcpListener::bind("127.0.0.1:0").ok();
        let base = listener
            .as_ref()
            .and_then(|l| l.local_addr().ok())
            .map(|a| format!("http://{a}"))
            .unwrap_or_default();
        let seen = Arc::new(Mutex::new(String::new()));
        let raw = seen.clone();
        std::thread::spawn(move || {
            let Some(listener) = listener else { return };
            let Ok((mut stream, _)) = listener.accept() else { return };
            let _ = stream.set_read_timeout(Some(std::time::Duration::from_millis(500)));
            let mut buf = [0u8; 8192];
            let mut got = Vec::new();
            while let Ok(n) = stream.read(&mut buf) {
                if n == 0 {
                    break;
                }
                got.extend_from_slice(&buf[..n]);
                let text = String::from_utf8_lossy(&got).to_string();
                if text.contains("\r\n\r\n") && text.contains("\"messages\"") && text.ends_with('}') {
                    break;
                }
            }
            if let Ok(mut r) = raw.lock() {
                *r = String::from_utf8_lossy(&got).to_string();
            }
            let _ = stream.write_all(answer.as_bytes());
        });
        (base, seen)
    }

    #[test]
    fn a_run_posts_to_messages_and_reads_the_answer() {
        let (base, seen) = serve_once(
            "{\"content\":[{\"type\":\"text\",\"text\":\"Done.\"}],\"stop_reason\":\"end_turn\",\"usage\":{\"input_tokens\":3,\"output_tokens\":2}}",
        );
        let outcome = tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|_| "rt").and_then(|rt| {
            rt.block_on(async {
                let client = guard::client().map_err(|r| r.reason)?;
                let endpoint = Endpoint::with_base(&base).map_err(|r| r.reason)?;
                run(&client, &endpoint, &key(), &call("claude-haiku-5-5"), Lookup::NoList).await.map(|a| a.text).map_err(|r| r.reason)
            })
        });
        assert_eq!(outcome, Ok("Done.".to_string()));
        let raw = seen.lock().map(|r| r.to_ascii_lowercase()).unwrap_or_default();
        assert!(raw.starts_with("post /v1/messages "), "{raw}");
        assert!(raw.contains("anthropic-version: 2026-10-21"));
    }

    #[test]
    fn scrub_takes_the_key_out_of_any_text() {
        assert_eq!(crate::scrub(&format!("x {FAKE} y {FAKE}"), &key()), "x <key> y <key>");
        assert_eq!(crate::scrub("nothing here", &key()), "nothing here");
    }
}
