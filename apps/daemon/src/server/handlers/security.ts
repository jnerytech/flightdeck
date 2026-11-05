/**
 * Issue #248: the security domain: the vault and its actions, askpass, SSH targets, a project's
 * rules, and the automatic approval.
 */
import { FlightdeckError } from "../../errors.ts";
import { requireVaultTransport } from "../../vault/vault.ts";
import type { Handlers } from "../dispatch.ts";

export const securityHandlers = {
  "vault.deliver": (payload, { ws, server }) => {
    // A request of the daemon that asks has to be approved before its secret is accepted.
    server.opts.actions?.gate(payload.purpose);
    return server.need("vault").deliver(payload, ws.data.origin);
  },
  "vault.use": (payload, { send, server }) => {
    const { secretId, purpose, action } = payload;
    const used = server.need("vault").use(secretId, purpose, action);
    // For the app's usage log: who, for what, when; never the value.
    send({
      type: "vault.used",
      secretId,
      purpose,
      requester: used.requester,
      action,
      at: new Date().toISOString(),
    });
    return { result: used.result };
  },
  "actions.list": async (payload, { server }) => {
    return await server.need("actions").list(payload.projectId);
  },
  "actions.save": async (payload, { server }) => {
    return await server.need("actions").save(payload);
  },
  "actions.remove": async (payload, { server }) => {
    return await server.need("actions").remove(payload.projectId, payload.name);
  },
  "actions.trust": async (payload, { server }) => {
    const { projectId, name, hash } = payload;
    return await server.need("actions").trust(projectId, name, hash);
  },
  "actions.run": async (payload, { server }) => {
    return await server.need("actions").run(payload);
  },
  "actions.runFree": async (payload, { server }) => {
    return await server.need("actions").runFree(payload);
  },
  "actions.runs": (payload, { server }) => {
    return { runs: server.need("actions").runs(payload) };
  },
  "vault.watch": (_payload, { ws, send, server }) => {
    const service = server.need("actions");
    ws.data.unwatchVault?.();
    ws.data.unwatchVault = service.watch((frame) => send(frame));
  },
  "vault.deny": (payload, { server }) => {
    server.need("actions").deny(payload.requestId);
  },
  "vault.rules.set": (payload, { server }) => {
    const { secretId, tags, rules } = payload;
    return { rules: server.need("actions").setRules(secretId, tags ?? [], rules) };
  },
  "vault.rules.get": (payload, { server }) => {
    const { secretId } = payload;
    return { secretId, ...server.need("actions").getRules(secretId) };
  },
  "vault.rules.preview": (payload, { server }) => {
    return server.need("actions").preview(payload);
  },
  "vault.approve": (payload, { server }) => {
    const { requestId, ...approval } = payload;
    server.need("actions").approve(requestId, approval);
  },
  "vault.decisions": (payload, { server }) => {
    return { decisions: server.need("actions").decisions(payload) };
  },
  "vault.report": (payload, { server }) => {
    return server.need("actions").report(payload);
  },
  "autoapprove.list": (payload, { server }) => {
    const { projectId, sessionKey, limit } = payload;
    return {
      decisions: server.need("autoApprove").list({
        ...(projectId ? { projectId } : {}),
        ...(sessionKey ? { sessionKey } : {}),
        ...(limit ? { limit } : {}),
      }),
      suspended: server.need("autoApprove").suspended(),
    };
  },
  "autoapprove.resume": (payload, { server }) => {
    if (payload.confirm !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "reativar a aprovação automática pede confirm: true",
        "autoapprove_resume_confirm",
      );
    }
    server.need("autoApprove").resume(payload.sessionKey);
    return { suspended: server.need("autoApprove").suspended() };
  },
  "rules.list": async (payload, { server }) => {
    return { rules: await server.need("board").listRules(payload.projectId) };
  },
  "rules.remove": async (payload, { server }) => {
    const { projectId, rule, confirm } = payload;
    return {
      rules: await server.need("board").removeRule(projectId, rule, confirm === true),
    };
  },
  "ssh.list": (_payload, { server }) => {
    return { targets: server.need("ssh").list() };
  },
  "ssh.save": (payload, { server }) => {
    return server.need("ssh").save(payload);
  },
  "ssh.remove": (payload, { server }) => {
    server.need("ssh").remove(payload.id, payload.confirm);
  },
  "askpass.watch": (_payload, { ws, send, server }) => {
    ws.data.unwatchAskpass?.();
    ws.data.unwatchAskpass = server.need("askpass").watch((frame) => send(frame));
  },
  "askpass.ask": async (payload, { server }) => {
    return {
      secret: await server.need("askpass").ask(payload.ticket, payload.prompt),
    };
  },
  "askpass.answer": (payload, { server }) => {
    server.need("askpass").answer(payload.requestId, payload.secret);
  },
  "ssh.connect": async (payload, { ws, server }) => {
    const { targetId, cols, rows, privateKey } = payload;
    // A key from the vault travels only where the vault delivers: loopback and Tailscale.
    if (privateKey) requireVaultTransport(ws.data.origin, "ssh.connect com chave", server.opts.log);
    const request = { targetId, cols, rows, ...(privateKey ? { privateKey } : {}) };
    return await server.need("sshConnect").connect(request);
  },
  "ssh.test": async (payload, { ws, server }) => {
    const { targetId, privateKey } = payload;
    if (privateKey) requireVaultTransport(ws.data.origin, "ssh.test com chave", server.opts.log);
    return await server
      .need("sshConnect")
      .test({ targetId, ...(privateKey ? { privateKey } : {}) });
  },
  "ssh.hostkey.check": async (payload, { server }) => {
    return await server.need("sshHostKeys").check(payload.targetId);
  },
  "ssh.hostkey.confirm": (payload, { server }) => {
    return server.need("sshHostKeys").confirm(payload.targetId, payload.fingerprint);
  },
  "ssh.hostkey.forget": (payload, { server }) => {
    return server.need("sshHostKeys").forget(payload.targetId);
  },
  "ssh.import.preview": async (_payload, { server }) => {
    return await server.need("sshImport").preview();
  },
  "ssh.import.apply": async (payload, { server }) => {
    return await server.need("sshImport").apply(payload.aliases);
  },
} satisfies Partial<Handlers>;
