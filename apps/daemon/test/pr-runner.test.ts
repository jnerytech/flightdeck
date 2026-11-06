import { afterEach, describe, expect, spyOn, test } from "bun:test";
import { type FakeCli, type FakeRule, installFakeCli } from "../../../scripts/test/fake-cli.ts";
import { AzureDevOpsCli, GithubCli } from "../src/board/pr.ts";
import { tempDir } from "./helpers.ts";

const AZ_WEB = "https://dev.azure.com/acme/proj/_git/repo";
const GH_URL = "https://github.com/acme/repo/pull/7";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0).reverse()) fn();
});

function fake(name: string, rules: FakeRule[]): FakeCli {
  const cli = installFakeCli(name, rules);
  cleanups.push(cli.restore);
  return cli;
}

/** Counts the processes started from here on. */
function spawns(): { count(): number } {
  const spy = spyOn(Bun, "spawn");
  cleanups.push(() => spy.mockRestore());
  return { count: () => spy.mock.calls.length };
}

describe("pr-runner: a provider given a command runner starts no process", () => {
  test("az: the calls go to the runner, from the az found on PATH, with the text made safe for its .cmd", async () => {
    // `az repos pr policy list` also has "pr" and "list": its rule comes first.
    const az = fake("az", [
      { args: ["policy", "list"], stdout: JSON.stringify([{ status: "approved" }]) },
      { args: ["pr", "list"], stdout: "[]" },
      {
        args: ["pr", "create"],
        stdout: JSON.stringify({ pullRequestId: 12, repository: { webUrl: AZ_WEB } }),
      },
      { args: ["pr", "show"], stdout: JSON.stringify({ status: "active" }) },
    ]);
    const ran: string[] = [];
    const provider = new AzureDevOpsCli({
      run: (cmd, cwd, input) => {
        ran.push(cmd[0] ?? "");
        return az.run(cmd, cwd, input);
      },
    });
    const cwd = tempDir();
    const started = spawns();
    const url = await provider.create({
      cwd,
      base: "main",
      head: "fd/x",
      title: "Título",
      body: "linha 1\nlinha 2 com 50% feito",
    });
    expect(url).toBe(`${AZ_WEB}/pullrequest/12`);
    expect(await provider.status({ cwd, url })).toEqual({ state: "open", checks: "passing" });
    expect(started.count()).toBe(0);
    expect(ran).toHaveLength(4);
    expect(ran.every((bin) => bin.startsWith(az.dir))).toBe(true);
    // The description reaches az as its .cmd would get it: one line, no %.
    const create = az.calls()[1] ?? [];
    expect(create[create.indexOf("--description") + 1]).toBe("linha 1 — linha 2 com 50 feito");
    expect(az.cwds()).toEqual([cwd, cwd, cwd, cwd]);
  });

  test("gh: the calls go to the runner, from the gh found on PATH", async () => {
    const gh = fake("gh", [
      { args: ["view", "url"], code: 1 },
      { args: ["pr", "create"], stdout: `Creating pull request\n${GH_URL}\n` },
      { args: ["view", "state,statusCheckRollup"], stdout: JSON.stringify({ state: "MERGED" }) },
    ]);
    const provider = new GithubCli({ run: gh.run });
    const cwd = tempDir();
    const started = spawns();
    const url = await provider.create({ cwd, base: "main", head: "fd/x", title: "t", body: "b" });
    expect(url).toBe(GH_URL);
    expect(await provider.status({ cwd, url })).toEqual({ state: "merged", checks: null });
    expect(started.count()).toBe(0);
    expect(gh.calls().map((c) => c.slice(0, 2).join(" "))).toEqual([
      "pr view",
      "pr create",
      "pr view",
    ]);
  });

  test("a runner that is not given leaves the CLI to its own process, found on PATH", async () => {
    const az = fake("az", [
      { args: ["pr", "show"], stdout: JSON.stringify({ status: "completed" }) },
      { args: ["policy", "list"], stdout: "[]" },
    ]);
    const started = spawns();
    const status = await new AzureDevOpsCli().status({
      cwd: tempDir(),
      url: `${AZ_WEB}/pullrequest/3`,
    });
    expect(status).toEqual({ state: "merged", checks: null });
    expect(started.count()).toBe(2);
    expect(az.calls()).toHaveLength(2);
  });
});
