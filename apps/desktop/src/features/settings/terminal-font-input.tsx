import { useState } from "react";
import { Input } from "@/components/ui/input";
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN } from "../terminal/index.ts";

/**
 * The terminal font size box. What is typed stays as typed until the person leaves the box or
 * presses Enter; only then is it clamped and stored (a clamp on every keystroke made "14" read 104).
 * An empty or unreadable box goes back to the stored size.
 */
export function TerminalFontInput(
  props: Readonly<{
    id: string;
    describedBy: string;
    size: number;
    onCommit: (size: number) => void;
  }>,
) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = () => {
    const typed = Number(draft);
    if (draft !== null && draft.trim() !== "" && Number.isFinite(typed)) props.onCommit(typed);
    setDraft(null);
  };
  return (
    <Input
      id={props.id}
      type="number"
      className="setting-select"
      min={TERMINAL_FONT_MIN}
      max={TERMINAL_FONT_MAX}
      aria-describedby={props.describedBy}
      value={draft ?? String(props.size)}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}
