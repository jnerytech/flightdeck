import type * as React from "react";
import { type ReactNode, useEffect } from "react";
import { Stack } from "@/components/layout/stack";
import type { T } from "@/i18n/index";
import { useWand, type WandBinding } from "./use-wand.ts";
import { WandButton, WandPanel } from "./wand-controls.tsx";

/** What a field takes from its wand: the keys it must hand over. */
export interface AssistControl {
  onKeyDown(event: React.KeyboardEvent): void;
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
        <div>
          {props.children({
            onKeyDown: (event) => {
              wand?.onKeyDown(event);
            },
          })}
        </div>
        {wand && <WandButton wand={wand} t={t} />}
      </div>
      {wand && <WandPanel wand={wand} t={t} />}
    </Stack>
  );
}
