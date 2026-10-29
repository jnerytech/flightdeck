import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { styleViolations } from "../../../scripts/lib/style-lint.ts";
import { cn } from "../src/lib/utils.ts";

const DESKTOP = resolve(import.meta.dir, "..");
const css = () => readFileSync(resolve(DESKTOP, "src/styles.css"), "utf8");

/** The declarations inside the first `selector { … }` block of the stylesheet. */
function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("}", start));
}

const TOKENS = [
  "--background",
  "--foreground",
  "--card",
  "--card-foreground",
  "--popover",
  "--popover-foreground",
  "--primary",
  "--primary-foreground",
  "--secondary",
  "--secondary-foreground",
  "--muted",
  "--muted-foreground",
  "--accent",
  "--accent-foreground",
  "--destructive",
  "--border",
  "--input",
  "--ring",
  // Session states (and the risk of phase 13), never as loose hex in the screens.
  "--status-running",
  "--status-needs-you",
  "--status-idle",
  "--status-ended",
  "--status-error",
  "--status-risk",
];

describe("base-ui", () => {
  test("cn junta classes e a última utilidade do mesmo grupo vence", () => {
    expect(cn("p-2", "p-4")).toBe("p-4");
    expect(cn("text-sm", false, null, undefined, "font-medium")).toBe("text-sm font-medium");
    expect(cn("bg-primary", { "opacity-50": true, hidden: false })).toBe("bg-primary opacity-50");
  });

  test("Tailwind v4 e shadcn/ui com versões fixas", () => {
    const pkg = JSON.parse(readFileSync(resolve(DESKTOP, "package.json"), "utf8")) as {
      dependencies: Record<string, string>;
    };
    const wanted = [
      "tailwindcss",
      "@tailwindcss/vite",
      "class-variance-authority",
      "clsx",
      "tailwind-merge",
      "lucide-react",
      "sonner",
      "cmdk",
      "radix-ui",
    ];
    for (const name of wanted) {
      expect(pkg.dependencies[name] ?? "").toMatch(/^\d+\.\d+\.\d+$/);
    }
    const components = JSON.parse(readFileSync(resolve(DESKTOP, "components.json"), "utf8"));
    expect(components.aliases.ui).toBe("@/components/ui");
    expect(components.tailwind.css).toBe("src/styles.css");
  });

  test("tokens nos dois temas; o CSS por tela saiu", () => {
    const source = css();
    expect(source).toContain('@import "tailwindcss";');
    const light = block(source, ":root");
    const dark = block(source, ".dark");
    for (const token of TOKENS) {
      expect(`${token} in :root: ${light.includes(`${token}:`)}`).toBe(`${token} in :root: true`);
      expect(`${token} in .dark: ${dark.includes(`${token}:`)}`).toBe(`${token} in .dark: true`);
    }
    // No rule per screen: the only class selector left is the theme's `.dark`.
    const classSelectors = [...source.matchAll(/^\s*\.([\w-]+)[^{]*\{/gm)].map((m) => m[1]);
    expect(classSelectors).toEqual(["dark"]);
  });

  test("lint de estilo: medidas fixas em style e cores fora dos tokens", () => {
    const source = [
      '<div style={{ width: 240 }} className="p-4" />',
      '<div style={{ marginTop: "12px" }} />',
      '<span className="bg-red-500 text-primary" />',
      '<span className={cn("text-[#ff0000]", ok && "border-border")} />',
      '<p className="bg-background text-muted-foreground border-destructive" />',
      "<div style={{ ['--progress' as string]: `${pct}%` }} />",
      '<svg fill="#fff" />',
    ].join("\n");
    expect(styleViolations(source)).toEqual([
      { line: 1, text: "width: 240", reason: "medida fixa em style" },
      { line: 2, text: 'marginTop: "12px"', reason: "medida fixa em style" },
      { line: 3, text: "bg-red-500", reason: "cor fora dos tokens" },
      { line: 4, text: "text-[#ff0000]", reason: "cor fora dos tokens" },
      { line: 7, text: 'fill="#fff"', reason: "cor fora dos tokens" },
    ]);
    expect(styleViolations('<div className="flex gap-2" />')).toEqual([]);
  });

  test("os componentes do shadcn ficam como o CLI gerou: um editado à mão volta para a cobertura", () => {
    const dir = resolve(DESKTOP, "src/components/ui");
    const manifestPath = resolve(DESKTOP, "components.lock.json");
    const manifest = existsSync(manifestPath)
      ? (JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Record<string, string> })
      : { files: {} };
    const actual = Object.fromEntries(
      readdirSync(dir)
        .sort()
        .map((file) => [
          file,
          createHash("sha256")
            .update(readFileSync(resolve(dir, file), "utf8").replaceAll("\r", ""))
            .digest("hex"),
        ]),
    );
    expect(Object.keys(actual).length).toBeGreaterThan(10);
    expect(manifest.files).toEqual(actual);
  });
});
