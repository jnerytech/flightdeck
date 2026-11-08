import { HARNESS_PREVIEW_PARTS, type HarnessPreview } from "@flightdeck/protocol";
import { memo, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Stack } from "@/components/layout/stack";
import { refusalText } from "@/i18n/errors";
import type { AppStore } from "@/lib/app-store";
import { addsNothing, needsReformat, previewDigests } from "@/lib/harness";
import { ConfirmDialog } from "@/ui/ConfirmDialog";

type T = AppStore["i18n"]["t"];

/** The refusals a new preview, read again, can get past; any other (a far connection) it cannot. */
const PREVIEW_AGAIN = new Set(["harness_stale", "harness_reformat", "harness_confirm"]);

export interface HarnessSetupProps {
  store: AppStore;
  hostId: string;
  path: string;
  /** The project's own hooks load only once it is trusted: the dialog says so when it is not. */
  trusted: boolean;
  /** Reads the project again: the checklist and the trust listing show what was added. */
  onApplied(): Promise<void>;
  /** The host can commit what apply wrote on a new branch (#75, C1). */
  canCommit?: boolean;
  /** The host can draft a CLAUDE.md with its model (#75, G1). */
  canDraft?: boolean;
}

/** One titled list in the dialog; nothing when the list is empty. */
function Group(props: Readonly<{ title: string; items: string[]; note?: string | null }>) {
  if (props.items.length === 0) return null;
  return (
    <Stack gap={1} className="text-sm">
      <p className="font-medium">{props.title}</p>
      <Stack as="ul" gap={1} className="font-mono text-xs [overflow-wrap:anywhere]">
        {/* The same line twice says nothing more, and two rows would share a key. */}
        {[...new Set(props.items)].map((item) => (
          <li key={item}>{item}</li>
        ))}
      </Stack>
      {props.note && <p className="text-muted-foreground text-xs">{props.note}</p>}
    </Stack>
  );
}

/** What the setup would add, with what each part does not promise. */
/** The CLAUDE.md's draft step (#75, G1): offered, under way, its note, or its refusal. */
interface DraftStep {
  offered: boolean;
  busy: boolean;
  /** The template was replaced by the host's draft. */
  drafted: boolean;
  refusal: string | null;
  run(): void;
}

function Details(
  props: Readonly<{ preview: HarnessPreview; trusted: boolean; t: T; draft: DraftStep }>,
) {
  const { preview, trusted, t, draft } = props;
  const hooks = preview.settings?.hooks ?? [];
  const deny = preview.settings?.denyRules ?? [];
  return (
    <Stack gap={3}>
      <Group
        title={t("projectPage.harness.setup.hooks")}
        items={hooks.map((hook) => t("projectPage.harness.setup.hookLine", { ...hook }))}
        note={t("projectPage.harness.setup.formatterNote")}
      />
      <Group
        title={t("projectPage.harness.setup.deny")}
        items={deny}
        note={t("projectPage.harness.setup.denyNote")}
      />
      {preview.files.length > 0 && (
        <Stack gap={1} className="text-sm">
          <p className="font-medium">{t("projectPage.harness.setup.files")}</p>
          {preview.files.map((file) => (
            <details key={file.path}>
              <summary className="font-mono text-xs">{file.path}</summary>
              {file.path === "CLAUDE.md" && draft.offered && (
                <Stack gap={1}>
                  {draft.drafted ? (
                    <p className="text-sm text-status-needs-you">
                      {t("projectPage.harness.setup.drafted")}
                    </p>
                  ) : (
                    <div>
                      <ActionButton variant="outline" pending={draft.busy} onClick={draft.run}>
                        {t("projectPage.harness.setup.draft")}
                      </ActionButton>
                    </div>
                  )}
                  {draft.refusal && <p className="text-sm">{draft.refusal}</p>}
                </Stack>
              )}
              <pre
                className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs"
                // biome-ignore lint/a11y/noNoninteractiveTabindex: a long file scrolls, and focus lets the keyboard do it
                tabIndex={0}
              >
                {file.content}
              </pre>
            </details>
          ))}
        </Stack>
      )}
      <Group
        title={t("projectPage.harness.setup.conflicts")}
        items={preview.settings?.conflicts ?? []}
      />
      <Group title={t("projectPage.harness.setup.unreadable")} items={preview.unreadable} />
      {!trusted && hooks.length + deny.length > 0 && (
        <p className="text-sm text-status-needs-you">{t("projectPage.harness.setup.untrusted")}</p>
      )}
    </Stack>
  );
}

/**
 * Issue #75, slice S4b: sets up what the preview proposes, once the person read it. Apply sends the
 * digests of the preview on screen; the host makes the proposals again and refuses when the project
 * changed (`harness_stale`), and then only a new preview, read again, can apply.
 */
