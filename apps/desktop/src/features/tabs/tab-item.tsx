import { X } from "lucide-react";
import type { CSSProperties } from "react";
import { CacheTimer } from "@/features/sessions/cache-timer";
import { cn } from "@/lib/utils";
import { IconTip } from "@/shared/feedback/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { TabBadgeGlyph } from "./tab-badge-glyph.tsx";
import type { tabFacts } from "./tab-facts.ts";
import type { Tab, Tabs } from "./tabs.ts";
import type { useTabDrag } from "./use-tab-drag.ts";

/** How a tab is moved from the keyboard. */
const MOVE_KEYS = "Control+Shift+ArrowLeft Control+Shift+ArrowRight";

/** The marks on a tab's wrapper: production, pinned, its host's color, the side a drag would drop on, and the classes. */
function tabItemMarks(
  tab: Tab,
  marks: {
    prod: boolean | undefined;
    hostColor: string | undefined;
    drop: "before" | "after" | null;
  },
) {
  const { prod, hostColor, drop } = marks;
  return {
    ...(prod === undefined ? {} : { "data-prod": String(prod) }),
    ...(tab.pinned ? { "data-pinned": "true" } : {}),
    ...(hostColor
      ? { "data-host": "true", style: { "--host-color": hostColor } as CSSProperties }
      : {}),
    ...(drop ? { "data-drop": drop } : {}),
    className: cn(
      "tab-item group relative text-sm has-[[role=tab]:focus-visible]:ring-2 has-[[role=tab]:focus-visible]:ring-ring",
      prod && "border-2 border-destructive",
      drop === "before" && "border-l-2 border-l-primary",
      drop === "after" && "border-r-2 border-r-primary",
    ),
  };
}

/** One tab of the strip: its button, the cache timer and the close ×, with its marks. */
export function TabItem(
  props: Readonly<{
    store: AppStore;
    tab: Tab;
    /** The set the tab belongs to, for what acts on the tab itself (close, commit, move). */
    own: Tabs;
    selected: boolean;
    facts: ReturnType<typeof tabFacts>;
    /** The drag handlers of the tab's button, and the side a drag over it would drop on. */
    drag: ReturnType<ReturnType<typeof useTabDrag>["dragProps"]>;
    drop: "before" | "after" | null;
    onMoveByKey(delta: -1 | 1): void;
  }>,
) {
  const { store, tab, own, selected, facts, drag, drop, onMoveByKey } = props;
  const { t } = store.i18n;
  const { label, kind, Icon, badge, cacheSince, ssh, prod, hostColor, ariaLabel } = facts;
  return (
    // The wrapper is invisible to the tablist: the tab and its × are siblings inside it.
    <div // NOSONAR: the wrapper is invisible to the tablist: the tab and its × are siblings inside it
      role="presentation"
      {...tabItemMarks(tab, { prod, hostColor, drop })}
    >
      <IconTip label={label}>
        <button
          type="button"
          role="tab"
          aria-selected={selected}
          data-preview={tab.preview}
          {...(tab.preview ? { "aria-description": t("tabs.preview") } : {})}
          data-tab-id={tab.id}
          aria-keyshortcuts={`${tab.pinned ? "" : "Delete "}${MOVE_KEYS}`}
          // A pinned tab shows no title, and a host's tab no longer carries its host's name
          // in it: the name is set here, with the badge's words.
          {...(ariaLabel ? { "aria-label": ariaLabel } : {})}
          className="tab-button"
          onClick={() => store.hostTabs.activate(tab.id)}
          onDoubleClick={() => own.commit(tab.id)}
          onKeyDown={(e) => {
            if (e.key === "Delete") store.closeTab(own, tab.id);
            else if (e.ctrlKey && e.shiftKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
              e.preventDefault();
              e.stopPropagation();
              onMoveByKey(e.key === "ArrowLeft" ? -1 : 1);
            }
          }}
          onAuxClick={(e) => {
            // The middle button closes a tab (App opens items in a new tab with it).
            if (e.button !== 1) return;
            e.stopPropagation();
            store.closeTab(own, tab.id);
          }}
          {...drag}
        >
          <Icon data-icon={kind} className="size-3.5 shrink-0" aria-hidden />
          {!tab.pinned && <span className={cn("truncate", tab.preview && "italic")}>{label}</span>}
          {!tab.pinned &&
            ssh?.tags.map((tag) => (
              <span key={tag} className="shrink-0 rounded bg-muted px-1 text-xs">
                {tag}
              </span>
            ))}
          {badge && <TabBadgeGlyph badge={badge} label={t(`tabs.badge.${badge}`)} />}
        </button>
      </IconTip>
      {cacheSince && (
        <span className="absolute top-0.5 left-0.5">
          <CacheTimer store={store} since={cacheSince} compact />
        </span>
      )}
      {!tab.pinned && (
        <button
          type="button"
          aria-hidden="true"
          tabIndex={-1}
          aria-label={t("tabs.close", { title: label })}
          className={cn(
            "mr-1 flex size-6 shrink-0 items-center justify-center rounded-md hover:bg-accent focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring",
            !selected && "opacity-0 group-focus-within:opacity-100 group-hover:opacity-100",
          )}
          onClick={() => store.closeTab(own, tab.id)}
        >
          <X className="size-3.5" aria-hidden />
        </button>
      )}
    </div>
  );
}
