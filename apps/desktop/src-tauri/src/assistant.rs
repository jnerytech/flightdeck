//! Phase 40: the assistant's `#[tauri::command]`s, thin wrappers over the crate
//! `flightdeck-assistant` (ADR 40-3). A key goes in through `assistant_key_set` and never comes
//! back out; every other command reads it from the OS store itself. Each command answers a
//! refusal `{ reason, params }`, never a string. The blocking store work runs through
//! `spawn_blocking_result`.

use std::collections::HashMap;
use std::sync::{Mutex, MutexGuard, OnceLock, PoisonError};
use std::time::{Duration, Instant};

use flightdeck_assistant::guard::{self, Calls, Endpoint, Limits};
use flightdeck_assistant::keys::{self, KeyStatus, KeyringStore, Provider, Refusal, Saved, Secret};
use flightdeck_assistant::{anthropic, openrouter, Answer, Call, ModelOption, TestResult};
use serde::Deserialize;
use tauri::State;

use crate::{spawn_blocking_result, vault_entry};

/// How long a provider's model list is kept in memory.
const MODELS_FOR: Duration = Duration::from_secs(10 * 60);
/// A call's own limit: the client's total timeout and a little for the guards around it.
const CALL_LIMIT: Duration = Duration::from_secs(65);
/// The most vault ids one check reads.
const MAX_VAULT_IDS: usize = 200;

/// The protocol's `AssistantRequest`, as the app built it (`buildRequest`).
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AssistantRequest {
    request_id: String,
    system: String,
    user: String,
    model: String,
    max_tokens: u32,
}

enum Listing {
    Anthropic(Vec<(ModelOption, anthropic::Capabilities)>),
    OpenRouter(Vec<(ModelOption, Option<openrouter::Reasoning>)>),
}

impl Listing {
    fn options(&self) -> Vec<ModelOption> {
        match self {
            Listing::Anthropic(list) => list.iter().map(|(option, _)| option.clone()).collect(),
            Listing::OpenRouter(list) => list.iter().map(|(option, _)| option.clone()).collect(),
        }
    }
}

/// What the commands share: the limits, the calls running, one HTTP client and the model lists.
#[derive(Default)]
pub struct Assistant {
    limits: Limits,
    calls: Calls,
    client: OnceLock<guard::Client>,
    models: Mutex<HashMap<&'static str, (Instant, Listing)>>,
}

fn locked<T>(mutex: &Mutex<T>) -> MutexGuard<'_, T> {
    mutex.lock().unwrap_or_else(PoisonError::into_inner)
}

impl Assistant {
    /// Drops a provider's model list, as after its key was saved or deleted.
    fn forget(&self, provider: Provider) {
        let _ = provider;
    }

    fn client(&self) -> Result<guard::Client, Refusal> {
        if let Some(client) = self.client.get() {
            return Ok(client.clone());
        }
        let client = guard::client()?;
        Ok(self.client.get_or_init(|| client).clone())
    }

    /// What the cached list says of a model: the Anthropic capabilities, or OpenRouter's reasoning.
    fn known(&self, provider: Provider, model: &str) -> Known {
        let models = locked(&self.models);
        match models.get(provider.account()) {
            Some((at, _)) if at.elapsed() >= MODELS_FOR => Known::NoList,
            None => Known::NoList,
            Some((_, Listing::Anthropic(list))) => list
                .iter()
                .find(|(option, _)| option.id == model)
                .map_or(Known::Absent, |(_, caps)| Known::Capabilities(caps.clone())),
            Some((_, Listing::OpenRouter(list))) => list
                .iter()
                .find(|(option, _)| option.id == model)
                .map_or(Known::Absent, |(_, reasoning)| Known::Reasoning(reasoning.clone())),
        }
    }
}

enum Known {
    NoList,
    Absent,
    Capabilities(anthropic::Capabilities),
    Reasoning(Option<openrouter::Reasoning>),
}

/// A request id keys the cancel: the protocol's shape (a UUID fits), nothing a map could choke on.
fn request_id(id: &str) -> Result<(), Refusal> {
    let _ = id;
    Ok(())
}

fn store_failed() -> Refusal {
    Refusal::new("assistant_key_store")
}

