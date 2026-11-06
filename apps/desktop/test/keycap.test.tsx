import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { Keycap, ShortcutKeys } = await import("../src/components/shortcuts/keycap.tsx");
const { keysText } = await import("../src/lib/shortcuts.ts");

afterEach(cleanup);

const kbds = () => [...document.querySelectorAll("kbd")];

describe("keycap: the one component that prints a key (issue #165)", () => {
  test("a key is a kbd with the keycap look, in the mono face, and takes a class", () => {
    render(<Keycap className="ml-auto">Alt+1</Keycap>);
    const [kbd] = kbds();
    expect(kbd?.textContent).toBe("Alt+1");
    expect(kbd?.className).toContain("keycap");
    expect(kbd?.className).toContain("font-mono");
    expect(kbd?.className).toContain("ml-auto");
  });

  test("a binding is written for the platform: Ctrl, or the command sign on a Mac", () => {
    render(
      <div>
        <ShortcutKeys keys={["Mod", "K"]} mac={false} />
        <ShortcutKeys keys={["Mod", "K"]} mac />
      </div>,
    );
    expect(kbds().map((k) => k.textContent)).toEqual(["Ctrl+K", "⌘K"]);
  });

  test("other modifiers keep their names and join with a plus; a chord is keys one after the other", () => {
    render(
      <div>
        <ShortcutKeys keys={["Alt", "Shift", "C"]} mac={false} />
        <ShortcutKeys keys={["g", "p"]} chord mac={false} />
        <ShortcutKeys keys={["Mod", "1…9"]} mac />
        <ShortcutKeys keys={["?"]} mac={false} />
      </div>,
    );
    expect(kbds().map((k) => k.textContent)).toEqual(["Alt+Shift+C", "g p", "⌘1…9", "?"]);
  });

  test("with no platform given it asks the browser", () => {
    const nav = globalThis.navigator as unknown as { platform?: string };
    const before = Object.getOwnPropertyDescriptor(nav, "platform");
    Object.defineProperty(nav, "platform", { value: "MacIntel", configurable: true });
    try {
      render(<ShortcutKeys keys={["Mod", "T"]} />);
      expect(kbds()[0]?.textContent).toBe("⌘T");
    } finally {
      if (before) Object.defineProperty(nav, "platform", before);
      else Reflect.deleteProperty(nav, "platform");
    }
    cleanup();
    render(<ShortcutKeys keys={["Mod", "T"]} />);
    expect(kbds()[0]?.textContent).toBe("Ctrl+T");
  });

  test("the text of a binding is one function, the same for the sheet, the palette and the tooltips", () => {
    expect(keysText(["Mod", "K"], false, false)).toBe("Ctrl+K");
    expect(keysText(["Mod", "K"], false, true)).toBe("⌘K");
    expect(keysText(["g", "s"], true, true)).toBe("g s");
    expect(keysText(["Alt", "←"], false, true)).toBe("Alt+←");
  });

  test("it is a kbd for a screen reader too: found as text where it is printed", () => {
    render(<ShortcutKeys keys={["Mod", "K"]} mac={false} />);
    expect(screen.getByText("Ctrl+K").tagName).toBe("KBD");
  });
});

describe("keycap: no screen draws its own (issue #165)", () => {
  const root = join(import.meta.dir, "../src").replaceAll("\\", "/");
  const files = (dir: string): string[] =>
    readdirSync(join(root, dir), { withFileTypes: true, recursive: true })
      .filter((e) => e.isFile() && e.name.endsWith(".tsx"))
      // One spelling of the separator, so the filters below read the same on Windows.
      .map((e) => join(e.parentPath, e.name).replaceAll("\\", "/"));

  test("a kbd appears only in the keycap component (the vendored ui folder aside)", () => {
    const found = ["ui", "components"]
      .flatMap(files)
      .filter((file) => !file.includes("/components/ui/"))
      .filter((file) => !file.endsWith("components/shortcuts/keycap.tsx"))
      .filter((file) => /<kbd[\s>]/.test(readFileSync(file, "utf8")))
      .map((file) => file.slice(root.length + 1));
    expect(found).toEqual([]);
  });
});
