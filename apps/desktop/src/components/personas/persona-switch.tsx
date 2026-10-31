import type { SessionPersona } from "@flightdeck/protocol";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { PersonaPicker } from "./persona-picker";

/**
 * Phase 20: "Aplicar persona" and "Voltar ao normal" on a session that is already open. The
 * persona goes as a message of the conversation, not as the system prompt, and the app says so.
 */
export function PersonaSwitch(props: {
  store: AppStore;
  hostId: string;
  target: { sessionId: string } | { claudeSessionId: string };
  /** The persona the session is in, when known. */
  current: SessionPersona | null;
}) {
  const t = useT();
  const { store, hostId, target } = props;
  const [value, setValue] = useState("");
  // What an apply or a clear answered (a terminal session has no events to follow); else the
  // persona the session is known to be in.
  const [answered, setAnswered] = useState<{ persona: SessionPersona | null } | null>(null);
  const current = answered ? answered.persona : props.current;
  const apply = async () => {
    const persona = store.personaRef(value);
    if (!persona) return;
    const done = await store.hostCommand(hostId, "session.applyPersona", { ...target, persona });
    if (done) setAnswered({ persona: done.persona });
  };
  const clear = async () => {
    const done = await store.hostCommand(hostId, "session.clearPersona", {
      ...target,
      language: store.i18n.lang,
    });
    if (done) setAnswered({ persona: null });
  };
  return (
    <div className="flex flex-col gap-1 text-sm">
      {current && (
        <p role="note" aria-label={t("personas.apply.active")} className="font-medium">
          {current.name}
        </p>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <PersonaPicker
          store={store}
          hostId={hostId}
          label={t("personas.apply.label")}
          value={value}
          onChange={setValue}
        />
        <Button size="sm" variant="outline" disabled={!value} onClick={() => void apply()}>
          {t("personas.apply.apply")}
        </Button>
        {current && (
          <Button size="sm" variant="outline" onClick={() => void clear()}>
            {t("personas.apply.clear")}
          </Button>
        )}
      </div>
      <p className="text-muted-foreground text-xs">{t("personas.apply.note")}</p>
    </div>
  );
}