export const HarnessSetup = memo(function HarnessSetup(props: Readonly<HarnessSetupProps>) {
  const { store, hostId, path, trusted } = props;
  const { t } = store.i18n;
  const parts = [...HARNESS_PREVIEW_PARTS];
  const [shown, setShown] = useState<HarnessPreview | null>(null);
  const [ticked, setTicked] = useState(false);
  const [outcome, setOutcome] = useState<{ text: string; again: boolean } | null>(null);
  // What the last apply wrote, with the digests a commit must send back (#75, C1).
  const [wrote, setWrote] = useState<{ files: string[]; digests: Record<string, string> } | null>(
    null,
  );
  const [askingCommit, setAskingCommit] = useState(false);
  // The CLAUDE.md draft (#75, G1): under way, done (the template replaced), or refused.
  const [drafting, setDrafting] = useState(false);
  const [drafted, setDrafted] = useState(false);
  const [draftRefusal, setDraftRefusal] = useState<string | null>(null);
  // Apply is under way: no second preview may start, or its apply would race this one.
  const [busy, setBusy] = useState(false);

  const preview = async () => {
    setOutcome(null);
    setDrafted(false);
    setDraftRefusal(null);
    // What an older apply wrote is not what the next one will: no commit of it.
    setWrote(null);
    setTicked(false);
    const got = await store.hostCommand(hostId, "project.harness.preview", { path, parts });
    if (got) setShown(got);
  };

  const apply = async (seen: HarnessPreview, reformat: boolean) => {
    setShown(null);
    setBusy(true);
    const result = await store
      .hostRequest(hostId, "project.harness.apply", {
        path,
        parts,
        digests: previewDigests(seen),
        confirm: true,
        ...(reformat ? { reformat: true } : {}),
      })
      .finally(() => setBusy(false));
    if (!result.ok) {
      setWrote(null);
      const again = PREVIEW_AGAIN.has(result.reason ?? "");
      setOutcome({ text: refusalText(result.code, result.message, t, result), again });
      return;
    }
    const files = result.data.written.join(", ");
    setOutcome({ text: t("projectPage.harness.setup.done", { files }), again: false });
    const digests = result.data.digests;
    // Nothing written, nothing to commit.
    const any = digests !== undefined && Object.keys(digests).length > 0;
    setWrote(any ? { files: result.data.written, digests } : null);
    await props.onApplied();
  };

  // The files apply wrote, by their digests: the host commits them only if they are still so.
  const commit = async (made: { files: string[]; digests: Record<string, string> }) => {
    if (busy) return;
    setAskingCommit(false);
    setBusy(true);
    const result = await store
      .hostRequest(hostId, "project.harness.commit", {
        path,
        digests: made.digests,
        confirm: true,
      })
      .finally(() => setBusy(false));
    if (!result.ok) {
      // A stale refusal will not pass on a retry: the files must be applied again first.
      if (result.reason === "harness_commit_stale") setWrote(null);
      setOutcome({ text: refusalText(result.code, result.message, t, result), again: false });
      return;
    }
    setWrote(null);
    setOutcome({
      text: t("projectPage.harness.setup.committed", { branch: result.data.branch }),
      again: false,
    });
  };

  // The host's draft takes the template's place in the preview on screen; apply then sends the
  // draft's digest, and the host writes the draft it holds, never text from here.
  const draftClaudeMd = async () => {
    if (drafting) return;
    setDrafting(true);
    setDraftRefusal(null);
    const result = await store
      .hostRequest(hostId, "project.harness.draft", { path, part: "claudeMd" })
      .finally(() => setDrafting(false));
    if (!result.ok) {
      setDraftRefusal(refusalText(result.code, result.message, t, result));
      return;
    }
    const { content, digest } = result.data;
    setShown((now) =>
      now
        ? {
            ...now,
            files: now.files.map((file) =>
              file.path === "CLAUDE.md" ? { ...file, content, digest } : file,
            ),
          }
        : now,
    );
    setDrafted(true);
  };

  const nothing = shown !== null && addsNothing(shown);
  const tick = shown !== null && needsReformat(shown);
  return (
    <Stack gap={2}>
      <div>
        <ActionButton variant="outline" pending={busy} onClick={() => void preview()}>
          {t("projectPage.harness.setup.action")}
        </ActionButton>
      </div>
      {outcome && (
        <div role="status">
          <Stack gap={1}>
            <p className="text-sm">{outcome.text}</p>
            {outcome.again && (
              <div>
                <ActionButton variant="outline" pending={busy} onClick={() => void preview()}>
                  {t("projectPage.harness.setup.again")}
                </ActionButton>
              </div>
            )}
            {props.canCommit && wrote && (
              <div>
                <ActionButton
                  variant="outline"
                  pending={busy}
                  onClick={() => setAskingCommit(true)}
                >
                  {t("projectPage.harness.setup.commit")}
                </ActionButton>
              </div>
            )}
          </Stack>
        </div>
      )}
      {askingCommit && wrote && (
        <ConfirmDialog
          message={t("projectPage.harness.setup.commitMessage")}
          confirmLabel={t("projectPage.harness.setup.commit")}
          onCancel={() => setAskingCommit(false)}
          onConfirm={() => void commit(wrote)}
        >
          <Group title={t("projectPage.harness.setup.commitFiles")} items={wrote.files} />
        </ConfirmDialog>
      )}
      {shown && (
        <ConfirmDialog
          message={t(
            nothing ? "projectPage.harness.setup.nothing" : "projectPage.harness.setup.message",
          )}
          confirmLabel={t("projectPage.harness.setup.apply")}
          confirmDisabled={nothing || (tick && !ticked)}
          onCancel={() => setShown(null)}
          onConfirm={() => void apply(shown, tick && ticked)}
        >
          {/* A long preview scrolls, so Apply and Cancel stay in sight on a small window. */}
          <div className="max-h-[60vh] overflow-y-auto">
            <Details
              preview={shown}
              trusted={trusted}
              t={t}
              draft={{
                offered: props.canDraft === true,
                busy: drafting,
                drafted,
                refusal: draftRefusal,
                run: () => void draftClaudeMd(),
              }}
            />
          </div>
          {tick && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                checked={ticked}
                onChange={(event) => setTicked(event.target.checked)}
              />
              {t("projectPage.harness.setup.reformat")}
            </label>
          )}
        </ConfirmDialog>
      )}
    </Stack>
  );
});
