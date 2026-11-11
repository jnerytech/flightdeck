import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DAEMON_FEATURES } from "@flightdeck/protocol";
import { GATES, GROUP_GATES } from "../../src/server/gates.ts";
import { featuresOf } from "../../src/server/host-info.ts";
import type { ServerOptions } from "../../src/server.ts";

// #747: this check reads the sources and starts no server, so it stays in the unit tier, which a
// worker's `test:related -- --fast --tier unit,component` runs. Inside core/refusals-resource.test.ts
// (integration, it starts a daemon) it ran only in CI, and 5 branches pushed a feature they used
// before listing it.
describe("daemon features: the list in the protocol matches the server", () => {
  test("the server uses only listed features, and every listed feature is used", () => {
    // Issue #248: the names live in server.ts, in its handler modules and in the gate tables.
    // Repo-relative, so `test:related` picks this file when one of them changes (it matches quoted paths).
    const root = resolve(import.meta.dir, "../../../..");
    const dir = resolve(root, "apps/daemon/src/server");
    const files = [
      resolve(root, "apps/daemon/src/server.ts"),
      ...readdirSync(dir, { recursive: true })
        .map(String)
        .filter((f) => f.endsWith(".ts"))
        .map((f) => resolve(dir, f)),
    ];
    const source = files.map((f) => readFileSync(f, "utf8")).join("\n");
    const used = new Set([
      ...[...source.matchAll(/featureOff\("(\w+)"\)/g)].map((m) => m[1]),
      ...Object.values(GATES).filter((feature) => /^\w+$/.test(feature)),
      // The options grouped by domain (#1593) gate each of their services.
      ...Object.values(GROUP_GATES)
        .flatMap((group) => Object.values(group) as string[])
        .filter((feature) => /^\w+$/.test(feature)),
    ]);
    expect(used.size).toBeGreaterThan(30);
    expect([...used].sort()).toEqual([...(DAEMON_FEATURES as readonly string[])].sort());
  });

  test("host.info announces each service of a grouped option on its own, not the group", () => {
    const knowledgeOf = (opts: object) =>
      featuresOf({ knowledge: opts } as unknown as ServerOptions).filter((f) =>
        f.startsWith("knowledge"),
      );
    const fn = async () => null;
    expect([
      knowledgeOf({ feed: fn }),
      knowledgeOf({ list: fn, status: fn, create: fn, feedSwitch: {} }),
    ]).toEqual([[], ["knowledge", "knowledgeFeed", "knowledgeStatus", "knowledgeCreate"]]);
    const harnessOf = (opts: object) =>
      featuresOf({ harness: opts } as unknown as ServerOptions).filter((f) =>
        f.startsWith("harness"),
      );
    // Each service alone, so a swapped name between two services turns this red.
    const services = ["stack", "preview", "apply", "templates", "draft", "commit"];
    expect([harnessOf({}), ...services.map((s) => harnessOf({ [s]: fn }))]).toEqual([
      [],
      ["harnessStack"],
      ["harnessPreview"],
      ["harnessApply"],
      ["harnessTemplates"],
      ["harnessDraft"],
      ["harnessCommit"],
    ]);
    const snippetsOf = (opts: object) =>
      featuresOf({ snippets: opts } as unknown as ServerOptions).filter((f) =>
        f.startsWith("snippet"),
      );
    // Only the library announces `snippets`; the group alone, `use` or `history` do not.
    expect([
      snippetsOf({}),
      snippetsOf({ use: {}, history: {} }),
      snippetsOf({ library: {} }),
    ]).toEqual([[], [], ["snippets"]]);
    const checksOf = (opts: object) =>
      featuresOf({ hostChecks: opts } as unknown as ServerOptions).filter(
        (f) => f === "doctor.run" || f === "depsCheck",
      );
    expect([checksOf({}), checksOf({ doctor: fn }), checksOf({ deps: fn })]).toEqual([
      [],
      ["doctor.run"],
      ["depsCheck"],
    ]);
    const quotaOf = (opts: object) =>
      featuresOf({ quota: opts } as unknown as ServerOptions).filter((f) => f.startsWith("quota"));
    // `quota.history` is not announced: the app asks it of a host that has the quota.
    expect([
      quotaOf({}),
      quotaOf({ windows: {} }),
      quotaOf({ pause: {} }),
      quotaOf({ history: {} }),
    ]).toEqual([[], ["quota"], ["quotaPause"], []]);
  });
});
