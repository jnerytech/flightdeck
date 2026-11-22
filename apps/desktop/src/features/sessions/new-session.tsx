import type { CommandPayload } from "@flightdeck/protocol";
import { useId, useState } from "react";
import { PersonaPicker } from "@/features/personas/ui.ts";
import { useT } from "@/i18n/context";
import { CheckField } from "@/shared/layout/index.ts";
import { basename } from "@/shared/lib/index.ts";
import type { T } from "../../i18n/index.ts";
import type { AppState, AppStore, HostView } from "../../lib/app-store.ts";
import { hasFeature } from "../../lib/version.ts";
import { NewSessionForm } from "./new-session-form.tsx";

/**
 * "Iniciar em segundo plano": the session runs under Claude Code's supervisor; the hub shows it, and
 * a notice says it started. False when the host refuses (the form stays and says so).
 */
async function startInBackground(
  store: AppStore,
  t: T,
  hostId: string,
  payload: CommandPayload<"session.create">,
  persona: string,
): Promise<boolean> {
  const id = await store.background.start(hostId, {
    cwd: payload.cwd,
    prompt: payload.prompt,
    ...(payload.name ? { name: payload.name } : {}),
    ...(persona.startsWith("host:") ? { persona: persona.slice(5) } : {}),
  });
  if (!id) return false;
  store.success(t("bg.started", { name: payload.name || basename(payload.cwd) }));
  store.router.push({ name: "hub" });
  return true;
}

/** The new-session form of a host; the created session opens. */
export function NewSession(
  props: Readonly<{
    store: AppStore;
    state: Pick<AppState, "hosts">;
    host: HostView;
    prompt?: string;
    persona?: string;
  }>,
) {
  const { host } = props;
  const t = useT();
  // The persona the route asked for, else the one chosen, else the folder's client's default.
  const [picked, setPicked] = useState<string | null>(props.persona ?? null);
  const [cwd, setCwd] = useState("");
  const persona = picked ?? props.store.clientScope.get().defaultPersona(host.id, cwd);
  const [background, setBackground] = useState(false);
  const [refused, setRefused] = useState(false);
  const hintId = useId();
  const personas = hasFeature(host.hostInfo?.features, "personas", false);
  const withBackground = hasFeature(host.hostInfo?.features, "bg", false);
  return (
    <NewSessionForm
      key={`${host.id}/${props.prompt ?? ""}`}
      store={props.store}
      host={host}
      hosts={props.state.hosts.filter((h) => h.status === "online")}
      onHost={(hostId) => props.store.router.push({ name: "new-session", host: hostId })}
      onAddFolder={() => props.store.router.push({ name: "host", host: host.id })}
      {...(props.prompt ? { prompt: props.prompt } : {})}
      onFolder={setCwd}
      promptRequired={background}
      extraSet={background || persona !== ""}
      extra={
        <>
          {personas && (
            <PersonaPicker
              store={props.store}
              hostId={host.id}
              label={t("personas.picker.label")}
              value={persona}
              onChange={setPicked}
            />
          )}
          {withBackground && (
            <>
              <CheckField
                checked={background}
                describedBy={hintId}
                onChange={(checked) => {
                  setBackground(checked);
                  setRefused(false);
                }}
              >
                {t("bg.start")}
              </CheckField>
              <span id={hintId} className="text-muted-foreground text-xs">
                {t("bg.startHint")}
              </span>
              <output className="text-destructive text-xs empty:sr-only">
                {refused ? t("bg.startFailed") : ""}
              </output>
            </>
          )}
        </>
      }
      // The created session opens by itself (SessionCommandsSlice.create).
      onCreate={(payload) => {
        if (payload.runtime === "opencode") return props.store.commands.create(host.id, payload);
        if (background) {
          setRefused(false);
          return startInBackground(props.store, t, host.id, payload, persona).then((started) =>
            setRefused(!started),
          );
        }
        const ref = props.store.personas.ref(persona);
        return props.store.commands.create(host.id, {
          ...payload,
          ...(ref ? { persona: ref } : {}),
        });
      }}
    />
  );
}
