import { afterEach, describe, expect, test } from "bun:test";
import { ptBR } from "../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, fireEvent, render, waitFor, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { StartFromGithub } = await import("../src/components/projects/start-from-github.tsx");
const { GithubPanel } = await import("../src/components/hosts/github-panel.tsx");

afterEach(cleanup);

const REPO = {
  name: "octocat/app",
  description: "",
  private: false,
  url: "u",
  updatedAt: "2026-10-01T10:00:00Z",
};
const ISSUE = { id: "7", title: "Fix the login" };

function startStore(repos: unknown[]) {
  const asked: Array<{ type: string; payload: unknown }> = [];
  const store = {
    getState: () => ({ hosts: [{ id: "h", info: { allowedRoots: ["/a", "/b"] } }] }),
    router: { push: () => {} },
    hostRequest: async (_host: string, type: string, payload: unknown) => {
      asked.push({ type, payload });
      if (type === "github.repos") return { ok: true, data: { repos } };
      if (type === "github.issues") return { ok: true, data: { issues: [ISSUE] } };
      return { ok: true, data: { projectId: "p", path: "/a/app", reused: false } };
    },
  };
  return { store: store as never, asked };
}

const t = ptBR.githubStart;

describe("github-gaps: Start from GitHub", () => {
  test("an account with no repos says so", async () => {
    const { store } = startStore([]);
    render(<StartFromGithub store={store} hostId="h" onStarted={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.open }));
    });
    await waitFor(() => expect(screen.queryByText(t.noRepos)).not.toBeNull());
  });

  test("the whole repo can be picked again after an issue, another folder can be chosen, and Cancel closes", async () => {
    const { store, asked } = startStore([REPO]);
    render(<StartFromGithub store={store} hostId="h" onStarted={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.open }));
    });
    await waitFor(() =>
      expect(screen.queryByRole("radio", { name: /octocat\/app/ })).not.toBeNull(),
    );
    await act(async () => {
      fireEvent.click(screen.getByRole("radio", { name: /octocat\/app/ }));
    });
    await waitFor(() => expect(screen.queryByRole("radio", { name: /#7/ })).not.toBeNull());
    const issue = screen.getByRole("radio", { name: /#7/ }) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(issue);
    });
    expect(issue.checked).toBe(true);
    const whole = screen.getByRole("radio", { name: t.wholeRepo }) as HTMLInputElement;
    await act(async () => {
      fireEvent.click(whole);
    });
    expect(whole.checked).toBe(true);
    const folder = screen.getByRole("combobox", { name: t.folder }) as HTMLSelectElement;
    await act(async () => {
      fireEvent.change(folder, { target: { value: "/b" } });
    });
    expect(folder.value).toBe("/b");
    expect(asked.some((a) => a.type === "github.repos")).toBe(true);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ptBR.common.cancel }));
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  test("Escape closes the dialog too", async () => {
    const { store } = startStore([REPO]);
    render(<StartFromGithub store={store} hostId="h" onStarted={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: t.open }));
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

describe("github-gaps: the host's GitHub panel", () => {
  test("with gh missing, Check again asks the host once more", async () => {
    let asked = 0;
    const store = {
      hostCommand: async () => {
        asked += 1;
        return { installed: false, loggedIn: false, login: null, scopes: [], source: null };
      },
    };
    render(<GithubPanel store={store as never} host={{ id: "h" } as never} />);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: ptBR.github.recheck })).not.toBeNull(),
    );
    const before = asked;
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: ptBR.github.recheck }));
    });
    await waitFor(() => expect(asked).toBeGreaterThan(before));
  });
});
