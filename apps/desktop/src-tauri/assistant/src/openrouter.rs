//! OpenRouter's chat completions: the request a call sends (no data collection by default, the
//! reasoning rule of the research's section 1.4), what its answer and its errors mean, the model
//! list a person picks from and the key test. No `HTTP-Referer` or `X-OpenRouter-Title`: no app
//! identity leaves the machine unasked. The key test never returns the key's `label`, which is a
//! masked key.

use crate::guard::{self, Endpoint, Method, Reply};
use crate::keys::{Refusal, Secret};
use crate::{Answer, Call, ModelOption, TestResult, Usage};
use serde_json::{json, Value};

const CHAT: &str = "/api/v1/chat/completions";

/// A reasoning model's metadata from the list.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Reasoning {
    pub mandatory: bool,
    pub supported_efforts: Vec<String>,
}

/// The efforts, lowest first.
const EFFORTS: [&str; 6] = ["minimal", "low", "medium", "high", "xhigh", "max"];

/// The effort a call asks of a reasoning model: `none` when reasoning is optional; when it is
/// mandatory, `low`, or the lowest the model takes when `low` is not among them.
pub fn effort(reasoning: &Reasoning) -> &'static str {
    if !reasoning.mandatory {
        return "none";
    }
    let takes = |effort: &str| reasoning.supported_efforts.iter().any(|e| e == effort);
    if reasoning.supported_efforts.is_empty() || takes("low") {
        return "low";
    }
    EFFORTS.iter().find(|effort| takes(effort)).copied().unwrap_or("low")
}

/// The body of `POST /api/v1/chat/completions`. `deny_collection` is the Settings switch (on by
/// default); off, the provider object is left out, which is OpenRouter's default.
pub fn body(call: &Call, reasoning: Option<&Reasoning>, deny_collection: bool) -> Value {
    let mut body = json!({
        "model": call.model,
        "messages": [
            { "role": "system", "content": call.system },
            { "role": "user", "content": call.user },
        ],
        "max_tokens": guard::cap_output_tokens(call.max_tokens),
        "stream": false,
    });
    if deny_collection {
        body["provider"] = json!({ "data_collection": "deny" });
    }
    if let Some(reasoning) = reasoning {
        body["reasoning"] = json!({ "effort": effort(reasoning) });
    }
    body
}

fn bad_output() -> Refusal {
    Refusal::new("assistant_bad_output")
}

fn success(reply: &Reply) -> bool {
    (200..300).contains(&reply.status)
}

/// A reply of the chat completions: the answer, or what its error means. An `error` object in a
/// 200 body (a failure after the answer started) is an error with the status it carries.
pub fn answer(reply: &Reply, key: &Secret, model: &str) -> Result<Answer, Refusal> {
    if !success(reply) {
        return Err(refusal(reply, key));
    }
    let value: Value = serde_json::from_str(&reply.body).map_err(|_| bad_output())?;
    if value["error"].is_object() {
        return Err(refusal(reply, key));
    }
    let choice = &value["choices"][0];
    let text = choice["message"]["content"].as_str().unwrap_or_default().to_string();
    let stop_reason = choice["finish_reason"].as_str().unwrap_or_default().to_string();
    match stop_reason.as_str() {
        "length" => return Err(Refusal::new("assistant_truncated")),
        "content_filter" => return Err(Refusal::new("assistant_refused")),
        _ => {}
    }
    if text.trim().is_empty() {
        return Err(bad_output());
    }
    let usage = &value["usage"];
    let count = |field: &Value| field.as_u64().unwrap_or(0);
    Ok(Answer {
        text,
        model: value["model"].as_str().unwrap_or(model).to_string(),
        provider: "openrouter",
        usage: Usage {
            input_tokens: count(&usage["prompt_tokens"]),
            output_tokens: count(&usage["completion_tokens"]),
            cache_read_tokens: count(&usage["prompt_tokens_details"]["cached_tokens"]),
            cache_write_tokens: 0,
        },
        cost_usd: usage["cost"].as_f64(),
        stop_reason,
        notices: Vec::new(),
    })
}

