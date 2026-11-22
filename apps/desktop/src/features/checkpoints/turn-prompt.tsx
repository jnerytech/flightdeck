import { useId, useState } from "react";
import { Button } from "@/components/ui/button";
import type { Turn } from "@/features/sessions/index.ts";
import { Panel, Stack } from "@/shared/layout/index.ts";
import { formatDateTime } from "../../i18n/format.ts";
import type { AppStore } from "../../lib/app-store.ts";

/** More than this many lines or characters and the prompt is clamped, with a button to read it whole (#4038). */
// Keep PROMPT_LINES equal to the `line-clamp-3` class below: a Tailwind class cannot be built from it.
const PROMPT_LINES = 3;
const PROMPT_CHARS = 240;

/** The turn's prompt: clamped when long, with Show more and Show less; a turn without one says so. */
export function TurnPrompt(props: Readonly<{ store: AppStore; prompt: string | null }>) {
  const { t } = props.store.i18n;
  const id = useId();
  const [open, setOpen] = useState(false);
  const text = props.prompt?.trim() ?? "";
  if (text === "") return <p className="text-muted-foreground">{t("timeline.noPrompt")}</p>;
  // Decided by the text, not by the layout: the same on every screen width.
  const long = text.split("\n").length > PROMPT_LINES || text.length > PROMPT_CHARS;
  return (
    <Stack gap={1} className="items-start">
      <p
        id={id}
        className={`whitespace-pre-wrap break-words ${long && !open ? "line-clamp-3" : ""}`.trim()}
      >
        {text}
      </p>
      {long && (
        <Button
          variant="link"
          size="sm"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen(!open)}
        >
          {open ? t("timeline.showLess") : t("timeline.showMore")}
        </Button>
      )}
    </Stack>
  );
}

/** What a dialog says about the turn it acts on: when it ran and what was asked (#4250). */
export function TurnContext(props: Readonly<{ store: AppStore; turn: Turn }>) {
  const { store, turn } = props;
  return (
    <Panel size="sm" className="text-sm">
      <time className="text-muted-foreground text-xs" dateTime={turn.createdAt}>
        {formatDateTime(turn.createdAt, store.i18n.lang)}
      </time>
      <TurnPrompt store={store} prompt={turn.prompt} />
    </Panel>
  );
}
