import type { Page } from "playwright-core";

/** The English text of a print's name regex: `^(A|B)$` reads "A". */
const label = (pattern: RegExp | string): string =>
  typeof pattern === "string"
    ? pattern
    : (pattern.source
        .replace(/^\^\(?/, "")
        .replace(/\)?\$?$/, "")
        .split("|")[0]
        ?.replaceAll("\\", "") ?? "");

/**
 * A page that does nothing but write down what a print's steps drive: each step reads
 * `<action> <control> > <control>`, with the English text of the control it names. A print's
 * `prepare` runs against it without a browser.
 */
export function recordingPage(): { page: Page; steps: string[] } {
  const steps: string[] = [];
  const locator = (chain: string[]): unknown =>
    new Proxy(
      {},
      {
        get: (_target, prop: string) => {
          if (prop === "then") return undefined;
          if (prop === "first") return () => locator(chain);
          if (prop === "getByRole") {
            return (role: string, options?: { name?: RegExp | string }) =>
              locator([...chain, `${role}[${label(options?.name ?? "")}]`]);
          }
          if (prop === "getByText" || prop === "getByLabel") {
            return (pattern: RegExp | string) =>
              locator([...chain, `${prop === "getByText" ? "text" : "label"}[${label(pattern)}]`]);
          }
          if (prop === "waitForTimeout") return async () => {};
          return async (...args: unknown[]) => {
            const text = prop === "fill" ? ` "${String(args[0])}"` : "";
            steps.push(`${prop}${text} ${chain.join(" > ")}`);
          };
        },
      },
    );
  return { page: locator([]) as Page, steps };
}
