import { translator } from "../../src/i18n/index.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { waiter } from "../wait.ts";

registerDom();
// Loaded after the DOM exists: react-dom and Testing Library read it on import.
export const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
export const screen = liveScreen(within);
export const { AppStore } = await import("../../src/lib/app-store.ts");
export const { App } = await import("../../src/app/App.tsx");
export const { ApprovalCard } = await import("../../src/features/permissions/approval-card.tsx");

export const cleanups: Array<() => unknown> = [];
export async function teardown() {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
}

export const settle = waiter(4000);

export const t = translator("pt-BR");
export const AT = "2026-10-29T12:00:00.000Z";
export const NOW = Date.parse(AT) + 3 * 60_000;

export const group = (tool: string, within_: HTMLElement | null = document.body) =>
  within_ ? within(within_).queryByRole("group", { name: `Pedido de ${tool}` }) : null;
export const inGroup = (g: HTMLElement | null, name: string) =>
  g ? within(g).queryByRole("button", { name }) : null;
