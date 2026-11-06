//! Phase 40 (ADR 40-3): the AI assistant's Rust logic, without Tauri, so it builds and is tested on
//! any host: the provider keys in the OS credential store, the Anthropic and OpenRouter calls, and
//! the guards a compromised webview cannot lift. The app's `#[tauri::command]`s only wrap it.