/// The provider's key, read from the OS store on the blocking pool.
async fn key_of(provider: Provider) -> Result<Secret, Refusal> {
    spawn_blocking_result(move || Ok(keys::read_key(&KeyringStore, provider)))
        .await
        .map_err(|_| store_failed())?
}

fn endpoint(provider: Provider) -> Endpoint {
    match provider {
        Provider::Anthropic => Endpoint::anthropic(),
        Provider::OpenRouter => Endpoint::openrouter(),
    }
}

#[tauri::command]
pub async fn assistant_key_set(provider: String, key: String) -> Result<Saved, Refusal> {
    spawn_blocking_result(move || Ok(keys::set_key(&KeyringStore, &provider, &key)))
        .await
        .map_err(|_| store_failed())?
}

#[tauri::command]
pub async fn assistant_key_status(provider: String) -> Result<KeyStatus, Refusal> {
    spawn_blocking_result(move || Ok(keys::key_status(&KeyringStore, &provider)))
        .await
        .map_err(|_| store_failed())?
}

#[tauri::command]
pub async fn assistant_key_delete(provider: String) -> Result<(), Refusal> {
    spawn_blocking_result(move || Ok(keys::delete_key(&KeyringStore, &provider)))
        .await
        .map_err(|_| store_failed())?
}

/// Settings' "Test": Anthropic's free model list of one, OpenRouter's key; never the key's label.
#[tauri::command]
pub async fn assistant_test(
    state: State<'_, Assistant>,
    provider: String,
) -> Result<TestResult, Refusal> {
    let provider = Provider::parse(&provider)?;
    let _permit = state.limits.admit()?;
    let key = key_of(provider).await?;
    let client = state.client()?;
    Ok(match provider {
        Provider::Anthropic => anthropic::test(&client, &endpoint(provider), &key).await,
        Provider::OpenRouter => openrouter::test(&client, &endpoint(provider), &key).await,
    })
}

/// The models a person may pick, from the provider, kept 10 minutes.
#[tauri::command]
pub async fn assistant_models(
    state: State<'_, Assistant>,
    provider: String,
) -> Result<Vec<ModelOption>, Refusal> {
    let provider = Provider::parse(&provider)?;
    let cached = locked(&state.models)
        .get(provider.account())
        .filter(|(at, _)| at.elapsed() < MODELS_FOR)
        .map(|(_, listing)| listing.options());
    if let Some(options) = cached {
        return Ok(options);
    }
    let _permit = state.limits.admit()?;
    let key = key_of(provider).await?;
    let client = state.client()?;
    let listing = match provider {
        Provider::Anthropic => {
            Listing::Anthropic(anthropic::list(&client, &endpoint(provider), &key).await?)
        }
        Provider::OpenRouter => {
            Listing::OpenRouter(openrouter::list(&client, &endpoint(provider), &key).await?)
        }
    };
    let options = listing.options();
    locked(&state.models).insert(provider.account(), (Instant::now(), listing));
    Ok(options)
}

