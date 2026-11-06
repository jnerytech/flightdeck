/**
 * Issue #248: the terminal domain: the embedded terminals and Claude Code's background sessions.
 */
import { FlightdeckError } from "../../errors.ts";
import type { Handlers } from "../dispatch.ts";
import { terminalSink } from "../transport.ts";

export const terminalHandlers = {
  "bg.list": async (_payload, { server }) => {
    return await server.need("bg").list();
  },
  "bg.start": async (payload, { server }) => {
    return await server.need("bg").start(payload);
  },
  "bg.stop": async (payload, { server }) => {
    return await server.need("bg").stop(payload.id);
  },
  "bg.respawn": async (payload, { server }) => {
    return await server.need("bg").respawn(payload.id);
  },
  "bg.message": async (payload, { server }) => {
    return await server.need("bg").message(payload.id, payload.text);
  },
  "terminal.open": async (payload, { server }) => {
    const { cwd, command: argv, claude, cols, rows } = payload;
    return await server.need("terminals").open({
      cwd,
      ...(argv ? { command: argv } : {}),
      ...(claude ? { claude } : {}),
      cols,
      rows,
    });
  },
  "terminal.write": (payload, { server }) => {
    server.need("terminals").write(payload.terminalId, payload.data);
  },
  "terminal.resize": (payload, { server }) => {
    server.need("terminals").resize(payload.terminalId, payload.cols, payload.rows);
  },
  "terminal.attach": (payload, { ws, server }) => {
    return server
      .need("terminals")
      .attach(payload.terminalId, terminalSink(ws), payload.flow === true);
  },
  "terminal.ack": (payload, { ws, server }) => {
    server.need("terminals").ack(payload.terminalId, terminalSink(ws), payload.bytes);
  },
  "terminal.detach": (payload, { ws, server }) => {
    server.need("terminals").detach(payload.terminalId, terminalSink(ws));
  },
  "terminal.close": (payload, { ws, server }) => {
    server.need("terminals").close(payload.terminalId, payload.kill, terminalSink(ws));
  },
  "terminal.list": (_payload, { server }) => {
    return { terminals: server.need("terminals").list() };
  },
  "terminal.settings": async (payload, { server }) => {
    const { enabled, confirm } = payload;
    const manager = server.need("terminals");
    if (enabled && !manager.enabled && confirm !== true) {
      throw new FlightdeckError(
        "invalid_state",
        "ligar o terminal dá um shell completo neste host: confirme com confirm: true",
        "terminal_enable_confirm",
      );
    }
    manager.setEnabled(enabled);
    await server.opts.onTerminalSettings?.(enabled);
    return manager.settings();
  },
} satisfies Partial<Handlers>;
