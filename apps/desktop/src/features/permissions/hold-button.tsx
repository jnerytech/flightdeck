import { type KeyboardEvent, type MouseEvent, useEffect, useId, useRef, useState } from "react";
import { Button } from "@/components/ui/button";

/** A click this soon after a hold ran its time is the end of that press, not a plain click. */
const CLICK_AFTER_HOLD_MS = 500;
/** How long the "a click does not approve" text stays on screen. */
const CLICK_HINT_MS = 6000;

/**
 * A button that acts only after being held for `holdMs`: the pointer pressed on it, or Space or
 * Enter kept down. Letting go, leaving the button or losing focus cancels. A bar fills while it is
 * held. A plain click does not approve; it says so (`clickHint`), for a person whose tool only clicks.
 */
export function HoldButton(
  props: Readonly<{
    label: string;
    /** The accessible name when it must say more than the label (it starts with the label). */
    name?: string;
    holdMs: number;
    onHeld(): void;
    /** Off while the last hold is being answered. */
    disabled?: boolean;
    /** Why the button has to be held: shown as text under the button, never only as a tooltip. */
    hint?: string;
    /** Said, as a polite status, when the button gets a click that is no hold: a click never approves. */
    clickHint?: string;
  }>,
) {
  const [holding, setHolding] = useState(false);
  const hintId = useId();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [clicked, setClicked] = useState(false);
  const clickTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** When the last hold ran its time: the click that ends that press is no plain click. */
  const heldAt = useRef(0);

  const cancel = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setHolding(false);
  };
  const hideClickHint = () => {
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = null;
    setClicked(false);
  };
  const start = () => {
    if (timer.current || props.disabled) return;
    hideClickHint();
    setHolding(true);
    timer.current = setTimeout(() => {
      timer.current = null;
      heldAt.current = Date.now();
      setHolding(false);
      props.onHeld();
    }, props.holdMs);
  };
  const click = (e: MouseEvent) => {
    e.preventDefault();
    if (!props.clickHint || props.disabled || Date.now() - heldAt.current < CLICK_AFTER_HOLD_MS) {
      return;
    }
    setClicked(true);
    if (clickTimer.current) clearTimeout(clickTimer.current);
    clickTimer.current = setTimeout(hideClickHint, CLICK_HINT_MS);
  };
  // Biome wants the dependency list; the cleanup only touches refs and a setState.
  // biome-ignore lint/correctness/useExhaustiveDependencies: cancel and hideClickHint are stable in effect
  useEffect(
    () => () => {
      cancel();
      hideClickHint();
    },
    [],
  );

  const isHoldKey = (e: KeyboardEvent) => e.key === " " || e.key === "Enter";
  const button = (
    <Button
      type="button"
      aria-label={props.name}
      aria-describedby={props.hint ? hintId : undefined}
      disabled={props.disabled}
      data-holding={holding ? "true" : "false"}
      className="relative overflow-hidden"
      onClick={click}
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
  if (!props.hint && !props.clickHint) return button;
  return (
    <span className="inline-flex flex-col items-start gap-1">
      {button}
      {props.hint && (
        <span id={hintId} className="text-xs text-muted-foreground">
          {props.hint}
        </span>
      )}
      {props.clickHint && (
        // Always in the page, empty until a click: a status region must exist before its text does.
        <output className="text-xs text-status-needs-you empty:sr-only">
          {clicked ? props.clickHint : ""}
        </output>
      )}
    </span>
  );
}
