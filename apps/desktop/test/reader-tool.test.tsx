import { afterEach, describe, expect, test } from "bun:test";
import { writeTranscript } from "../../daemon/test/history-helpers.ts";
import { liveScreen, registerDom } from "./dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "./fixtures.ts";
import { settleMaybe, waiter } from "./wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../src/lib/app-store.ts");
const { TranscriptReader } = await import("../src/ui/TranscriptReader.tsx");
const { TContext } = await import("../src/i18n/context.tsx");
const { TooltipProvider } = await import("../src/components/ui/tooltip.tsx");

const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(3000);

const COMMAND = "cd /home/dev/p && grep -n TODO src/app.ts | head -40 && echo the whole command";
const json = (value: unknown) => JSON.stringify(value);

/**
 * Issue #606: a stored session where the assistant ran Bash (with its result) and then a Read that
 * has no result in the transcript yet.
 */
async function setup(language: string) {
  const d = makeDaemon(cleanups);
  const meta = { cwd: d.project, timestamp: "2026-11-06T10:00:00.000Z" };
  const call = (uuid: string, id: string, name: string, input: unknown) =>
    json({
      ...meta,
      type: "assistant",
      uuid,
      message: { role: "assistant", content: [{ type: "tool_use", id, name, input }] },
    });
  writeTranscript(d.historyRoot, "-p", "s1", [
    json({ ...meta, type: "user", uuid: "q1", message: { role: "user", content: "look" } }),
    call("a1", "t1", "Bash", { command: COMMAND }),
    json({
      ...meta,
      type: "user",
      uuid: "r1",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "src/app.ts:3: TODO" }],
      },
    }),
    call("a2", "t2", "Read", { file_path: "/home/dev/p/src/app.ts" }),
  ]);
  await d.history.scan();
  const server = d.listen();
  const store = new AppStore(memoryPlatform(false, language).platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  store.i18n.start();
  const hostId = await store.addHost({ name: "alfa", url: server.url, token: TOKEN });
  await settle(() => store.getState().hosts[0]?.status === "online");
  render(
    <TContext.Provider value={store.i18n.t}>
      <TooltipProvider>
        <TranscriptReader
          store={store}
          target={{ hostId, claudeSessionId: "s1" }}
          hostName="alfa"
          onResumed={() => {}}
        />
      </TooltipProvider>
    </TContext.Provider>,
  );
}

const row = (name: string) => screen.queryByRole("button", { name: new RegExp(`^${name}\\b`) });
const open = async (name: string) => {
  await settleMaybe(() => row(name) !== null);
  const button = row(name);
  expect(button).not.toBeNull();
  await act(async () => {
    fireEvent.click(button as HTMLElement);
  });
};
const text = () => document.body.textContent ?? "";

describe("reader-tool: a stored tool call opens to its full input and its result (#606)", () => {
  for (const [language, noResult] of [
    ["en", "No result in the transcript: still running, or cut short."],
    ["pt-BR", "Sem resultado no transcript: ainda rodando, ou interrompida."],
  ] as const) {
    test(`a row opens with a click to the whole command and the result; one with no result says so (${language})`, async () => {
      await setup(language);
      await settleMaybe(() => row("Bash") !== null);
      expect(row("Bash")?.getAttribute("aria-expanded") ?? "no button").toBe("false");
      await open("Bash");
      await settleMaybe(() => text().includes("src/app.ts:3: TODO"));
      expect([
        row("Bash")?.getAttribute("aria-expanded"),
        text().includes(COMMAND),
        text().includes("src/app.ts:3: TODO"),
      ]).toEqual(["true", true, true]);
      await open("Read");
      await settleMaybe(() => text().includes(noResult));
      expect(text().includes(noResult)).toBe(true);
    });
  }
});
