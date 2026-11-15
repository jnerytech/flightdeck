import type { T } from "../../../i18n/index.ts";
import type { AppState } from "../../../lib/app-store.ts";
import { hasFeature } from "../../../lib/version.ts";
import type { PaletteItem, PaletteScope, PaletteTarget } from "./palette-types.ts";

const GITHUB_ISSUE = /^https?:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/(\d+)(?:[/?#]\S*)?$/;

/** The most of a task a palette row shows; the prompt itself is never cut. */
const SHOWN = 48;
const shortened = (text: string) =>
  text.length > SHOWN ? `${text.slice(0, SHOWN).trimEnd()}…` : text;

/** Where "Create card" puts the card: the scope's project, else the only project there is. */
function createPlace(state: AppState, scope: PaletteScope | undefined) {
  const online = state.hosts.filter((h) => h.status === "online");
  const hosts = scope?.hostId ? online.filter((h) => h.id === scope.hostId) : online;
  const places = hosts.flatMap((host) =>
    (state.projects[host.id] ?? [])
      .filter((project) => !scope?.projectId || project.id === scope.projectId)
      .map((project) => ({ host, project })),
  );
  return places.length === 1 ? (places[0] ?? null) : null;
}

/**
 * The row that starts a session with the typed text as its task (issue #1135). `searching`: some
 * row of the palette already matches the text.
 */
export function startItem(
  state: AppState,
  t: T,
  query: string,
  scope: PaletteScope | undefined,
  searching: boolean,
): PaletteItem[] {
  const text = query.trim();
  const place = createPlace(state, scope);
  if (text === "" || !place) return [];
  // A sentence is a task. One word that finds a row is a search, and a lone issue number or link
  // is for Create card.
  const sentence = /\s/.test(text);
  if (!sentence && (searching || text.startsWith("#") || text.includes("/"))) return [];
  const { host, project } = place;
  return [
    {
      id: "start:session",
      label: t("palette.startIn", { project: project.name, text: shortened(text) }),
      detail: t("palette.startDetail"),
      target: { kind: "start-session", hostId: host.id, cwd: project.path, prompt: text },
      actions: [],
      hostId: host.id,
      projectId: project.id,
    },
  ];
}

/**
 * Text that matches no card can become one (or an issue's card); it is the last thing offered.
 * `hasCards`: the palette already lists a card for the text.
 */
export function createItem(
  state: AppState,
  t: T,
  query: string,
  scope: PaletteScope | undefined,
  hasCards: boolean,
): PaletteItem[] {
  const text = query.trim();
  const place = createPlace(state, scope);
  if (text === "" || !place || hasCards) return [];
  const { host, project } = place;
  const where = { hostId: host.id, projectId: project.id };
  const issues =
    project.issues !== null &&
    project.issues !== undefined &&
    hasFeature(host.hostInfo?.features, "issues", false);
  const url = GITHUB_ISSUE.exec(text);
  const number = /^#(\d+)$/.exec(text);
  const fromIssue = (issue: string, target: Partial<PaletteTarget>): PaletteItem => ({
    id: "create:issue",
    label: t("palette.createCardIssue", { issue, project: project.name }),
    detail: t("palette.createDetail"),
    target: { kind: "create-card-issue", ...where, ...target } as PaletteTarget,
    actions: [],
    ...where,
  });
  if (issues && url) {
    return [
      fromIssue(`${url[1]}/${url[2]}#${url[3]}`, { ref: `github:${url[1]}/${url[2]}#${url[3]}` }),
    ];
  }
  if (issues && number) return [fromIssue(text, { id: number[1] as string })];
  return [
    {
      id: "create:card",
      label: t("palette.createCard", { title: text, project: project.name }),
      detail: t("palette.createDetail"),
      target: { kind: "create-card", ...where, title: text },
      actions: [],
      ...where,
    },
  ];
}
