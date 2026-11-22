import {
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
} from "react";
import type { T } from "@/i18n/index";
import { Stack } from "@/shared/layout/index.ts";
import { useWand, type WandBinding } from "./use-wand.ts";
import { WandButton, WandPanel } from "./wand-controls.tsx";

/** What a field takes from its wand: the keys it must hand over. */
export interface AssistControl {
  onKeyDown(event: ReactKeyboardEvent): void;
}

/**
 * A free-text field with the wand beside it and its progress, failure and preview under it
 * (issue #160). The field is rendered by the caller: `{(control) => <Input {...control} />}`.
 */
export function AssistField(
  props: Readonly<{
    binding: WandBinding;
    value: string;
    onChange(value: string): void;
    t: T;
    /** For the caller's own layout: how the field and its panel sit among their neighbours. */
    className?: string;
    children(control: AssistControl): ReactNode;
  }>,
) {
  const { binding, value, onChange, t } = props;
  const wand = useWand(binding, value, onChange);
  const fieldBox = useRef<HTMLDivElement>(null);
  /** Where the focus goes when the wand's panel goes away with it. */
  const focusField = useCallback(
    () => fieldBox.current?.querySelector<HTMLElement>("textarea, input")?.focus(),
    [],
  );
  const open = wand !== null && wand.state.kind !== "idle" && wand.state.kind !== "undo";
  // Esc closes the wand's preview first. A dialog around the field listens for it before the field
  // does, so the key is claimed here, ahead of the dialog, while the wand has something to close.
  useEffect(() => {
    if (!open) return;
    const claim = (event: KeyboardEvent) => {
      if (event.key === "Escape") event.preventDefault();
    };
    window.addEventListener("keydown", claim, true);
    return () => window.removeEventListener("keydown", claim, true);
  }, [open]);
  return (
    <Stack gap={1} {...(props.className ? { className: props.className } : {})}>
      <div className="assist-field">
        <div ref={fieldBox}>
          {props.children({
            onKeyDown: (event) => {
              wand?.onKeyDown(event);
            },
          })}
        </div>
        {wand && <WandButton wand={wand} t={t} />}
      </div>
      {wand && <WandPanel wand={wand} t={t} focusField={focusField} />}
    </Stack>
  );
}
