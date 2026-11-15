import { Input } from "@/components/ui/input";
import { ScopeMenu } from "@/features/shell/ui.ts";
import { Toolbar } from "@/shared/layout/index.ts";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import type { DataScope } from "../costs/index.ts";
import type { HubFilter, HubRow, HubView } from "./domain/hub.ts";
import { HubFilterMenu } from "./hub-filter-menu.tsx";
import { ViewToggle } from "./view-toggle.tsx";

/** The hub's toolbar: the scope menu, the list or cards toggle, the text filter and the filter menu. */
export function HubToolbar(
  props: Readonly<{
    store: AppStore;
    hosts: AppState["hosts"];
    hostsLoaded: boolean;
    /** The projects the scope menu offers. */
    projects: readonly { key: string; label: string }[];
    scope: DataScope;
    /** The project the scope names, or "" when it names none. */
    scopedProject: string;
    view: HubView;
    onView(view: HubView): void;
    filter: HubFilter;
    /** How many filters are on. */
    active: number;
    personas: readonly NonNullable<HubRow["persona"]>[];
    set(patch: Partial<HubFilter>): void;
  }>,
) {
  const { store, hosts, filter, set } = props;
  const { t } = store.i18n;
  return (
    <Toolbar label={t("hub.filters")}>
      {props.hostsLoaded && (hosts.length > 1 || props.scopedProject !== "") && (
        <ScopeMenu store={store} hosts={hosts} projects={props.projects} scope={props.scope} />
      )}
      <ViewToggle
        view={props.view}
        label={t("hub.view")}
        listLabel={t("hub.viewList")}
        cardsLabel={t("hub.viewCards")}
        onChange={props.onView}
      />
      <Input
        aria-label={t("hub.filterLabel")}
        placeholder={t("hub.filterPlaceholder")}
        value={filter.text}
        onChange={(e) => set({ text: e.target.value })}
        className="toolbar-field h-8 min-w-32 text-xs"
      />
      <HubFilterMenu
        t={t}
        filter={filter}
        active={props.active}
        personas={props.personas}
        set={set}
      />
    </Toolbar>
  );
}
