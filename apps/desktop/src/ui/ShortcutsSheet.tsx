import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { AppStore } from "../lib/app-store.ts";
import { keysLabel, SHORTCUTS, type ShortcutGroup } from "../lib/shortcuts.ts";

const GROUPS: ShortcutGroup[] = ["general", "navigation", "tabs", "lists", "approvals"];

/** The `?` sheet: every shortcut of the registry, by group. */
export function ShortcutsSheet(props: { store: AppStore; mac: boolean; onClose(): void }) {
  const { t } = props.store.i18n;
  return (
    <dialog
      open
      className="fixed top-16 left-1/2 z-50 sheet-box -translate-x-1/2 overflow-y-auto rounded-xl border bg-popover text-popover-foreground shadow-lg"
      aria-label={t("shortcuts.title")}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
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
                    <kbd className="keycap bg-muted font-mono">{keysLabel(s, props.mac)}</kbd>
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
