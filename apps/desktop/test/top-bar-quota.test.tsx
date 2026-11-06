import { afterEach, describe, expect, test } from "bun:test";
import { en } from "../src/i18n/en.ts";
import { translator } from "../src/i18n/index.ts";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { TopBarQuota } = await import("../src/components/shell/top-bar.tsx");

afterEach(() => cleanup());

const fill = (text: string, vars: Record<string, string>) =>
  Object.entries(vars).reduce((s, [k, v]) => s.replace(`{${k}}`, v), text);

for (const [lang, dict] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const t = translator(lang);
  const window = dict.account.windows.five_hour;
  describe(`top-bar-quota (${lang}): the plan quota at a glance in the top bar (issue #118)`, () => {
    test("it shows the window and the percent, says the rest in its name, and opens the host", async () => {
      const opened: string[] = [];
      render(
        <TopBarQuota
          t={t}
          glance={{
            hostId: "b",
            window: "five_hour",
            percent: 62,
            remaining: "2h 47m",
            level: "ok",
          }}
          hostName="beta"
          onOpen={(id) => opened.push(id)}
        />,
      );
      const name = fill(dict.shell.quotaLabel, {
        state: dict.shell.quotaLevels.ok,
        window,
        percent: "62",
        host: "beta",
        remaining: "2h 47m",
      });
      const button = screen.queryByRole("button", { name });
      expect(button).not.toBeNull();
      expect(button?.textContent ?? "").toContain("62%");
      expect(screen.queryByRole("meter")?.getAttribute("aria-valuenow")).toBe("62");
      await act(async () => {
        fireEvent.click(button as HTMLElement);
      });
      expect(opened).toEqual(["b"]);
    });

    test("near the limit it says so in words and with a mark, not by colour alone", () => {
      render(
        <TopBarQuota
          t={t}
          glance={{ hostId: "b", window: "five_hour", percent: 85, remaining: "", level: "near" }}
          hostName="beta"
          onOpen={() => undefined}
        />,
      );
      const name = fill(dict.shell.quotaLabelNoReset, {
        state: dict.shell.quotaLevels.near,
        window,
        percent: "85",
        host: "beta",
      });
      const button = screen.queryByRole("button", { name });
      expect(button).not.toBeNull();
      expect(button?.getAttribute("data-level")).toBe("near");
      expect(button?.querySelector("svg[data-mark]") !== null).toBe(true);
    });

    test("with no host reporting a quota, nothing shows", () => {
      render(<TopBarQuota t={t} glance={null} hostName="" onOpen={() => undefined} />);
      expect(screen.queryByRole("meter")).toBeNull();
    });
  });
}
