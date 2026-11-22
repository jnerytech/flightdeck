import { X } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import type { AppStore } from "../../lib/app-store.ts";
import { SHORTCUTS, type ShortcutGroup } from "./domain/shortcuts.ts";
import { ShortcutKeys } from "./keycap.tsx";

const GROUPS: ShortcutGroup[] = [
  "general",
  "navigation",
  "tabs",
  "views",
  "lists",
  "approvals",
  "board",
  "palette",
];

/**
 * The `?` sheet: every shortcut of the registry, by group. It takes the focus when it opens, closes
 * on Escape from wherever the focus is, and gives the focus back to what had it, however it closes.
 */
export function ShortcutsSheet(
  props: Readonly<{ store: AppStore; mac: boolean; onClose(): void }>,
) {
  const { t } = props.store.i18n;
  const ref = useRef<HTMLDialogElement>(null);
  const close = useRef(props.onClose);
  close.current = props.onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    const onEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") close.current();
    };
    document.addEventListener("keydown", onEscape);
    return () => {
      document.removeEventListener("keydown", onEscape);
      opener?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      tabIndex={-1}
      open
      className="fixed top-16 left-1/2 z-50 sheet-box -translate-x-1/2 overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-lg"
      aria-label={t("shortcuts.title")}
    >
      <div className="row-spread">
        <h2 className="font-semibold text-lg">{t("shortcuts.title")}</h2>
        <Button
          variant="ghost"
          size="icon"
          aria-label={t("shortcuts.close")}
          onClick={props.onClose}
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <div className="shortcut-grid">
        {GROUPS.map((group) => (
          <section key={group} className="stack-tight">
            <h3 className="font-medium text-muted-foreground text-xs uppercase">
              {t(`shortcuts.groups.${group}`)}
            </h3>
            <dl className="stack-tight text-sm">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="shortcut-row">
                  <dt>{t(s.label)}</dt>
                  <dd>
                    <ShortcutKeys keys={s.keys} chord={s.chord === true} mac={props.mac} />
                  </dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
    </dialog>
  );
}
