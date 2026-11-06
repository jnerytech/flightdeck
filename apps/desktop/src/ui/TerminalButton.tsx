import { Copy, ExternalLink, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { IconActionButton } from "@/components/feedback/icon-action-button";
import { PersonaPicker } from "@/components/personas/persona-picker";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { useT } from "@/i18n/context";
import type { AppStore } from "../lib/app-store.ts";
import { liveElsewhere } from "../lib/live-elsewhere.ts";
import type { TerminalTarget } from "../lib/terminal.ts";
import { hasFeature } from "../lib/version.ts";
import { LiveElsewhereDialog } from "./LiveElsewhereDialog.tsx";

/**
 * "Abrir no terminal" for a session, card or project: opens one on this machine, or copies the
 * command when the host is elsewhere; with the host's own terminals on (phase 14), "Claude aqui"
 * opens it in a tab of the app too. `name` tells several buttons apart in a list.
 */
export function TerminalButton(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    target: TerminalTarget;
    name?: string;
  }>,
) {
  const t = useT();
  const { store, hostId, target, name } = props;
  const launch = store.terminalLaunch(hostId, target);
  const embedded = store.embeddedTerminal(hostId);
  // The persona chosen, else the default of the client the folder belongs to (phase 29).
  const [picked, setPicked] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // What waits while the person decides about a session live in another terminal (#502).
  const [pending, setPending] = useState<(() => unknown) | null>(null);
  const persona = picked ?? store.clientScope().defaultPersona(hostId, target.cwd, true);
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
  /** A second `claude` on a session live elsewhere only after asking (issue #502). */
  const guarded = (go: () => unknown) => {
    const id = target.claudeSessionId;
    if (id !== null && liveElsewhere(store.getState().externals, hostId, id)) setPending(() => go);
    else return go();
  };
  const open = () => guarded(() => store.openClaudeHere(hostId, target, persona || undefined));
  return (
    <>
      {/* Issue #177 (B10): with personas, the persona is asked for when the terminal is opened;
          the header no longer shows a select that reads like an action. */}
      {embedded && personas && (
        <Popover open={asking} onOpenChange={setAsking}>
          <PopoverAnchor asChild>
            <span className="hit-inline">
              <IconActionButton label={here} aria-haspopup="dialog" onClick={() => setAsking(true)}>
                <SquareTerminal aria-hidden="true" />
              </IconActionButton>
            </span>
          </PopoverAnchor>
          <PopoverContent aria-label={here} className="terminal-ask">
            <PersonaPicker
              store={store}
              hostId={hostId}
              label={name ? t("personas.picker.hereNamed", { name }) : t("personas.picker.here")}
              value={persona}
              onChange={setPicked}
              idsOnly
            />
            <ActionButton
              onClick={async () => {
                setAsking(false);
                await open();
              }}
            >
              {t("claudeHere.start")}
            </ActionButton>
          </PopoverContent>
        </Popover>
      )}
      {embedded && !personas && (
        <IconActionButton label={here} onClick={() => open()}>
          <SquareTerminal aria-hidden="true" />
        </IconActionButton>
      )}
      {launch && (
        <IconActionButton
          label={label}
          onClick={() => guarded(() => store.openInTerminal(hostId, target))}
        >
          {launch.kind === "spawn" ? (
            <ExternalLink aria-hidden="true" />
          ) : (
            <Copy aria-hidden="true" />
          )}
        </IconActionButton>
      )}
      {pending && target.claudeSessionId !== null && (
        <LiveElsewhereDialog
          onView={() => {
            setPending(null);
            store.router.push({
              name: "external",
              host: hostId,
              claudeSessionId: target.claudeSessionId as string,
            });
          }}
          onAnyway={() => {
            setPending(null);
            void pending();
          }}
          onCancel={() => setPending(null)}
        />
      )}
    </>
  );
}
