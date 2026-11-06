import type { SessionNameInfo } from "@flightdeck/protocol";
import type { T } from "../i18n/index.ts";

/** What a session may be called, from every place a name comes from. */
export interface LabelInput {
  /** The name the person gave it in Flightdeck (the session's meta). */
  metaName?: string | null | undefined;
  /** The name it was created with (`SessionSummary.name`). */
  createdName?: string | null | undefined;
  /** Its name record on the host (`names.list`). */
  names?: SessionNameInfo | null | undefined;
  /** The host's personas, in the app's language (`personas.list`). */
  personas?: ReadonlyArray<{ id: string; name: string }> | undefined;
}

/**
 * The label of a session (issue #101), the same everywhere:
 * 1. the name the person gave it in Flightdeck, then a name that is no longer the standard one
 *    (a rename, or the title Claude Code gave it: #605);
 * 2. for a session of a team, the team and the member's persona in the app's language and its
 *    number, or its role when it has no persona the host lists ("md-server · Arquiteto 2");
 * 3. the name it was created with;
 * 4. the standard name (`project · persona · number`).
 * Null when none is known; the caller falls back to the folder.
 */
export function sessionLabel(input: LabelInput, t?: T): string | null {
  const { names } = input;
  if (input.metaName) return input.metaName;
  if (names && names.standard === false) return names.display;
  // Without the dictionaries (a caller with no language), a team session keeps its plain name.
  if (names?.team && t) {
    const { team } = names;
    const persona = input.personas?.find((p) => p.id === names.persona)?.name;
    const member = persona
      ? team.role === "worker" && team.number !== null
        ? t("sessionLabel.persona", { persona, n: team.number })
        : persona
      : team.role === "worker"
        ? t("sessionLabel.worker", { n: team.number ?? "" }).trim()
        : t("sessionLabel.coordinator");
    return t("sessionLabel.team", { team: team.name, member });
  }
  return input.createdName ?? names?.display ?? null;
}
