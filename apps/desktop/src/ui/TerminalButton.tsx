import { useState } from "react";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import type { TerminalTarget } from "../lib/terminal.ts";
import { hasFeature } from "../lib/version.ts";

/**
 * "Abrir no terminal" for a session, card or project: opens one on this machine, or copies the
 * command when the host is elsewhere; with the host's own terminals on (phase 14), "Claude aqui"
 * opens it in a tab of the app too. `name` tells several buttons apart in a list.
 */
export function TerminalButton(props: {
  store: AppStore;
  hostId: string;
  target: TerminalTarget;
  name?: string;
}) {
  const t = useT();
  const { store, hostId, target, name } = props;
  const launch = store.terminalLaunch(hostId, target);
  const embedded = store.embeddedTerminal(hostId);
  const [persona, setPersona] = useState("");
  const personas =
    embedded &&
    hasFeature(
      store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.features,
      "personas",
      false,
    );
  let label = "";
  if (launch?.kind === "spawn")
    label = name ? t("terminal.openNamed", { name }) : t("terminal.open");
  else if (launch) label = name ? t("terminal.copyNamed", { name }) : t("terminal.copy");
  const resume = target.claudeSessionId !== null;
  let here: string;
  if (resume) here = name ? t("claudeHere.resumeNamed", { name }) : t("claudeHere.resume");
  else here = name ? t("claudeHere.openNamed", { name }) : t("claudeHere.open");
  return (
    <>
      {personas && (
        <PersonaPicker
          store={store}
          hostId={hostId}
          label={name ? t("personas.picker.hereNamed", { name }) : t("personas.picker.here")}
          value={persona}
          onChange={setPersona}
          idsOnly
        />
      )}
      {embedded && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void store.openClaudeHere(hostId, target, persona || undefined)}
        >
          {here}
        </Button>
      )}
      {launch && (
        <Button
          variant="outline"
          size="sm"
          onClick={() => void store.openInTerminal(hostId, target)}
        >
          {label}
        </Button>
      )}
    </>
  );
}