/// One call: the guards first (model, prompts, the limits, a vault value in the text), then the
/// provider, as a task that `assistant_cancel` or the limit aborts. The in-flight place goes with
/// the task, so a cancel or a timeout gives it back.
#[tauri::command]
pub async fn assistant_run(
    state: State<'_, Assistant>,
    provider: String,
    request: AssistantRequest,
    vault_ids: Vec<String>,
    deny_data_collection: bool,
) -> Result<Answer, Refusal> {
    let provider = Provider::parse(&provider)?;
    // The id keys the cancel: the protocol's shape (a UUID fits), nothing a map could choke on.
    if request.request_id.len() > 64 || flightdeck_assistant::token(&request.request_id).is_none() {
        return Err(Refusal::new("assistant_bad_output"));
    }
    guard::check_model(&request.model)?;
    guard::check_prompt(&request.system)?;
    guard::check_prompt(&request.user)?;
    let permit = state.limits.admit()?;
    let key = key_of(provider).await?;
    let text = format!("{}\n{}", request.system, request.user);
    let found = hits(text, vault_ids).await?;
    if !found.is_empty() {
        return Err(Refusal::new("assistant_vault_value").with("ids", found.join(",")));
    }
    let client = state.client()?;
    let known = state.known(provider, &request.model);
    let AssistantRequest { request_id, system, user, model, max_tokens } = request;
    let call = async move {
        let _permit = permit;
        let call = Call { system: &system, user: &user, model: &model, max_tokens };
        let at = endpoint(provider);
        match (provider, known) {
            (Provider::Anthropic, Known::Capabilities(caps)) => {
                anthropic::run(&client, &at, &key, &call, anthropic::Lookup::Listed(&caps)).await
            }
            (Provider::Anthropic, Known::Absent) => {
                anthropic::run(&client, &at, &key, &call, anthropic::Lookup::Absent).await
            }
            (Provider::Anthropic, _) => {
                anthropic::run(&client, &at, &key, &call, anthropic::Lookup::NoList).await
            }
            (Provider::OpenRouter, Known::Reasoning(reasoning)) => {
                openrouter::run(&client, &at, &key, &call, reasoning.as_ref(), deny_data_collection)
                    .await
            }
            (Provider::OpenRouter, _) => {
                openrouter::run(&client, &at, &key, &call, None, deny_data_collection).await
            }
        }
    };
    state.calls.run(&request_id, CALL_LIMIT, call).await
}

#[tauri::command]
pub async fn assistant_cancel(state: State<'_, Assistant>, request_id: String) -> Result<(), Refusal> {
    state.calls.cancel(&request_id);
    Ok(())
}

/// The ids of the vault values (at least 6 characters) the text contains; never a value.
#[tauri::command]
pub async fn vault_hits(text: String, ids: Vec<String>) -> Result<Vec<String>, Refusal> {
    guard::check_prompt(&text)?;
    hits(text, ids).await
}

async fn hits(text: String, ids: Vec<String>) -> Result<Vec<String>, Refusal> {
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    if ids.len() > MAX_VAULT_IDS {
        return Err(Refusal::new("assistant_too_long").with("max", MAX_VAULT_IDS.to_string()));
    }
    spawn_blocking_result(move || {
        let mut values = Vec::new();
        for id in ids {
            match vault_entry(&id).and_then(|entry| match entry.get_password() {
                Ok(value) => Ok(Some(value)),
                Err(keyring::Error::NoEntry) => Ok(None),
                Err(error) => Err(error.to_string()),
            }) {
                Ok(Some(value)) => values.push((id, Secret::new(value))),
                Ok(None) => {}
                Err(_) => return Ok(Err(store_failed())),
            }
        }
        Ok(Ok(guard::vault_hits(&text, &values)))
    })
    .await
    .map_err(|_| store_failed())?
}

#[cfg(test)]
mod tests {
    use super::*;

    fn option(id: &str) -> ModelOption {
        ModelOption { id: id.into(), label: id.into(), ..ModelOption::default() }
    }

    #[test]
    fn a_saved_or_deleted_key_forgets_that_providers_model_list_only() {
        let state = Assistant::default();
        let caps = anthropic::Capabilities::default();
        locked(&state.models).insert(
            Provider::Anthropic.account(),
            (Instant::now(), Listing::Anthropic(vec![(option("m"), caps)])),
        );
        locked(&state.models).insert(
            Provider::OpenRouter.account(),
            (Instant::now(), Listing::OpenRouter(vec![(option("m"), None)])),
        );
        assert!(matches!(state.known(Provider::Anthropic, "m"), Known::Capabilities(_)));
        state.forget(Provider::Anthropic);
        assert!(matches!(state.known(Provider::Anthropic, "m"), Known::NoList));
        assert!(matches!(state.known(Provider::OpenRouter, "m"), Known::Reasoning(None)));
        assert!(matches!(state.known(Provider::OpenRouter, "other"), Known::Absent));
    }

    #[test]
    fn a_request_id_is_a_short_token() {
        assert_eq!(request_id("0b6c1f9e-2c55-4c3e-9a51-6f1c1d2e3f40"), Ok(()));
        let long = "x".repeat(65);
        for bad in ["", "a b", long.as_str(), "id\n", "id/../x"] {
            assert_eq!(request_id(bad).map_err(|r| r.reason), Err("assistant_bad_output"), "{bad:?}");
        }
    }
}
