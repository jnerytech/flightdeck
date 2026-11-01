import { afterEach, describe, expect, test } from "bun:test";
import { DAEMON_REASONS } from "@flightdeck/protocol";
import { en } from "../src/i18n/en.ts";
import { refusalText, translateError } from "../src/i18n/errors.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { AppStore } from "../src/lib/app-store.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";

const enT = translator("en");
const ptT = translator("pt-BR");

const REASONS = [
  "cwd_missing",
  "cwd_outside_roots",
  "session_not_found",
  "session_ended",
  "session_not_ended",
  "personas_off",
  "session_not_running",
  "mcp_set_not_live",
  "mcp_query_not_live",
  "external_no_channel",
  "transcript_not_indexed",
  "session_maybe_active",
  "feature_off",
  "budget_needs_project",
  "budget_not_found",
  "period_inverted",
  "telemetry_confirm",
  "telemetry_owned_keys",
  "telemetry_port",
  "bg_cli_failed",
  "bg_not_found",
  "bg_no_message_path",
  "transport_refused",
  "secret_expired",
  "vault_full",
  "vault_action_unknown",
  "vault_action_failed",
  "secret_wait_cancelled",
  "secret_wait_timeout",
  "vault_closed",
  "secret_not_here",
  "secret_purpose_mismatch",
  "vault_rules_invalid",
  "ssh_target_not_found",
  "ssh_name_invalid",
  "ssh_host_invalid",
  "ssh_user_invalid",
  "ssh_port_invalid",
  "ssh_forward_agent_confirm",
  "ssh_remove_confirm",
  "ssh_jump_in_use",
  "ssh_key_path_needed",
  "ssh_vault_key_needed",
  "ssh_secret_ref_invalid",
  "ssh_jump_unknown",
  "ssh_jump_cycle",
  "ssh_alive_range",
  "ssh_forward_too_many",
  "ssh_forward_invalid",
  "ssh_too_many_tags",
  "ssh_tag_invalid",
  "ssh_hostkey_exists",
  "ssh_hostkey_mismatch",
  "ssh_target_unknown",
  "ssh_target_ambiguous",
  "ssh_password_in_action",
  "ssh_exec_off",
  "ssh_key_missing",
  "ssh_key_not_for_auth",
  "ssh_askpass_off",
  "ssh_jump_auth",
  "ssh_key_unreachable",
  "ssh_hostkey_unconfirmed",
  "ssh_hostkey_changed",
  "ssh_askpass_ticket_invalid",
  "ssh_askpass_no_app",
  "ssh_askpass_timeout",
  "ssh_askpass_request_unknown",
  "ssh_askpass_cancelled",
  "ssh_askpass_cmd_path",
  "ssh_key_perms",
  "ssh_agent_down",
  "ssh_add_refused",
  "ssh_import_cycle",
  "ssh_import_not_in_config",
  "ssh_import_exists",
  "ssh_import_multi_jump",
  "ssh_import_jump_unknown",
  "ssh_import_jump_failed",
  "ssh_test_auth",
  "ssh_test_refused",
  "ssh_test_host_unknown",
  "ssh_test_timeout",
  "ssh_test_hostkey",
  "ssh_test_exit",
  "ssh_test_no_password",
  "action_invalid",
  "action_param_unknown",
  "action_param_missing",
  "action_param_pattern",
  "action_secret_missing",
  "action_ssh_unavailable",
  "action_spawn_failed",
  "action_request_gone",
  "action_no_approval_needed",
  "action_tray_refused",
  "action_hold_needed",
  "action_session_refused_risky",
  "action_session_refused_rule",
  "action_needs_approval",
  "usage_rules_unavailable",
  "action_not_found",
  "action_changed_review",
  "action_ssh_host_unsupported",
  "action_secret_name_invalid",
  "action_not_trusted",
  "action_changed_since_trust",
  "action_requester_refused",
  "action_use_denied",
  "action_app_offline",
  "action_secret_refused",
  "action_secret_expired",
  "action_ssh_env_name",
  "action_ssh_env_value",
];

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

describe("recusas-daemon: the daemon's refusals about folders and sessions", () => {
  test("the protocol lists every reason, and each has a text in both languages", () => {
    expect([...(DAEMON_REASONS as readonly string[])].sort()).toEqual([...REASONS].sort());
    for (const reason of REASONS) {
      expect(typeof (en.daemonRefusal as Record<string, string>)[reason]).toBe("string");
      expect(typeof (ptBR.daemonRefusal as Record<string, string>)[reason]).toBe("string");
    }
  });

  test("a reason becomes the whole sentence, with its params, in the app's language", () => {
    const why = { reason: "cwd_outside_roots", params: { cwd: "/srv/x" } };
    expect(refusalText("forbidden_cwd", "folder outside allowedRoots: /srv/x", enT, why)).toContain(
      "The folder /srv/x is outside the host's allowed folders.",
    );
    expect(refusalText("forbidden_cwd", "folder outside allowedRoots: /srv/x", ptT, why)).toContain(
      "A pasta /srv/x está fora das pastas permitidas do host.",
    );
    expect(translateError("forbidden_cwd", "raw", enT, why).detail).toBe("");
  });

  test("a notice for a refusal keeps its reason and params, so the toast says it in the language", async () => {
    const d = makeDaemon(cleanups, {});
    const server = d.listen(0, 20);
    const store = new AppStore(memoryPlatform().platform, { baseDelayMs: 10 });
    cleanups.push(() => store.dispose());
    const hostId = await store.addHost({ name: "pc", url: server.url, token: TOKEN });
    const deadline = Date.now() + 3000;
    while (store.getState().hosts[0]?.status !== "online" && Date.now() < deadline) {
      await Bun.sleep(10);
    }
    await store.createSession(hostId, { cwd: "/folder/nobody/made", prompt: "hi" });
    expect(store.getState().notices[0]).toMatchObject({
      code: "forbidden_cwd",
      reason: "cwd_outside_roots",
      params: { cwd: "/folder/nobody/made" },
    });
  });
});
