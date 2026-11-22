import type { Project } from "@flightdeck/protocol";
import { Volume2 } from "lucide-react";
import { useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { ActionButton } from "@/shared/feedback/index.ts";
import { Inline, NativeSelect, Panel } from "@/shared/layout/index.ts";
import type { Key, T } from "../../i18n/index.ts";
import type { AppStore, HostView } from "../../lib/app-store.ts";
import { SOUND_FILE_MAX_BYTES, SWITCHABLE, type SwitchableEvent } from "./domain/notify-policy.ts";
import { unlistedMutes } from "./domain/unlisted-mutes.ts";

const AUDIO_NAME = /\.(mp3|wav|ogg|m4a|aac|flac)$/i;
const check = "flex items-center gap-2 text-sm";
const nestedCheck = `${check} pl-6`;

/**
 * Settings, Notifications (issue #149): what the person is told about and where, who is muted, the
 * sound and a button that proves the system shows them. The rules themselves are in `notify-policy`.
 */
export function NotificationPrefs(
  props: Readonly<{
    store: AppStore;
    hosts: HostView[];
    projects: Record<string, Project[]>;
    t: T;
  }>,
) {
  const { store, t } = props;
  const prefs = useSyncExternalStore(store.notifyPrefs.subscribe, () => store.notifyPrefs.value);
  const controller = store.notifyPrefs;
  const [problem, setProblem] = useState<string | null>(null);
  const hintId = useId();
  const usesVolume = prefs.sound.mode !== "off";
  const usesFile = prefs.sound.mode === "file";
  const [test, setTest] = useState<"delivered" | "blocked" | null>(null);
  // With the master switch off there is no system notification and no sound: what only feeds them waits.
  const off = !prefs.enabled;
  const offId = `${hintId}-off`;
  const describe = (...ids: Array<string | false>) => ids.filter(Boolean).join(" ") || undefined;
  const unlisted = unlistedMutes(prefs, props.hosts, props.projects);
  const nothingToMute =
    props.hosts.length === 0 &&
    unlisted.hosts.length === 0 &&
    unlisted.projects.length === 0 &&
    prefs.mutedSessions.length === 0;

  const chooseFile = (file: File | undefined) => {
    if (!file) return;
    setProblem(null);
    if (!file.type.startsWith("audio/") && !AUDIO_NAME.test(file.name)) {
      setProblem(t("notifyPrefs.notAudio"));
      return;
    }
    if (file.size > SOUND_FILE_MAX_BYTES) {
      setProblem(t("notifyPrefs.tooLarge"));
      return;
    }
    void file.arrayBuffer().then((buffer) => {
      let binary = "";
      const bytes = new Uint8Array(buffer);
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCodePoint(...bytes.subarray(i, i + 0x8000));
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
          aria-describedby={`${hintId}-master`}
          onChange={(e) => controller.setEnabled(e.target.checked)}
        />
        {t("notifyPrefs.master")}
      </label>
      <small id={`${hintId}-master`} className="text-muted-foreground text-xs">
        {t("notifyPrefs.masterHint")}
      </small>
      {off && (
        <small id={offId} className="text-muted-foreground text-xs">
          {t("notifyPrefs.offNote")}
        </small>
      )}

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

      <fieldset className="m-0 flex max-h-72 flex-col gap-2 overflow-y-auto border-0 p-0">
        <legend className="mb-1 font-medium text-sm">{t("notifyPrefs.mute")}</legend>
        {nothingToMute && (
          <p className="text-muted-foreground text-sm">{t("notifyPrefs.muteNone")}</p>
        )}
        {props.hosts.map((host) => (
          <fieldset key={host.id} className="m-0 flex flex-col gap-1 border-0 p-0">
            <legend className="font-medium text-muted-foreground text-xs">{host.name}</legend>
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
                <label key={key} className={nestedCheck}>
                  <input
                    type="checkbox"
                    checked={prefs.mutedProjects.includes(key)}
                    onChange={(e) => controller.muteProject(key, e.target.checked)}
                  />
                  {t("notifyPrefs.muteProject", { name: project.name, host: host.name })}
                </label>
              );
            })}
          </fieldset>
        ))}
        {unlisted.hosts.map((id) => (
          <MutedRow
            key={`host/${id}`}
            text={t("notifyPrefs.mutedHostGone", { name: id })}
            unmute={t("notifyPrefs.unmute", { name: id })}
            short={t("notifyPrefs.unmuteShort")}
            onUnmute={() => controller.muteHost(id, false)}
          />
        ))}
        {unlisted.projects.map((key) => (
          <MutedRow
            key={`project/${key}`}
            text={t("notifyPrefs.mutedProjectGone", { name: key })}
            unmute={t("notifyPrefs.unmute", { name: key })}
            short={t("notifyPrefs.unmuteShort")}
            onUnmute={() => controller.muteProject(key, false)}
          />
        ))}
        {prefs.mutedSessions.map((session) => (
          <MutedRow
            key={session}
            text={t("notifyPrefs.mutedSession", { name: session })}
            unmute={t("notifyPrefs.unmute", { name: session })}
            short={t("notifyPrefs.unmuteShort")}
            onUnmute={() => controller.muteSession(session, false)}
          />
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
            disabled={off}
            aria-describedby={describe(off && offId)}
            onChange={(e) => {
              setProblem(null);
              controller.setSound({ mode: e.target.value as "off" | "system" | "file" });
            }}
          >
            <option value="off">{t("notifyPrefs.soundOff")}</option>
            <option value="system">{t("notifyPrefs.soundSystem")}</option>
            <option value="file">{t("notifyPrefs.soundFile")}</option>
          </NativeSelect>
        </div>
        <Inline gap={2} className="text-sm">
          <label className={check}>
            {t("notifyPrefs.volume")}
            <input
              type="range"
              min={0}
              max={100}
              disabled={!usesVolume || off}
              aria-valuetext={`${Math.round(prefs.sound.volume * 100)}%`}
              aria-describedby={describe(!usesVolume && `${hintId}-volume`, off && offId)}
              value={Math.round(prefs.sound.volume * 100)}
              onChange={(e) => controller.setSound({ volume: Number(e.target.value) / 100 })}
            />
          </label>
          {/* The slider already announces its value: the text is for the eyes only. */}
          <span aria-hidden="true" className="text-muted-foreground">
            {Math.round(prefs.sound.volume * 100)}%
          </span>
        </Inline>
        {!usesVolume && (
          <small id={`${hintId}-volume`} className="text-muted-foreground text-xs">
            {t("notifyPrefs.volumeHint")}
          </small>
        )}
        <label className="flex flex-wrap items-center gap-2 text-sm">
          {t("notifyPrefs.chooseFile")}
          <input
            type="file"
            accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac,.flac"
            disabled={!usesFile || off}
            aria-describedby={describe(!usesFile && `${hintId}-file`, off && offId)}
            onChange={(e) => chooseFile(e.target.files?.[0])}
          />
          {prefs.sound.fileName && <span>{prefs.sound.fileName}</span>}
        </label>
        {!usesFile && (
          <small id={`${hintId}-file`} className="text-muted-foreground text-xs">
            {t("notifyPrefs.fileHint", { file: t("notifyPrefs.soundFile") })}
          </small>
        )}
        {problem && (
          <p role="alert" className="text-destructive text-sm">
            {problem}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-2">
        <ActionButton
          variant="outline"
          className="self-start"
          disabled={off}
          disabledReason={t("notifyPrefs.testOff")}
          onClick={() => {
            // The answer of the last press is gone while the next one runs, so each is announced.
            setTest(null);
            return store.inbox.sendTest().then(setTest);
          }}
        >
          {t("notifyPrefs.test")}
        </ActionButton>
        {/* Always there, so a reader hears the text arrive. */}
        <output className="block text-sm">
          {test === "delivered" && t("notifyPrefs.delivered")}
          {test === "blocked" && `${t("notifyPrefs.notShown")} ${t("notifyPrefs.blockedHint")}`}
        </output>
      </div>
    </Panel>
  );
}

/** A saved mute with the button that clears it. */
function MutedRow(
  props: Readonly<{ text: string; unmute: string; short: string; onUnmute(): void }>,
) {
  return (
    <div className="flex items-center gap-2 text-sm">
      <span className="min-w-0 truncate">{props.text}</span>
      <Button variant="ghost" size="sm" aria-label={props.unmute} onClick={props.onUnmute}>
        {props.short}
      </Button>
    </div>
  );
}
