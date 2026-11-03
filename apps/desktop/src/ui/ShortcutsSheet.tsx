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
      className="fixed top-16 left-1/2 z-50 m-0 flex max-h-[80vh] w-[min(42rem,92vw)] -translate-x-1/2 flex-col gap-4 overflow-y-auto rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg"
      aria-label={t("shortcuts.title")}
      onKeyDown={(e) => {
        if (e.key === "Escape") props.onClose();
      }}
    >
      <div className="flex items-center justify-between gap-2">
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
      <div className="grid grid-cols-[repeat(auto-fit,minmax(16rem,1fr))] gap-6">
        {GROUPS.map((group) => (
          <section key={group} className="flex flex-col gap-1">
            <h3 className="font-medium text-muted-foreground text-xs uppercase">
              {t(`shortcuts.groups.${group}`)}
            </h3>
            <dl className="flex flex-col gap-1 text-sm">
              {SHORTCUTS.filter((s) => s.group === group).map((s) => (
                <div key={s.id} className="flex items-baseline justify-between gap-3">
                  <dt>{t(s.label)}</dt>
                  <dd>
                    <kbd className="rounded border bg-muted px-1.5 py-0.5 font-mono text-xs">
                      {keysLabel(s, props.mac)}
                    </kbd>
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
