import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { IconTip } from "@/shared/feedback/index.ts";
import type { T } from "../../i18n/index.ts";
import { type FindFlags, findPatternProblem } from "./domain/terminal-view.ts";
import type { FindResults } from "./xterm-screen.ts";

/** Alt and a letter turn a find option on or off while the search box has the focus, as in VS Code. */
const FIND_KEYS: Record<string, keyof FindFlags> = {
  c: "caseSensitive",
  w: "wholeWord",
  r: "regex",
};

/** The find options' buttons: the option, its name, the glyph drawn for it and its key. */
const FIND_TOGGLES = [
  ["caseSensitive", "terminalUi.matchCase", "Aa", "Alt+C"],
  ["wholeWord", "terminalUi.wholeWord", "ab", "Alt+W"],
  ["regex", "terminalUi.useRegex", ".*", "Alt+R"],
] as const;

/** What the search box says about a pattern that cannot be searched. */
const PATTERN_PROBLEM = {
  invalid: "terminalUi.badPattern",
  empty: "terminalUi.emptyPattern",
} as const;

/** The terminal's search bar: the text, its options, where the match is, and next, previous and close. */
export function TerminalFind(
  props: Readonly<{
    t: T;
    needle: string;
    flags: FindFlags;
    /** Where the current match sits among all of them, as xterm reports it. */
    results: FindResults | null;
    onChange(text: string): void;
    onFlip(flag: keyof FindFlags): void;
    onFind(direction: "next" | "previous"): void;
    onClose(): void;
  }>,
) {
  const { t, needle, flags, results } = props;
  const problem = needle === "" ? null : findPatternProblem(needle, flags);
  const status = (found: FindResults) =>
    found.resultCount > 0
      ? t("terminalUi.matches", {
          index: String(Math.max(found.resultIndex, 0) + 1),
          count: String(found.resultCount),
        })
      : t("terminalUi.noMatches");
  return (
    <div className="terminal-find">
      <Input
        type="search"
        autoFocus
        aria-label={t("terminalUi.searchLabel")}
        title={t("terminalUi.searchHint")}
        value={needle}
        onChange={(e) => props.onChange(e.target.value)}
        onKeyDown={(e) => {
          const flag = e.altKey && !e.ctrlKey ? FIND_KEYS[e.key.toLowerCase()] : undefined;
          if (flag) {
            e.preventDefault();
            props.onFlip(flag);
          } else if (e.key === "Escape") {
            // Handled here: left unmarked, the key closes the detail too (#2591).
            e.preventDefault();
            props.onClose();
          } else if (e.key === "Enter") props.onFind(e.shiftKey ? "previous" : "next");
        }}
      />
      {FIND_TOGGLES.map(([flag, label, glyph, keys]) => (
        <IconTip key={flag} label={`${t(label)} (${keys})`}>
          <Button
            size="sm"
            variant="ghost"
            className="terminal-find-toggle"
            aria-label={t(label)}
            aria-keyshortcuts={keys}
            aria-pressed={flags[flag] === true}
            onClick={() => props.onFlip(flag)}
          >
            <span aria-hidden="true">{glyph}</span>
          </Button>
        </IconTip>
      ))}
      <output className="text-xs text-muted-foreground">
        {problem ? t(PATTERN_PROBLEM[problem]) : needle !== "" && results && status(results)}
      </output>
      <Button size="sm" variant="ghost" onClick={() => props.onFind("previous")}>
        {t("terminalUi.findPrevious")}
      </Button>
      <Button size="sm" variant="ghost" onClick={() => props.onFind("next")}>
        {t("terminalUi.findNext")}
      </Button>
      <Button size="sm" variant="ghost" onClick={props.onClose}>
        {t("terminalUi.findClose")}
      </Button>
    </div>
  );
}