/// What an error means: the HTTP status, or for a 200 the `error.code` in its body; the message
/// scrubbed, and `retryAfter` from the header when the wait is the point.
pub fn refusal(reply: &Reply, key: &Secret) -> Refusal {
    let value: Value = serde_json::from_str(&reply.body).unwrap_or(Value::Null);
    let error = &value["error"];
    let status = if success(reply) {
        error["code"].as_u64().and_then(|code| u16::try_from(code).ok()).unwrap_or(0)
    } else {
        reply.status
    };
    let limit_source = error["metadata"]["limit_source"].as_str();
    let reason = match status {
        401 => "assistant_auth",
        402 => "assistant_credits",
        403 if limit_source.is_some() => "assistant_credits",
        403 => "assistant_auth",
        404 => "assistant_model_unavailable",
        408 => "assistant_timeout",
        413 => "assistant_too_long",
        429 => "assistant_rate_limited",
        500 | 502 => "assistant_overloaded",
        503 => "assistant_routing_unavailable",
        _ => "assistant_bad_output",
    };
    let mut refused = Refusal::new(reason);
    if let Some(message) = error["message"].as_str() {
        refused = refused.with("detail", crate::detail(message, key));
    }
    if status == 413 {
        refused = refused.with("max", guard::MAX_INPUT_CHARS.to_string());
    }
    let waits = status == 429 || limit_source == Some("openrouter_in_flight_budget");
    let after = reply.header("retry-after").and_then(|after| crate::token(&crate::scrub(after, key)));
    if let (true, Some(after)) = (waits, after) {
        refused = refused.with("retryAfter", after);
    }
    refused
}

/// A price string in USD per token as USD per million tokens, to the millionth.
fn per_million(price: &Value) -> Option<f64> {
    let per_token: f64 = price.as_str()?.parse().ok()?;
    (per_token >= 0.0).then(|| (per_token * 1e12).round() / 1e6)
}

fn has(list: &Value, item: &str) -> bool {
    list.as_array().is_some_and(|items| items.iter().any(|i| i == item))
}

/// The models of `GET /api/v1/models` a call can use: served on the chat completions with text
/// out (so the `:batch` ids drop out), grouped by the vendor before `/`, with prices per million
/// tokens and the reasoning metadata.
pub fn models(reply: &Reply, key: &Secret) -> Result<Vec<(ModelOption, Option<Reasoning>)>, Refusal> {
    if !success(reply) {
        return Err(refusal(reply, key));
    }
    let value: Value = serde_json::from_str(&reply.body).map_err(|_| bad_output())?;
    let data = value["data"].as_array().ok_or_else(bad_output)?;
    Ok(data
        .iter()
        .filter(|model| has(&model["endpoints"], CHAT) && has(&model["architecture"]["output_modalities"], "text"))
        .filter_map(|model| {
            let id = model["id"].as_str().filter(|id| guard::check_model(id).is_ok())?;
            let reasoning = model["reasoning"].is_object().then(|| Reasoning {
                mandatory: model["reasoning"]["mandatory"].as_bool().unwrap_or(false),
                supported_efforts: model["reasoning"]["supported_efforts"]
                    .as_array()
                    .map(|efforts| efforts.iter().filter_map(|e| e.as_str().map(str::to_string)).collect())
                    .unwrap_or_default(),
            });
            let option = ModelOption {
                id: id.to_string(),
                label: model["name"].as_str().unwrap_or(id).to_string(),
                group: id.split_once('/').map(|(vendor, _)| vendor.to_string()),
                prompt_per_m_tok: per_million(&model["pricing"]["prompt"]),
                completion_per_m_tok: per_million(&model["pricing"]["completion"]),
                supports_effort: Some(reasoning.is_some()),
            };
            Some((option, reasoning))
        })
        .collect())
}

/// The key test's result from `GET /api/v1/key`: the limit left and the free-tier flag, never
/// the `label`.
pub fn test_result(reply: &Reply, key: &Secret) -> TestResult {
    if !success(reply) {
        return TestResult { ok: false, detail: Some(refusal(reply, key).reason.to_string()), ..TestResult::default() };
    }
    let value: Value = serde_json::from_str(&reply.body).unwrap_or(Value::Null);
    TestResult {
        ok: true,
        detail: None,
        limit_remaining: value["data"]["limit_remaining"].as_f64(),
        is_free_tier: value["data"]["is_free_tier"].as_bool(),
    }
}

