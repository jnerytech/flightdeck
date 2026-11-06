import type { Project } from "@flightdeck/protocol";
import { Volume2 } from "lucide-react";
import { useState, useSyncExternalStore } from "react";
import { NativeSelect } from "@/components/layout/form";
import { Panel } from "@/components/layout/panel";
import { Button } from "@/components/ui/button";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { SWITCHABLE, type SwitchableEvent } from "../../lib/notify-policy.ts";

const AUDIO_NAME = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
const check = "flex items-center gap-2 text-sm";

/**
 * Settings, Notifications (issue #149): what the person is told about and where, who is muted, the
 * sound and a button that proves the system shows them. The rules themselves are in `notify-policy`.
 */
export function NotificationPrefs(props: {
  store: AppStore;
  hosts: HostView[];
  projects: Record<string, Project[]>;
  t: T;
}) {
  const { store, t } = props;
  const prefs = useSyncExternalStore(store.notifyPrefs.subscribe, () => store.notifyPrefs.value);
  const controller = store.notifyPrefs;
  const [problem, setProblem] = useState<string | null>(null);
  const [test, setTest] = useState<"delivered" | "blocked" | null>(null);

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!file.type.startsWith("audio/") && !AUDIO_NAME.test(file.name)) {
      setProblem(t("notifyPrefs.notAudio"));
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      const url = `data:${file.type || "audio/mpeg"};base64,${btoa(binary)}`;
      if (!controller.setSoundFile(file.name, url)) setProblem(t("notifyPrefs.tooLarge"));
    });
  };

  return (
    <Panel title={t("prefs.notifications")}>
      <label className={check}>
        <input
          type="checkbox"
          checked={prefs.enabled}
          onChange={(e) => controller.setEnabled(e.target.checked)}
        />
        {t("notifyPrefs.master")}
      </label>
      <small className="text-muted-foreground text-xs">{t("notifyPrefs.masterHint")}</small>

      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 font-medium text-sm">{t("notifyPrefs.events")}</legend>
        {SWITCHABLE.map((event: SwitchableEvent) => (
          <label key={event} className={check}>
            <input
              type="checkbox"
              checked={prefs.events[event]}
              onChange={(e) => controller.setEvent(event, e.target.checked)}
            />
            {t(`notifyPrefs.event.${event}` as Key)}
          </label>
        ))}
      </fieldset>

      <label className={check}>
        <input
          type="checkbox"
          checked={prefs.teamFold}
          onChange={(e) => controller.setTeamFold(e.target.checked)}
        />
        {t("notifyPrefs.teamFold")}
      </label>

      <fieldset className="m-0 flex flex-col gap-1 border-0 p-0">
        <legend className="mb-1 font-medium text-sm">{t("notifyPrefs.mute")}</legend>
        {props.hosts.map((host) => (
          <div key={host.id} className="flex flex-col gap-1">
            <label className={check}>
              <input
                type="checkbox"
                checked={prefs.mutedHosts.includes(host.id)}
                onChange={(e) => controller.muteHost(host.id, e.target.checked)}
              />
              {t("notifyPrefs.muteHost", { name: host.name })}
            </label>
            {(props.projects[host.id] ?? []).map((project) => {
              const key = `${host.id}/${project.id}`;
              return (
                <label key={key} className={`${check} pl-6`}>
                  <input
                    type="checkbox"
                    checked={prefs.mutedProjects.includes(key)}
                    onChange={(e) => controller.muteProject(key, e.target.checked)}
                  />
                  {t("notifyPrefs.muteProject", { name: project.name, host: host.name })}
                </label>
              );
            })}
          </div>
        ))}
        {prefs.mutedSessions.map((session) => (
          <div key={session} className="flex items-center gap-2 text-sm">
            <span className="min-w-0 truncate">
              {t("notifyPrefs.mutedSession", { name: session })}
            </span>
            <Button
              variant="ghost"
              size="sm"
              aria-label={t("notifyPrefs.unmute", { name: session })}
              onClick={() => controller.muteSession(session, false)}
            >
              {t("notifyPrefs.unmuteShort")}
            </Button>
          </div>
        ))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-sm">
          <Volume2 aria-hidden="true" className="size-4 shrink-0" />
          <label htmlFor="notify-sound">{t("notifyPrefs.sound")}</label>
          <NativeSelect
            id="notify-sound"
            className="w-44"
            value={prefs.sound.mode}
            onChange={(e) =>
              controller.setSound({ mode: e.target.value as "off" | "system" | "file" })
            }
          >
            <option value="off">{t("notifyPrefs.soundOff")}</option>
            <option value="system">{t("notifyPrefs.soundSystem")}</option>
            <option value="file">{t("notifyPrefs.soundFile")}</option>
          </NativeSelect>
        </div>
        <label className="flex items-center gap-2 text-sm">
          {t("notifyPrefs.volume")}
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(prefs.sound.volume * 100)}
            onChange={(e) => controller.setSound({ volume: Number(e.target.value) / 100 })}
          />
        </label>
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t("notifyPrefs.chooseFile")}
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
            onChange={(e) => chooseFile(e.target.files?.[0])}
          />
          {prefs.sound.fileName && <span>{prefs.sound.fileName}</span>}
        </label>
        {problem && (
          <p role="alert" className="text-destructive text-sm">
            {problem}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <Button
          variant="outline"
          className="self-start"
          onClick={() => void store.sendTestNotification().then(setTest)}
        >
          {t("notifyPrefs.test")}
        </Button>
        {test && (
          <p role="status" className="text-sm">
            {test === "delivered"
              ? t("notifyPrefs.delivered")
              : `${t("notifyPrefs.notShown")} ${t("notifyPrefs.blockedHint")}`}
          </p>
        )}
      </div>
    </Panel>
  );
}
