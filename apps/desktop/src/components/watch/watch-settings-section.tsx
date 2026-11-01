import type { Project, WatchSettings } from "@flightdeck/protocol";
import { type ReactNode, useCallback, useEffect, useId, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Panel } from "@/components/layout/panel";
import { Grid, Inline, Stack } from "@/components/layout/stack";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/context";
import type { AppStore } from "@/lib/app-store";
import { validateWatchDraft, watchDraftOf, watchPatchOf } from "../../lib/watch-settings.ts";

/** A labelled control: the label is tied to it by id. */
function Field(props: { label: string; children: (id: string) => ReactNode }) {
  const id = useId();
  return (
    <Stack gap={1}>
      <label htmlFor={id} className="text-sm">
        {props.label}
      </label>
      {props.children(id)}
    </Stack>
  );
}

/** One project's watch settings: loaded from the host, edited as text, saved as one patch. */
function ProjectWatchSettings(props: { store: AppStore; hostId: string; project: Project }) {
  const t = useT();
  const { store, hostId, project } = props;
  const [saved, setSaved] = useState<WatchSettings | null>(null);
  const [draft, setDraft] = useState(watchDraftOf(null));
  const keep = useCallback((settings: WatchSettings | null) => {
    if (!settings) return;
    setSaved(settings);
    setDraft(watchDraftOf(settings));
  }, []);
  useEffect(() => {
    void store.watchSettings(hostId, project.id).then(keep);
  }, [store, hostId, project.id, keep]);
  const set = (patch: Partial<typeof draft>) => setDraft({ ...draft, ...patch });
  const problem = validateWatchDraft(draft, t);
  const save = async () => {
    const settings = await store.watchSettings(hostId, project.id, watchPatchOf(draft));
    keep(settings);
    if (settings) store.success(t("watchSettingsUi.saved"));
  };
  if (saved === null) return <h4 className="font-medium text-sm">{project.name}</h4>;
  return (
    <Stack gap={3}>
      <h4 className="font-medium text-sm">{project.name}</h4>
      <Inline gap={2}>
        <label className="text-sm">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />{" "}
          {t("watchSettingsUi.enabled")}
        </label>
      </Inline>
      <Grid cols={{ base: 1, sm: 3 }} gap={3}>
        <Field label={t("watchSettingsUi.maxRounds")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              value={draft.maxRounds}
              onChange={(e) => set({ maxRounds: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("watchSettingsUi.budget")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              placeholder={t("watchSettingsUi.noLimit")}
              value={draft.budgetUsd}
              onChange={(e) => set({ budgetUsd: e.target.value })}
            />
          )}
        </Field>
        <Field label={t("watchSettingsUi.daily")}>
          {(id) => (
            <Input
              id={id}
              type="number"
              placeholder={t("watchSettingsUi.noLimit")}
              value={draft.dailyUsd}
              onChange={(e) => set({ dailyUsd: e.target.value })}
            />
          )}
        </Field>
      </Grid>
      <Field label={t("watchSettingsUi.timeout")}>
        {(id) => (
          <Input
            id={id}
            type="number"
            value={draft.checkTimeoutMin}
            onChange={(e) => set({ checkTimeoutMin: e.target.value })}
          />
        )}
      </Field>
      <Field label={t("watchSettingsUi.checks")}>
        {(id) => (
          <textarea
            id={id}
            className="rounded-md border border-input bg-background px-3 py-2 font-mono text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            rows={3}
            value={draft.checks}
            onChange={(e) => set({ checks: e.target.value })}
          />
        )}
      </Field>
      <Inline gap={3}>
        <ActionButton
          size="sm"
          disabled={problem !== null}
          disabledReason={problem ?? undefined}
          onClick={save}
        >
          {t("watchSettingsUi.save")}
        </ActionButton>
      </Inline>
    </Stack>
  );
}

/**
 * Phase 22: the PR watch settings of a host's projects (the default for a new PR, the limits of
 * the fixing rounds and the checks that must pass before a push), one block per project.
 */
export function WatchSettingsSection(props: {
  store: AppStore;
  hostId: string;
  hostName: string;
  projects: Project[];
}) {
  const t = useT();
  const { store, hostId } = props;
  useEffect(() => {
    void store.loadProjects(hostId);
  }, [store, hostId]);
  const title = t("watchSettingsUi.title", { host: props.hostName });
  return (
    <section aria-label={title}>
      <Panel title={title}>
        <Stack gap={4}>
          {props.projects.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("watchSettingsUi.noProjects")}</p>
          )}
          {props.projects.map((project) => (
            <ProjectWatchSettings
              key={project.id}
              store={store}
              hostId={hostId}
              project={project}
            />
          ))}
        </Stack>
      </Panel>
    </section>
  );
}
