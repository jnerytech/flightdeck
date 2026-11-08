import type { ChangesResult } from "@flightdeck/protocol";
import { useState } from "react";
import { AssistField } from "@/components/assistant/assist-field";
import { ActionButton } from "@/components/feedback/action-button";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { CheckField, Field } from "@/components/layout/form";
import { Inline, Stack } from "@/components/layout/stack";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { PrDescriptionDialog } from "@/components/watch/pr-description-dialog";
import { useT } from "@/i18n/context";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";
import {
  committable,
  draftCommit,
  draftPr,
  recallCommit,
  rememberCommit,
} from "@/lib/session-finish";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

/** The hooks a commit runs, in a line: none set, or not known. */
function hooksText(t: ReturnType<typeof useT>, hooks: string[] | undefined): string {
  if (hooks === undefined) return t("sessionFinish.hooksUnknown");
  if (hooks.length === 0) return t("sessionFinish.noHooks");
  return t("sessionFinish.hooks", { hooks: hooks.join(", ") });
}

/** What the person is about to commit: the files ticked, the new branch and the message. */
interface CommitForm {
  picked: Record<string, boolean>;
  branch: string;
  message: string;
}

/**
 * #1133, slice A1: a plain session's Changes ends here. The files the person ticks are committed on
 * a new branch, as they saw them (their digests), with the hooks that will run named; then its PR
 * opens with the title and description they confirmed, pushed where they saw.
 */
export function SessionFinish(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    target: string;
    changes: ChangesResult;
    refresh(): Promise<void>;
  }>,
) {
  const t = useT();
  const { store, hostId, target, changes } = props;
  const key = `${hostId}\0${target}`;
  const [made, setMade] = useState(() => recallCommit(key));
  const [form, setForm] = useState<CommitForm | null>(null);
  const [pr, setPr] = useState<{ title: string; body: string } | null>(null);
  const [outcome, setOutcome] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const files = changes.files;
  const remote = changes.remote;
  const assist = {
    controller: store.assistant,
    fieldHostId: hostId,
    source: { kind: "worktree" as const, cwd: changes.root },
    openSettings: store.openAssistantSettings,
  };

  const ask = () => {
    const paths = files.filter(committable).map((file) => file.path);
    setOutcome(null);
    setForm({
      picked: Object.fromEntries(paths.map((path) => [path, true])),
      ...draftCommit(t, paths),
    });
  };

  const commit = async (asked: CommitForm) => {
    const chosen = files.filter((file) => committable(file) && asked.picked[file.path]);
    setForm(null);
    setBusy(true);
    const result = await store
      .hostRequest(hostId, "changes.commit", {
        target,
        files: Object.fromEntries(chosen.map((file) => [file.path, file.digest ?? ""])),
        message: asked.message,
        branch: asked.branch.trim(),
        confirm: true,
      })
      .finally(() => setBusy(false));
    if (!result.ok) {
      setOutcome(refusalText(result.code, result.message, t, result));
      return;
    }
    const record = { ...result.data, message: asked.message };
    rememberCommit(key, record);
    setMade(record);
    store.success(t("sessionFinish.committed", { branch: result.data.branch }));
    await props.refresh();
  };

  const openPr = async (body: string, title: string) => {
    if (!made || !remote) return;
    setPr(null);
    setBusy(true);
    const result = await store
      .hostRequest(hostId, "changes.pr", { target, title, body, remote, confirm: true })
      .finally(() => setBusy(false));
    if (!result.ok) {
      setOutcome(refusalText(result.code, result.message, t, result));
      return;
    }
    store.success(t("sessionFinish.prOpened", { url: result.data.url }));
  };

  const hooks = changes.hooks;
  const hooksLine = hooksText(t, hooks);
  const ready =
    form !== null &&
    Object.values(form.picked).some(Boolean) &&
    form.branch.trim() !== "" &&
    form.message.trim() !== "";

  return (
    <Stack gap={2}>
      <Inline gap={2}>
        <ActionButton
          variant="outline"
          size="sm"
          pending={busy}
          disabled={!files.some(committable)}
          onClick={ask}
        >
          {t("sessionFinish.commit")}
        </ActionButton>
        {made && (
          <ActionButton
            size="sm"
            pending={busy}
            disabled={!remote}
            {...(remote ? {} : { disabledReason: t("sessionFinish.noRemote") })}
            onClick={() => setPr(draftPr(t, made.message, made.files))}
          >
            {t("sessionFinish.openPr")}
          </ActionButton>
        )}
      </Inline>
      {outcome && <InlineNotice tone="error">{outcome}</InlineNotice>}
      {form && (
        <ConfirmDialog
          message={t("sessionFinish.commitMessage")}
          confirmLabel={t("sessionFinish.commit")}
          confirmDisabled={!ready}
          onCancel={() => setForm(null)}
          onConfirm={() => void commit(form)}
        >
          <Stack gap={3}>
            <Stack gap={1} label={t("sessionFinish.files")}>
              {files.map((file) => (
                <Stack gap={1} key={file.path}>
                  <CheckField
                    checked={committable(file) && form.picked[file.path] === true}
                    disabled={!committable(file)}
                    onChange={(checked) =>
                      setForm({ ...form, picked: { ...form.picked, [file.path]: checked } })
                    }
                  >
                    {file.path}
                  </CheckField>
                  {!committable(file) && (
                    <p className="text-muted-foreground text-xs">
                      {t("sessionFinish.tooLarge", { path: file.path })}
                    </p>
                  )}
                </Stack>
              ))}
            </Stack>
            <Field label={t("sessionFinish.branch")}>
              {(control) => (
                <Input
                  {...control}
                  value={form.branch}
                  onChange={(e) => setForm({ ...form, branch: e.target.value })}
                />
              )}
            </Field>
            <AssistField
              binding={{ ...assist, kind: "commit.message" }}
              value={form.message}
              onChange={(message) => setForm({ ...form, message })}
              t={t}
            >
              {(control) => (
                <Textarea
                  {...control}
                  aria-label={t("sessionFinish.message")}
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                />
              )}
            </AssistField>
            <p className="text-sm">{hooksLine}</p>
            <p className="text-muted-foreground text-sm">{t("sessionFinish.others")}</p>
          </Stack>
        </ConfirmDialog>
      )}
      {pr && made && remote && (
        <PrDescriptionDialog
          text={pr.body}
          title={pr.title}
          redacted={0}
          assist={assist}
          onCancel={() => setPr(null)}
          onConfirm={openPr}
        >
          <p className="text-sm">
            {[
              t("sessionFinish.pushes", { branch: made.branch, remote }),
              ...(hooks?.includes("pre-push") ? [t("sessionFinish.prePush")] : []),
            ].join(" ")}
          </p>
        </PrDescriptionDialog>
      )}
    </Stack>
  );
}
