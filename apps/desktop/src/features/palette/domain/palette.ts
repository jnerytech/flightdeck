import type { T } from "../../../i18n/index.ts";
import type { AppState } from "../../../lib/app-store.ts";
import { anyHostHas } from "../../../lib/version.ts";
import type { SessionViewName as SessionView } from "../../sessions/index.ts";
import type { AppSnippet } from "../../snippets/index.ts";
import { actionBuilder, commandItems } from "./palette-commands.ts";
import { createItem, startItem } from "./palette-create.ts";
import { entityItems } from "./palette-entities.ts";
import type { PaletteItem, PaletteScope, PaletteSection } from "./palette-types.ts";

export type {
  PaletteAction,
  PaletteItem,
  PaletteScope,
  PaletteSection,
  PaletteTarget,
} from "./palette-types.ts";
export { paletteScope } from "./palette-types.ts";

/** A PR link of Azure DevOps (`/pullrequest/<n>`) or GitHub (`/pull/<n>`). */
const PR_LINK = /^https?:\/\/\S+\/(?:pullrequest|pull)\/\d+(?:[/?#]\S*)?$/;

/** How many recent entries the palette shows. */
const RECENTS_SHOWN = 6;

/** How soon a recent entry is wanted: what waits for you, then what runs, then the rest. */
const RANK = { needs_you: 0, running: 1, idle: 2 } as const;

/**
 * The palette's local sections, in order, filtered by `query` (on the label): live sessions,
 * cards, projects, hosts and actions. Empty sections are left out; the history comes from the
 * global search. `costs`: the app has a Custos screen and some host announces it.
 */
export function paletteSections(
  state: AppState,
  query: string,
  options: {
    costs: boolean;
    t: T;
    globalSnippets?: AppSnippet[];
    recents?: string[];
    /**
     * The oldest request waiting for the person, as one line, and whether it must be opened to be
     * answered: the approve and deny commands (or Open) show and name it.
     */
    oldest?: { text: string; opens: boolean; key: string };
    /** The mode the window could switch to (none when the host is locked). */
    modeSwitch?: "simple" | "full" | null;
    /** Issue #107: the views of the session page on screen; none off such a page. */
    views?: readonly SessionView[];
    /** Only what belongs to this host and project (actions, which belong to none, stay). */
    scope?: PaletteScope;
    /** The recents are already in the order to show (the palette froze it when it opened). */
    keepRecentOrder?: boolean;
  },
): PaletteSection[] {
  const { t } = options;
  const online = state.hosts.filter((h) => h.status === "online");
  const { sessions, cards, projects, hosts, connections, snippets } = entityItems(
    state,
    t,
    options.globalSnippets,
  );

  const action = actionBuilder(t);
  const { actions, clients } = commandItems(state, t, options);

  const needle = query.trim().toLowerCase();
  const matches = (item: PaletteItem) =>
    item.label.toLowerCase().includes(needle) ||
    (item.keywords?.toLowerCase().includes(needle) ?? false);
  const link = query.trim();
  const prLink: PaletteItem[] =
    PR_LINK.test(link) && anyHostHas(online, "watch")
      ? [action(`pr-link:${link}`, t("palette.openPrLink"), { kind: "pull-link", url: link }, link)]
      : [];
  const scope = options.scope;
  /** What is not tied to a host or a project (the actions) stays whatever the scope. */
  const inScope = (item: PaletteItem) =>
    (!scope?.hostId || item.hostId === undefined || item.hostId === scope.hostId) &&
    (!scope?.projectId || !("projectId" in item) || item.projectId === scope.projectId);
  const filtered = [
    { title: t("palette.sectionSessions"), items: sessions },
    { title: t("palette.sectionCards"), items: cards },
    { title: t("palette.sectionProjects"), items: projects },
    { title: t("palette.sectionHosts"), items: hosts },
    { title: t("palette.sectionConnections"), items: connections },
    { title: t("palette.sectionSnippets"), items: snippets },
    { title: t("palette.sectionActions"), items: actions },
    { title: t("palette.sectionClients"), items: clients, uncapped: true as const },
  ].map((section) => ({ ...section, items: section.items.filter(inScope).filter(matches) }));
  // With nothing typed, what was used lately comes first (an entry that is gone is dropped).
  const everything = filtered.flatMap((section) => section.items);
  const used =
    needle === ""
      ? (options.recents ?? []).flatMap((id) => everything.find((item) => item.id === id) ?? [])
      : [];
  // What waits for you comes first, then what runs; the palette freezes the order once it is open.
  const ranked = options.keepRecentOrder
    ? used
    : used
        .map((item, i) => ({ item, i }))
        .sort(
          (a, b) => RANK[a.item.stateKey ?? "idle"] - RANK[b.item.stateKey ?? "idle"] || a.i - b.i,
        )
        .map(({ item }) => item);
  const recent = ranked.slice(0, RECENTS_SHOWN);
  // Issue #1135: any text can also be the task of a session started in the project's folder.
  const start = startItem(
    state,
    t,
    query,
    scope,
    filtered.some((section) => section.items.length > 0),
  );
  // Text that matches no card can become one (or an issue's card); it is the last thing offered.
  const create = createItem(state, t, query, scope, (filtered[1]?.items.length ?? 0) > 0);
  // The link is the query itself, so it is not filtered by it.
  return [
    { title: t("palette.sectionLink"), items: prLink },
    { title: t("palette.sectionRecent"), items: recent, recent: true as const },
    ...filtered,
    { title: t("palette.sectionStart"), items: start },
    { title: t("palette.sectionCreate"), items: create },
  ].filter((section) => section.items.length > 0);
}