pub async fn run(
    client: &reqwest::Client,
    endpoint: &Endpoint,
    key: &Secret,
    call: &Call<'_>,
    reasoning: Option<&Reasoning>,
    deny_collection: bool,
) -> Result<Answer, Refusal> {
    guard::check_model(call.model)?;
    guard::check_prompt(call.system)?;
    guard::check_prompt(call.user)?;
    let sent = Method::Post(body(call, reasoning, deny_collection));
    let reply = guard::send(client, endpoint, CHAT, sent, key, &[]).await?;
    answer(&reply, key, call.model)
}

pub async fn list(
    client: &reqwest::Client,
    endpoint: &Endpoint,
    key: &Secret,
) -> Result<Vec<(ModelOption, Option<Reasoning>)>, Refusal> {
    let reply = guard::send(client, endpoint, "/api/v1/models", Method::Get, key, &[]).await?;
    models(&reply, key)
}

pub async fn test(client: &reqwest::Client, endpoint: &Endpoint, key: &Secret) -> TestResult {
    match guard::send(client, endpoint, "/api/v1/key", Method::Get, key, &[]).await {
        Ok(reply) => test_result(&reply, key),
        Err(refused) => TestResult { ok: false, detail: Some(refused.reason.to_string()), ..TestResult::default() },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_server::serve_once;

    const FAKE: &str = "sk-or-v1-FAKEKEY-openrouter-0123456789";

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
        Call { system: "Be brief.", user: "<text>fix it</text>", model, max_tokens: 10_000 }
    }

    fn reasoning(mandatory: bool, efforts: &[&str]) -> Reasoning {
        Reasoning { mandatory, supported_efforts: efforts.iter().map(|e| e.to_string()).collect() }
    }

    #[test]
    fn the_body_asks_no_data_collection_and_follows_the_reasoning_rule() {
        let mandatory = reasoning(true, &["low", "high"]);
        assert_eq!(
            body(&call("deepseek/r1"), Some(&mandatory), true),
            json!({
                "model": "deepseek/r1",
                "messages": [
                    { "role": "system", "content": "Be brief." },
                    { "role": "user", "content": "<text>fix it</text>" },
                ],
                "max_tokens": 4096,
                "stream": false,
                "provider": { "data_collection": "deny" },
                "reasoning": { "effort": "low" },
            })
        );
        let allowed = body(&call("anthropic/claude-haiku-5.5"), Some(&reasoning(false, &["low"])), false);
        assert_eq!((allowed.get("provider"), &allowed["reasoning"]), (None, &json!({ "effort": "none" })));
        let plain = body(&call("meta/llama-4"), None, true);
        assert_eq!((plain.get("reasoning"), &plain["provider"]), (None, &json!({ "data_collection": "deny" })));
        assert_eq!(effort(&reasoning(true, &[])), "low");
        assert_eq!(effort(&reasoning(true, &["high", "minimal"])), "minimal", "the lowest it takes");
        assert_eq!(effort(&reasoning(true, &["medium", "max"])), "medium");
        assert_eq!(effort(&reasoning(false, &["low"])), "none");
        for sent in [allowed, plain] {
            for field in ["temperature", "top_p", "top_k"] {
                assert_eq!(sent.get(field), None, "{field}");
            }
        }
    }

    #[test]
    fn an_answer_reads_the_content_the_usage_and_the_cost() {
        let ok = reply(
            200,
            &[],
            r#"{"model":"anthropic/claude-haiku-5.5","choices":[{"finish_reason":"stop","message":{"role":"assistant","content":"Fix the login."}}],
               "usage":{"prompt_tokens":700,"completion_tokens":40,"total_tokens":740,"prompt_tokens_details":{"cached_tokens":5},"cost":0.00091,"is_byok":false}}"#,
        );
        assert_eq!(
            answer(&ok, &key(), "anthropic/claude-haiku-5.5"),
            Ok(Answer {
                text: "Fix the login.".into(),
                model: "anthropic/claude-haiku-5.5".into(),
                provider: "openrouter",
                usage: Usage { input_tokens: 700, output_tokens: 40, cache_read_tokens: 5, cache_write_tokens: 0 },
                cost_usd: Some(0.00091),
                stop_reason: "stop".into(),
                notices: Vec::new(),
            })
        );
        let finish = |reason: &str, content: &str| {
            let body = format!(r#"{{"choices":[{{"finish_reason":"{reason}","message":{{"content":"{content}"}}}}],"usage":{{}}}}"#);
            answer(&reply(200, &[], &body), &key(), "m").map(|a| a.text).map_err(|r| r.reason)
        };
        assert_eq!(finish("length", ""), Err("assistant_truncated"), "the budget went to reasoning");
        assert_eq!(finish("length", "Fix the"), Err("assistant_truncated"));
        assert_eq!(finish("content_filter", ""), Err("assistant_refused"));
        assert_eq!(finish("stop", "  "), Err("assistant_bad_output"));
        assert_eq!(finish("stop", "fine"), Ok("fine".to_string()));
        let failed = reply(200, &[], r#"{"error":{"code":502,"message":"upstream failed"},"choices":[]}"#);
        let refused = answer(&failed, &key(), "m").err();
        assert_eq!(
            refused.as_ref().map(|r| (r.reason, r.params.get("detail").map(String::as_str))),
            Some(("assistant_overloaded", Some("upstream failed"))),
            "an error in a 200 body"
        );
        assert_eq!(answer(&reply(200, &[], "not json"), &key(), "m").map_err(|r| r.reason), Err("assistant_bad_output"));
    }

    #[test]
    fn each_error_status_has_its_reason_and_never_the_key() {
        let error = |code: u16, message: &str, source: Option<&str>| {
            let metadata = source.map(|s| format!(r#","metadata":{{"limit_source":"{s}"}}"#)).unwrap_or_default();
            reply(code, &[], &format!(r#"{{"error":{{"code":{code},"message":"{message}"{metadata}}}}}"#))
        };
        let reason = |sent: &Reply| refusal(sent, &key()).reason;
        assert_eq!(reason(&error(401, "No auth credentials found", None)), "assistant_auth");
        assert_eq!(reason(&error(402, "Insufficient credits", Some("openrouter_credits"))), "assistant_credits");
        assert_eq!(reason(&error(402, "Key limit", Some("openrouter_key_limit"))), "assistant_credits");
        assert_eq!(reason(&error(403, "Budget reached", Some("openrouter_key_budget"))), "assistant_credits");
        assert_eq!(reason(&error(403, "Flagged by moderation", None)), "assistant_auth");
        assert_eq!(reason(&error(404, "No such model", None)), "assistant_model_unavailable");
        assert_eq!(reason(&error(408, "Timed out", None)), "assistant_timeout");
        assert_eq!(reason(&error(429, "Slow down", None)), "assistant_rate_limited");
        assert_eq!(reason(&error(502, "Bad gateway", None)), "assistant_overloaded");
        assert_eq!(reason(&error(503, "No available model provider", None)), "assistant_routing_unavailable");
        assert_eq!(reason(&error(400, "Bad request", None)), "assistant_bad_output");

        let mut busy = error(402, "Too many in flight", Some("openrouter_in_flight_budget"));
        busy.headers.push(("retry-after".into(), "12".into()));
        let busy = refusal(&busy, &key());
        assert_eq!((busy.reason, busy.params.get("retryAfter").map(String::as_str)), ("assistant_credits", Some("12")));
        let mut limited = error(429, "Slow down", None);
        limited.headers.push(("Retry-After".into(), "5".into()));
        assert_eq!(refusal(&limited, &key()).params.get("retryAfter").map(String::as_str), Some("5"));
        let forbidden = refusal(&error(403, "Flagged by moderation", None), &key());
        assert_eq!(forbidden.params.get("detail").map(String::as_str), Some("Flagged by moderation"));
        let echoed = refusal(&error(401, &format!("bad key {FAKE}"), None), &key());
        assert_eq!(echoed.params.get("detail").map(String::as_str), Some("bad key <key>"));
        assert!(!format!("{echoed:?}").contains("FAKEKEY"));
    }

    #[test]
    fn the_list_keeps_chat_text_models_grouped_by_vendor_with_prices_per_million() {
        let list = reply(
            200,
            &[],
            r#"{"data":[
              {"id":"anthropic/claude-haiku-5.5","name":"Anthropic: Claude Haiku 5.5","endpoints":["/api/v1/chat/completions"],
               "architecture":{"output_modalities":["text"]},"pricing":{"prompt":"0.000001","completion":"0.000005"},
               "reasoning":{"mandatory":false,"default_enabled":false,"supported_efforts":["low","high"]}},
              {"id":"anthropic/claude-haiku-5.5:batch","name":"Batch","endpoints":["/api/v1/batches"],
               "architecture":{"output_modalities":["text"]},"pricing":{"prompt":"0.0000005","completion":"0.0000025"}},
              {"id":"vendor/painter","name":"Painter","endpoints":["/api/v1/chat/completions"],
               "architecture":{"output_modalities":["image"]},"pricing":{"prompt":"0","completion":"0"}},
              {"id":"deepseek/r1:free","name":"DeepSeek R1 (free)","endpoints":["/api/v1/chat/completions"],
               "architecture":{"output_modalities":["text"]},"pricing":{"prompt":"0","completion":"0"},
               "reasoning":{"mandatory":true,"supported_efforts":[]}},
              {"id":"bad id","name":"Bad","endpoints":["/api/v1/chat/completions"],"architecture":{"output_modalities":["text"]},"pricing":{}}
            ]}"#,
        );
        assert_eq!(
            models(&list, &key()),
            Ok(vec![
                (
                    ModelOption {
                        id: "anthropic/claude-haiku-5.5".into(),
                        label: "Anthropic: Claude Haiku 5.5".into(),
                        group: Some("anthropic".into()),
                        prompt_per_m_tok: Some(1.0),
                        completion_per_m_tok: Some(5.0),
                        supports_effort: Some(true),
                    },
                    Some(reasoning(false, &["low", "high"]))
                ),
                (
                    ModelOption {
                        id: "deepseek/r1:free".into(),
                        label: "DeepSeek R1 (free)".into(),
                        group: Some("deepseek".into()),
                        prompt_per_m_tok: Some(0.0),
                        completion_per_m_tok: Some(0.0),
                        supports_effort: Some(true),
                    },
                    Some(reasoning(true, &[]))
                ),
            ])
        );
        assert_eq!(models(&reply(401, &[], "{}"), &key()).map_err(|r| r.reason), Err("assistant_auth"));
        assert_eq!(models(&reply(200, &[], "[]"), &key()).map_err(|r| r.reason), Err("assistant_bad_output"));
    }

    #[test]
    fn the_key_test_gives_the_limit_and_the_free_tier_and_never_the_label() {
        let key_info = reply(
            200,
            &[],
            r#"{"data":{"label":"sk-or-v1-au7...890","limit":10,"limit_remaining":7.5,"usage":2.5,"is_free_tier":false}}"#,
        );
        let tested = test_result(&key_info, &key());
        assert_eq!(
            tested,
            TestResult { ok: true, detail: None, limit_remaining: Some(7.5), is_free_tier: Some(false) }
        );
        let sent = serde_json::to_string(&tested).unwrap_or_default();
        assert!(!sent.contains("label") && !sent.contains("sk-or"), "{sent}");
        assert_eq!(
            test_result(&reply(401, &[], "{}"), &key()),
            TestResult { ok: false, detail: Some("assistant_auth".into()), ..TestResult::default() }
        );
    }

    #[test]
    fn a_run_posts_to_chat_completions_with_no_attribution_headers() {
        let (base, seen) = serve_once(
            "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":\"Done.\"}}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"cost\":0.0001}}",
        );
        let run_on = |model: &'static str| {
            let base = base.clone();
            tokio::runtime::Builder::new_current_thread().enable_all().build().map_err(|_| "rt").and_then(|rt| {
                rt.block_on(async move {
                    let client = guard::client().map_err(|r| r.reason)?;
                    let endpoint = Endpoint::with_base(&base).map_err(|r| r.reason)?;
                    run(&client, &endpoint, &key(), &call(model), None, true).await.map(|a| a.text).map_err(|r| r.reason)
                })
            })
        };
        assert_eq!(run_on("../api/v1/key"), Err("assistant_model_unavailable"), "checked before any request");
        assert_eq!(run_on("meta/llama-4"), Ok("Done.".to_string()));
        let raw = seen.lock().map(|r| r.to_ascii_lowercase()).unwrap_or_default();
        assert!(raw.starts_with("post /api/v1/chat/completions "), "{raw}");
        assert!(raw.contains(&format!("authorization: bearer {}", FAKE.to_ascii_lowercase())));
        assert!(raw.contains("\"data_collection\":\"deny\""), "{raw}");
        for header in ["http-referer", "x-openrouter-title", "x-title", "origin:"] {
            assert!(!raw.contains(header), "{header}");
        }
    }
}
