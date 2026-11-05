import { type KeyboardEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/**
 * A button that acts only after being held for `holdMs`: the pointer pressed on it, or Space or
 * Enter kept down. Letting go, leaving the button or losing focus cancels. A bar fills while it is
 * held. A plain click does nothing.
 */
export function HoldButton(props: {
  label: string;
  holdMs: number;
  onHeld(): void;
  /** Off while the last hold is being answered. */
  disabled?: boolean;
  /** Why the button has to be held: shown as text under the button, never only as a tooltip. */
  hint?: string;
}) {
  const [holding, setHolding] = useState(false);
  const hintId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const start = () => {
    if (timer.current || props.disabled) return;
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      setHolding(false);
      props.onHeld();
    }, props.holdMs);
  };
  // Biome wants the dependency list; the cleanup only touches refs and a setState.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel is stable in effect
  useEffect(() => cancel, []);

  const isHoldKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";
  const button = (
    <Button
      type="button"
      aria-describedby={props.hint ? hintId : undefined}
      disabled={props.disabled}
      data-holding={holding ? "true" : "false"}
      className="relative overflow-hidden"
      onClick={(e) => e.preventDefault()}
      onPointerDown={start}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      onBlur={cancel}
      onKeyDown={(e) => {
        if (!isHoldKey(e)) return;
        e.preventDefault();
        if (!e.repeat) start();
      }}
      onKeyUp={(e) => {
        if (isHoldKey(e)) cancel();
      }}
    >
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 bg-white/30"
        style={{
          width: holding ? "100%" : "0%",
          transition: `width ${holding ? props.holdMs : 0}ms linear`,
        }}
      />
      <span className="relative">{props.label}</span>
    </Button>
  );
  if (!props.hint) return button;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {button}
      <span id={hintId} className="text-xs text-muted-foreground">
        {props.hint}
      </span>
    </span>
  );
}
