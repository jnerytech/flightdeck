import { useMemo, useState } from "react";
import { activeWorktreeFilter } from "@/features/projects/index.ts";
import { useProjectLabels } from "@/hooks/use-project-labels";
import type { AppState, AppStore } from "../../lib/app-store.ts";
import { type HubFilter, hubRows } from "./domain/hub.ts";
import { worktreesOf } from "./domain/hub-derive.ts";
import { hubGroups } from "./domain/hub-groups.ts";
import { hubProjectKeys, projectChoices, rowsInScope } from "./domain/hub-scope.ts";
import {
  capGroups,
  HUB_ROW_CAP,
  type HubGroupView,
  hubView,
  isSearching,
} from "./domain/hub-view.ts";
import type { HubProject } from "./use-hub-scope.ts";

/**
 * The hub's list: the rows of the hosts in scope, grouped by project and folded by what the person
 * opened, cut at the row cap. The filter, the scope and the project chip come from the hub.
 */
export function useHubList(
  store: AppStore,
  state: AppState,
  filter: HubFilter,
  scope: { scoped: string; scopedProject: string; only: HubProject | null },
) {
  const { t } = store.i18n;
  const { scoped, scopedProject, only } = scope;
  // The branch picked in the sidebar tree, when it still points at a checkout that is there.
  const picked = activeWorktreeFilter(state);
  const pickedProject = picked
    ? state.projects[picked.hostId]?.find((p) => p.id === picked.projectId)
    : undefined;
  const worktrees = useMemo(() => worktreesOf(state.cards, picked), [state.cards, picked]);
  // Only what the rows are made of recomputes them (a typing indicator or an error does not).
  // biome-ignore lint/correctness/useExhaustiveDependencies: the rows read these parts of the state, not all of it
  const allRows = useMemo(
    () =>
      store.clientScope.get().filter(hubRows(state, t), state.clientSelection, (r) => r.projectKey),
    [
      store,
      state.hosts,
      state.hub,
      state.meta,
      state.externals,
      state.names,
      state.background,
      state.personas,
      t,
      state.clientList,
      state.clientOverrides,
      state.clientSelection,
    ],
  );
  // The hub's projects, for the Projects group of the scope menu (as Home and Costs offer theirs).
  const projectKeys = useMemo(
    () => hubProjectKeys(allRows, scopedProject),
    [allRows, scopedProject],
  );
  const projectNames = useProjectLabels(store, projectKeys);
  const projects = useMemo(
    () => projectChoices(projectKeys, projectNames),
    [projectKeys, projectNames],
  );
  const rows = useMemo(
    () =>
      rowsInScope(allRows, {
        host: scoped,
        project: scopedProject,
        only,
        picked,
        pickedProject,
        worktrees,
      }),
    [allRows, scoped, scopedProject, only, picked, pickedProject, worktrees],
  );
  const allGroups = useMemo(() => hubGroups(rows, filter), [rows, filter]);
  /** How many rows are drawn: the cap, and one more cap for each "show more". */
  const [limit, setLimit] = useState(HUB_ROW_CAP);
  // Each project: open when it has live sessions (or a search is on), its history behind a count.
  const [openState, setOpenState] = useState<Record<string, boolean | undefined>>(() =>
    store.viewPrefs.hubOpen(),
  );
  /** What the person opened or folded is remembered, per project. */
  const setOpen = (next: Record<string, boolean | undefined>) => {
    setOpenState(next);
    store.viewPrefs.saveHubOpen(next);
  };
  const [earlierOpen, setEarlierOpen] = useState<Record<string, boolean | undefined>>({});
  // Any filter narrows the list on purpose: what it keeps is shown, not folded away.
  const searching = isSearching(filter);
  const views = useMemo(
    () => hubView(allGroups, openState, earlierOpen, searching),
    [allGroups, openState, earlierOpen, searching],
  );
  const { groups, hidden } = useMemo(
    () =>
      capGroups(
        views.map((v) => ({ ...v.group, rows: v.rows })),
        limit,
      ),
    [views, limit],
  );
  const viewOf = (key: string): HubGroupView | undefined => views.find((v) => v.group.key === key);

  return {
    picked,
    projects,
    projectNames,
    rows,
    allGroups,
    groups,
    hidden,
    viewOf,
    searching,
    openState,
    setOpen,
    earlierOpen,
    setEarlierOpen,
    /** One more cap of rows. */
    showMore: () => setLimit(limit + HUB_ROW_CAP),
  };
}
