import type { AppKernel } from "../../lib/kernel.ts";

/** What is waiting for each session's message box, by session key. */
type ComposerFillState = { composerFill: Record<string, string> };

/** Hands `text` to the message box of the session `key`; it waits there until the box takes it. */
export function fillComposer(
  kernel: Pick<AppKernel<ComposerFillState>, "state" | "update">,
  key: string,
  text: string,
): void {
  const { composerFill } = kernel.state();
  const waiting = composerFill[key];
  kernel.update({
    composerFill: { ...composerFill, [key]: waiting ? `${waiting}\n\n${text}` : text },
  });
}

/** The text waiting for the session's box, which is now taken; `null` when there is none. */
export function takeComposerFill(
  kernel: Pick<AppKernel<ComposerFillState>, "state" | "update">,
  key: string,
): string | null {
  const { [key]: text, ...rest } = kernel.state().composerFill;
  if (text === undefined) return null;
  kernel.update({ composerFill: rest });
  return text;
}
