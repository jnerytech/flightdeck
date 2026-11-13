import { useState } from "react";
import { Input } from "@/components/ui/input";
import { TERMINAL_FONT_MAX, TERMINAL_FONT_MIN } from "../terminal/index.ts";

/**
 * The terminal font size box. What is typed stays as typed; a whole size inside the range is stored
 * at once (the spinner and the arrow keys step this way), anything else waits until the person leaves
 * the box or presses Enter and is then clamped (a clamp on every keystroke made "14" read 104).
 * An empty or unreadable box goes back to the stored size, and so does a draft the size outgrows
 * when it changes elsewhere (the terminal zoom).
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
  const [seen, setSeen] = useState(props.size);
  if (seen !== props.size) {
    setSeen(props.size);
    if (draft !== null && Number(draft) !== props.size) setDraft(null);
  }
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
      onChange={(e) => {
        setDraft(e.target.value);
        const typed = Number(e.target.value);
        const whole = e.target.value.trim() !== "" && Number.isInteger(typed);
        if (whole && typed >= TERMINAL_FONT_MIN && typed <= TERMINAL_FONT_MAX)
          props.onCommit(typed);
      }}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") commit();
      }}
    />
  );
}
