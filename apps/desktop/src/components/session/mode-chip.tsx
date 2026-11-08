import type { PermissionMode, SettableMode } from "@flightdeck/protocol";
import { ChevronUp } from "lucide-react";
import { useRef, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { T } from "../../i18n/index.ts";
import type { ModeRow } from "../../lib/mode-menu.ts";

/** The chip's words for a mode: its name and what it does, from the dictionaries. */
const nameOf = (t: T, mode: PermissionMode | null) =>
  mode ? t(`modes.${mode}.name`) : t("session.modeUnknown");
const explainOf = (t: T, mode: PermissionMode | null) =>
  mode ? t(`modes.${mode}.explain`) : t("session.modeUnknownExplain");

/**
 * The permission mode under the message box, as a chip that opens the Mode menu: one row per mode
 * with its name, what it does and its number (a number key picks it). A blocked mode (bypass off on
 * this host, or looser than the session started) is listed with the reason. Bypass turns the chip
 * to the warning color.
 */
export function ModeChip(
  props: Readonly<{
    t: T;
    /** Null while the session has not said its mode (#935). */
    mode: PermissionMode | null;
    rows: ModeRow[];
    onPick(mode: SettableMode): void;
    /** Opens the host's page, where the bypass switch is. */
    onOpenHostSettings?: () => void;
  }>,
) {
  const { t, mode, rows } = props;
  const [open, setOpen] = useState(false);
  const chipRef = useRef<HTMLButtonElement>(null);
  const bypass = mode === "bypassPermissions";
  const bypassOff = rows.some((r) => r.blocked === "bypassOff");
  const pick = (next: SettableMode) => {
    setOpen(false);
    props.onPick(next);
  };
  // Not modal (#1004): a modal menu marks the rest of the page aria-hidden while its controls stay
  // focusable (axe's aria-hidden-focus). The menu still takes the focus and Escape closes it; a
  // click on another control closes it and reaches that control in the same click.
  return (
    <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
      <DropdownMenuTrigger asChild>
        <button
          ref={chipRef}
          type="button"
          className={cn("mode-chip", bypass && "text-status-error")}
          data-bypass={bypass}
          aria-label={t("session.modeChip", { mode: nameOf(t, mode) })}
          aria-keyshortcuts="Shift+Tab"
          title={explainOf(t, mode)}
        >
          {nameOf(t, mode)}
          <ChevronUp aria-hidden="true" className="size-3" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side="top"
        align="end"
        className="mode-menu"
        // Radix puts the focus back on the chip a tick after a pick: a menu opened again by then
        // stays open (#1004).
        onFocusOutside={(e) => e.target === chipRef.current && e.preventDefault()}
        onKeyDown={(e) => {
          const row = /^[1-9]$/.test(e.key) ? rows[Number(e.key) - 1] : undefined;
          if (!row) return;
          e.preventDefault();
          if (row.blocked === null) pick(row.mode);
        }}
      >
        <DropdownMenuLabel>{t("session.modeMenuTitle")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode ?? ""}>
          {rows.map((row, index) => (
            <DropdownMenuRadioItem
              key={row.mode}
              value={row.mode}
              disabled={row.blocked !== null}
              onSelect={() => pick(row.mode)}
            >
              <span className="mode-row">
                <span className="mode-row-name">{nameOf(t, row.mode)}</span>
                <span className="mode-row-note">
                  {row.blocked === "bypassOff" && t("session.modeBypassOff")}
                  {row.blocked === "looserThanStart" && t("session.modeLooser")}
                  {row.blocked === null && explainOf(t, row.mode)}
                </span>
              </span>
              <span aria-hidden="true" className="mode-row-key">
                {index + 1}
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {bypassOff && props.onOpenHostSettings && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={props.onOpenHostSettings}>
              {t("session.modeBypassHow")}
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
