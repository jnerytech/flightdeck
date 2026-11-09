import { describe, expect, test } from "bun:test";
import { DOMAINS, HANDLERS } from "../src/server/handlers/index.ts";

describe("server-registry", () => {
  test("no command has a handler in two domains, and the registry holds every domain's", () => {
    const owners = new Map<string, string[]>();
    for (const [domain, handlers] of Object.entries(DOMAINS)) {
      for (const command of Object.keys(handlers)) {
        owners.set(command, [...(owners.get(command) ?? []), domain]);
      }
    }
    const twice = [...owners].filter(([, domains]) => domains.length > 1);
    expect(twice).toEqual([]);
    expect(Object.keys(HANDLERS).sort()).toEqual([...owners.keys()].sort());
  });

  // Issue #1288: the sign-in with GitHub and the board sync left the switch of server.ts.
  test("the github domain owns the github.* and boardsync.* commands", () => {
    expect(Object.keys(DOMAINS.github ?? {}).sort()).toEqual(
      [
        "boardsync.boards",
        "boardsync.link",
        "boardsync.log",
        "boardsync.setMap",
        "boardsync.setPush",
        "boardsync.status",
        "boardsync.syncNow",
        "boardsync.unlink",
        "github.issues",
        "github.login.cancel",
        "github.login.start",
        "github.logout",
        "github.repos",
        "github.start",
        "github.status",
      ].sort(),
    );
  });

  // Issue #1288: the knowledge commands left the switch of server.ts.
  test("the knowledge domain owns the knowledge.* commands", () => {
    expect(Object.keys(DOMAINS.knowledge ?? {}).sort()).toEqual(
      [
        "knowledge.create",
        "knowledge.feed",
        "knowledge.index",
        "knowledge.list",
        "knowledge.setFeed",
        "knowledge.setStatus",
      ].sort(),
    );
  });

  // Issue #1288: the watch commands left the switch of server.ts.
  test("the watch domain owns the watch.* commands", () => {
    expect(Object.keys(DOMAINS.watch ?? {}).sort()).toEqual(
      [
        "watch.byUrl",
        "watch.describe",
        "watch.extend",
        "watch.get",
        "watch.resolveHeld",
        "watch.set",
        "watch.settings",
        "watch.trace",
        "watch.watch",
      ].sort(),
    );
  });

  // Issue #1288: the folder and file commands left the switch of server.ts.
  test("the files domain owns the file.*, files.sessions and fs.* commands", () => {
    expect(Object.keys(DOMAINS.files ?? {}).sort()).toEqual(
      [
        "file.list",
        "file.read",
        "file.search",
        "file.write",
        "files.sessions",
        "fs.dirs",
        "fs.files",
      ].sort(),
    );
  });

  // Issue #1288: the host's own controls left the switch of server.ts (host.info follows later).
  test("the host domain owns the host, daemon, maintenance, hooks and memory-hold controls", () => {
    expect(Object.keys(DOMAINS.host ?? {}).sort()).toEqual(
      [
        "daemon.shutdown",
        "daemon.update.apply",
        "daemon.update.check",
        "hooks.install",
        "hooks.status",
        "hooks.uninstall",
        "host.bypass",
        "host.keepAwake",
        "host.sleep",
        "host.updates.set",
        "maintenance.backup",
        "maintenance.prune",
        "maintenance.status",
        "resources.setPauseAt",
      ].sort(),
    );
  });

  // Issue #1288: the teleport commands left the switch of server.ts.
  test("the teleport domain owns the teleport.* commands", () => {
    expect(Object.keys(DOMAINS.teleport ?? {}).sort()).toEqual(
      [
        "teleport.abort",
        "teleport.cancel",
        "teleport.finish",
        "teleport.prepare",
        "teleport.read",
        "teleport.receive",
        "teleport.write",
      ].sort(),
    );
  });

  // Issue #1288: the card commands left the switch of server.ts (board.*, pr.comments follow later).
  test("the card domain owns the card.* commands", () => {
    expect(Object.keys(DOMAINS.card ?? {}).sort()).toEqual(
      [
        "card.arena",
        "card.chooseVariant",
        "card.complete",
        "card.create",
        "card.delete",
        "card.diff",
        "card.discard",
        "card.dismissUnblocked",
        "card.get",
        "card.manage",
        "card.mergeLocal",
        "card.message",
        "card.move",
        "card.pr.create",
        "card.pr.merge",
        "card.spec",
        "card.start",
        "card.startArena",
        "card.stop",
        "card.templates",
        "card.update",
        "card.updateFromBase",
        "card.validationTemplate",
      ].sort(),
    );
  });

  // Issue #1288: the project commands left the switch of server.ts (board.* and roots.add follow later).
  test("the project domain owns the project, projects and harness template commands", () => {
    expect(Object.keys(DOMAINS.project ?? {}).sort()).toEqual(
      [
        "harness.templates.delete",
        "harness.templates.list",
        "project.add",
        "project.harness.apply",
        "project.harness.commit",
        "project.harness.draft",
        "project.harness.export",
        "project.harness.preview",
        "project.harness.stack",
        "project.list",
        "project.trust.inspect",
        "project.trust.set",
        "project.trust.state",
        "project.update",
        "projects.clone",
        "projects.scan",
      ].sort(),
    );
  });

  // Issue #1344: "While you were away" reads what happened on the host since a time.
  test("the activity domain owns activity.since", () => {
    expect(Object.keys(DOMAINS.activity ?? {}).sort()).toEqual(["activity.since"]);
  });
});
