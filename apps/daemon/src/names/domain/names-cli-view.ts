/**
 * Issue #3735: what `flightdeckd names list` prints, as pure rules over the daemon's answer.
 */
import type { SessionNameInfo } from "@flightdeck/protocol";

/** Every key of a name, listed here so a field added to the daemon's answer is not printed unreviewed; `null` for what a host older than #101 leaves out. */
export const namesJson = (names: SessionNameInfo[]) =>
  names.map((name) => ({
    sessionId: name.sessionId,
    display: name.display,
    alias: name.alias,
    aliases: name.aliases,
    project: name.project,
    persona: name.persona,
    number: name.number,
    cardNumber: name.cardNumber,
    standard: name.standard ?? null,
    team: name.team ?? null,
  }));

/** The alias the person types, the name the app shows, the session it names, and the other aliases that name it. */
export const namesLines = (names: SessionNameInfo[]): string[] =>
  names.length === 0
    ? ["no names"]
    : names.map((name) => {
        const others = name.aliases.filter((alias) => alias !== name.alias);
        const also = others.length === 0 ? "" : `  (also ${others.join(", ")})`;
        return `${name.alias}  ${name.display}  ${name.sessionId}${also}`;
      });
