import { afterEach, describe, expect, test } from "bun:test";
import { bgOptions } from "../../src/bg/wiring.ts";
import { EventStore } from "../../src/store/event-store.ts";

/**
 * Claude Code's background sessions as main.ts builds them (issue #1593): the `claude` to ask is
 * read at each call, a card starts from its project's folder with its title and description, and
 * the project trust and the allowed roots reach every place that runs in a folder.
 */

const stores: EventStore[] = [];
afterEach(() => {
  for (const store of stores.splice(0)) store.close();
});

function built() {
  const store = new EventStore(":memory:");
  stores.push(store);
  const config: { claude?: { executablePath?: string }; allowedRoots: string[] } = {
    claude: { executablePath: "/opt/claude-a" },
    allowedRoots: ["/w"],
  };
  const asked: string[] = [];
  const channel = (claudeSessionId: string, text: string) => claudeSessionId === "s1" && !!text;
  const options = bgOptions({
    db: store.db,
    config,
    channel,
    projectTrust: {
      sessionTrust: (cwd) => ({ trusted: cwd === "/w/p" }),
      prepare: async (cwd) => {
        asked.push(cwd);
      },
    },
    board: {
      getCard: (id) => ({
        title: `Card ${id}`,
        description: id === "c1" ? "Sum the total" : "",
        projectId: "p1",
      }),
      getProject: () => ({ path: "/w/p" }),
    },
    self: ["/bin/flightdeckd"],
    configFile: "/etc/fd.json",
  });
  return { options, config, channel, asked, db: store.db };
}

describe("bg-wiring: the background sessions the daemon builds (#1593)", () => {
  test("the claude to ask is the configured one, read at each call", () => {
    const { options, config } = built();
    const first = options.claude();
    config.claude = { executablePath: "/opt/claude-b" };
    expect([first, options.claude()]).toEqual(["/opt/claude-a", "/opt/claude-b"]);
  });

  test("a card starts in its project's folder, with its title and description as the prompt", () => {
    const { options } = built();
    expect([options.card?.("c1"), options.card?.("c2")]).toEqual([
      { cwd: "/w/p", prompt: "Card c1\n\nSum the total", name: "Card c1" },
      { cwd: "/w/p", prompt: "Card c2", name: "Card c2" },
    ]);
  });

  test("the project trust, the allowed roots and the start command reach the service", async () => {
    const { options, asked } = built();
    await options.prepare?.("/w/p");
    expect([
      options.trust?.("/w/p"),
      options.trust?.("/w/q"),
      asked,
      options.allowedRoots,
      options.start,
    ]).toEqual([
      { trusted: true },
      { trusted: false },
      ["/w/p"],
      ["/w"],
      { self: ["/bin/flightdeckd"], configFile: "/etc/fd.json", allowedRoots: ["/w"] },
    ]);
  });

  test("the database and the channel are the daemon's own", () => {
    const { options, channel, db } = built();
    expect([options.db === db, options.channel === channel]).toEqual([true, true]);
  });
});
