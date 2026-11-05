import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import type { AppStore } from "../../lib/app-store.ts";
import { tabBadge, tabKind } from "../../lib/tab-badge.ts";
import {
  openSwitcher,
  pickedId,
  type SwitcherState,
  stepSwitcher,
} from "../../lib/tab-switcher.ts";
import { useStoreState } from "../../lib/use-store.ts";
import { TAB_ICONS, tabTitle } from "../../ui/TabBar.tsx";

/**
 * The Ctrl+Tab switcher. Hold Ctrl and press Tab to open it on the previous tab and to go down the
 * recent ones (Shift goes up); releasing Ctrl activates the pick, Esc or leaving the window
 * cancels. The keys are consumed so the page never sees them. With the "Tab order" setting it
 * stays out of the way and the tabs step in strip order.
 */
export function TabSwitcherHost(props: { store: AppStore }) {
  const { store } = props;
  const state = useStoreState(store);
  const [switcher, setSwitcher] = useState<SwitcherState | null>(null);
  // The listeners read the current state through a ref, so they are attached once.
  const open = useRef<SwitcherState | null>(null);

  useEffect(() => {
    const show = (next: SwitcherState | null) => {
      open.current = next;
      setSwitcher(next);
    };
    const consume = (e: Event) => {
      e.preventDefault();
      e.stopImmediatePropagation();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (open.current && e.key === "Escape") {
        consume(e);
        show(null);
      } else if (e.ctrlKey && e.key === "Tab" && store.tabOrder.value === "mru") {
        consume(e);
        const direction = e.shiftKey ? -1 : 1;
        const current = open.current;
        if (current) show(stepSwitcher(current, direction));
        else {
          show(
            openSwitcher(
              store.tabs.recent().map((tab) => tab.id),
              direction,
            ),
          );
        }
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      const current = open.current;
      if (current && e.key === "Control") {
        store.tabs.activate(pickedId(current));
        show(null);
      }
    };
    const cancel = () => show(null);
    window.addEventListener("keydown", onKeyDown, true);
    window.addEventListener("keyup", onKeyUp, true);
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("keydown", onKeyDown, true);
      window.removeEventListener("keyup", onKeyUp, true);
      window.removeEventListener("blur", cancel);
    };
  }, [store]);

  if (!switcher) return null;
  const { t } = store.i18n;
  const rows = switcher.ids.flatMap((id) => {
    const tab = store.tabs.tabs.find((candidate) => candidate.id === id);
    return tab ? [tab] : [];
  });
  const title = t("tabs.switcher.title");
  const picked = rows[switcher.index];
  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center pt-[12vh]">
      <div
        data-slot="switcher-panel"
        className="flex max-h-[min(18rem,60vh)] w-[min(22.5rem,calc(100vw-3rem))] flex-col overflow-hidden rounded-lg border border-border bg-popover text-popover-foreground shadow-lg"
      >
        <p
          data-slot="switcher-title"
          className="px-3 pt-2 pb-1 font-semibold text-[11px] text-muted-foreground"
        >
          {title}
        </p>
        <div role="listbox" tabIndex={-1} aria-label={title} className="overflow-y-auto p-1">
          {rows.map((tab, i) => {
            const route = tab.router.current;
            const Icon = TAB_ICONS[tabKind(route)];
            const badge = tabBadge(route, state);
            return (
              <div
                key={tab.id}
                role="option"
                tabIndex={-1}
                aria-selected={i === switcher.index}
                className={cn(
                  "flex h-6 items-center gap-2 rounded px-2 text-xs",
                  i === switcher.index && "bg-accent text-accent-foreground",
                )}
              >
                <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="min-w-0 flex-1 truncate">{tabTitle(tab, state, store)}</span>
                {badge && (
                  <span
                    role="img"
                    aria-label={t(`tabs.badge.${badge}`)}
                    className={cn(
                      "size-1.5 shrink-0 rounded-full",
                      badge === "needs-you" ? "bg-status-needs-you" : "bg-muted-foreground",
                    )}
                  />
                )}
              </div>
            );
          })}
        </div>
        <p role="status" className="sr-only">
          {picked
            ? t("tabs.switcher.position", {
                title: tabTitle(picked, state, store),
                n: switcher.index + 1,
                total: rows.length,
              })
            : ""}
        </p>
      </div>
    </div>
  );
}
