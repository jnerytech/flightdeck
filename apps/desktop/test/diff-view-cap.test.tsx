import { afterEach, describe, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { DiffView } = await import("../src/ui/DiffView.tsx");

afterEach(cleanup);

const file = (extra: Record<string, unknown>) =>
  ({
    path: "dump.log",
    oldPath: null,
    status: "added",
    additions: 0,
    deletions: 0,
    uncommitted: true,
    binary: false,
    hunks: [],
    tooLarge: true,
    ...extra,
  }) as never;

const view = (f: unknown, onOpenOutside?: (file: never) => void) => (
  <DiffView
    files={[f as never]}
    mode="unified"
    selection={null}
    onPick={() => {}}
    composer={null}
    {...(onOpenOutside ? { onOpenOutside } : {})}
  />
);

describe("diff-view-cap: a file the daemon did not send says so", () => {
  test("with a size, the note carries it; without one, the note says it is too large and nothing more", () => {
    render(view(file({ bytes: 1_572_864 })));
    expect(screen.queryByText(/Grande demais para mostrar aqui \(1\.5 MB\)/)).not.toBeNull();
    cleanup();
    render(view(file({})));
    expect(screen.queryByText(/Grande demais para mostrar aqui\. Abra/)).not.toBeNull();
    expect(screen.queryByText(/\(/)).toBeNull();
  });

  test("no open button without a way to open, and with one it hands the file back", () => {
    render(view(file({ bytes: 700_000 })));
    expect(screen.queryByRole("button", { name: /na pasta/ })).toBeNull();
    cleanup();
    const opened: string[] = [];
    render(view(file({ bytes: 700_000 }), (f) => opened.push((f as { path: string }).path)));
    fireEvent.click(screen.getByRole("button", { name: "Mostrar dump.log na pasta" }));
    expect(opened).toEqual(["dump.log"]);
  });

  test("a deleted file has nothing to show in a folder, so it gets the note and no button", () => {
    render(view(file({ status: "deleted", bytes: 700_000 }), () => {}));
    expect(screen.queryByText(/Grande demais para mostrar aqui/)).not.toBeNull();
    expect(screen.queryByRole("button", { name: /na pasta/ })).toBeNull();
  });
});
