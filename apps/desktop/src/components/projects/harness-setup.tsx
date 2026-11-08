import {
  HARNESS_PREVIEW_PARTS,
  type HarnessPreview,
  type HarnessTemplateInfo,
} from "@flightdeck/protocol";
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Field, NativeSelect } from "@/components/layout/form";
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
  /** The host keeps setup templates: the dialog can start from one (#75, T2). */
  canTemplates?: boolean;
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
          {preview.files.map((file) => {
            const step = file.path === "CLAUDE.md" && draft.offered;
            return (
              <Stack key={file.path} gap={1}>
                {/* A drafted file opens, so what will be written is in front of the person. */}
                <details open={step && draft.drafted}>
                  <summary className="hit-24 cursor-pointer font-mono text-xs leading-6">
                    {file.path}
                  </summary>
                  <pre
                    className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted p-2 font-mono text-xs"
                    // biome-ignore lint/a11y/noNoninteractiveTabindex: a long file scrolls, and focus lets the keyboard do it
                    tabIndex={0}
                  >
                    {file.content}
                  </pre>
                </details>
                {step &&
                  (draft.drafted ? (
                    <p className="text-sm text-status-needs-you">
                      {t("projectPage.harness.setup.drafted")}
                    </p>
                  ) : (
                    <div>
                      <ActionButton variant="outline" pending={draft.busy} onClick={draft.run}>
                        {t("projectPage.harness.setup.draft")}
                      </ActionButton>
                    </div>
                  ))}
                {step && draft.refusal && <p className="text-sm">{draft.refusal}</p>}
              </Stack>
            );
          })}
        </Stack>
      )}
      <Group
        title={t("projectPage.harness.setup.conflicts")}
        items={preview.settings?.conflicts ?? []}
      />
      <Group title={t("projectPage.harness.setup.unreadable")} items={preview.unreadable} />
      <Group
        title={t("projectPage.harness.setup.withheld")}
        items={(preview.withheld ?? []).map((file) =>
          t("projectPage.harness.setup.withheldLine", {
            path: file.path,
            why: t(`projectPage.harness.setup.withheldWhy.${file.reason}`),
          }),
        )}
      />
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
  const [outcome, setOutcome] = useState<{
    text: string;
    again: boolean;
    /** A refusal: said as an alert. */
    refused?: boolean;
  } | null>(null);
  // #1090: Apply and Commit close their dialog, and the button they came from is busy or gone; the
  // focus goes to what they answered, not to the page, and the regions that say it stay mounted.
  const said = useRef<HTMLDivElement>(null);
  const refusedBox = useRef<HTMLDivElement>(null);
  const focusOutcome = useRef(false);
  useEffect(() => {
    if (!focusOutcome.current || outcome === null) return;
    focusOutcome.current = false;
    (outcome.refused ? refusedBox : said).current?.focus();
  }, [outcome]);
  // What the last apply wrote, with the digests a commit must send back (#75, C1).
  const [wrote, setWrote] = useState<{ files: string[]; digests: Record<string, string> } | null>(
    null,
  );
  const [askingCommit, setAskingCommit] = useState(false);
  // The CLAUDE.md draft (#75, G1): under way, done (the template replaced), or refused.
  const [drafting, setDrafting] = useState(false);
  // Bumped by each preview: a draft that comes back after another preview belongs to none.
  const previewRound = useRef(0);
  const [drafted, setDrafted] = useState(false);
  const [draftRefusal, setDraftRefusal] = useState<string | null>(null);
  // Apply is under way: no second preview may start, or its apply would race this one.
  const [busy, setBusy] = useState(false);
  // The host's templates (#75, T2): "" is the fixed files; a template's id is its Markdown instead.
  const [templates, setTemplates] = useState<HarnessTemplateInfo[]>([]);
  const [template, setTemplate] = useState("");
  /** Reads the host's templates again; a chosen one that is no longer there is dropped from the choice. */
  const readTemplates = useCallback(async () => {
    if (!props.canTemplates) return;
    const got = await store.hostCommand(hostId, "harness.templates.list", {});
    if (!got) return;
    setTemplates(got.templates);
    setTemplate((chosen) => (got.templates.some((item) => item.id === chosen) ? chosen : ""));
  }, [store, hostId, props.canTemplates]);
  useEffect(() => {
    void readTemplates();
  }, [readTemplates]);
  const fromTemplate = template === "" ? {} : { template };

  /** The preview on screen is gone (a new one, Cancel, an apply): a draft under way is for none. */
  const leavePreview = () => {
    previewRound.current += 1;
    setDrafting(false);
    setDrafted(false);
    setDraftRefusal(null);
  };

  const preview = async () => {
    leavePreview();
    setOutcome(null);
    setDrafted(false);
    setDraftRefusal(null);
    // What an older apply wrote is not what the next one will: no commit of it.
    setWrote(null);
    setTicked(false);
    const got = await store.hostCommand(hostId, "project.harness.preview", {
      path,
      parts,
      ...fromTemplate,
    });
    if (got) setShown(got);
    // A refused preview of a template that is gone, or one shared meanwhile: the choice follows the host.
    else if (template !== "") void readTemplates();
  };

  const apply = async (seen: HarnessPreview, reformat: boolean) => {
    leavePreview();
    setShown(null);
    setBusy(true);
    const result = await store
      .hostRequest(hostId, "project.harness.apply", {
        path,
        parts,
        digests: previewDigests(seen),
        confirm: true,
        ...(reformat ? { reformat: true } : {}),
        ...fromTemplate,
      })
      .finally(() => setBusy(false));
    if (!result.ok) {
      setWrote(null);
      const again = PREVIEW_AGAIN.has(result.reason ?? "");
      focusOutcome.current = true;
      setOutcome({
        text: refusalText(result.code, result.message, t, result),
        again,
        refused: true,
      });
      if (result.reason === "harness_template_missing") void readTemplates();
      return;
    }
    const files = result.data.written.join(", ");
    focusOutcome.current = true;
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
      focusOutcome.current = true;
      setOutcome({
        text: refusalText(result.code, result.message, t, result),
        again: false,
        refused: true,
      });
      return;
    }
    setWrote(null);
    focusOutcome.current = true;
    setOutcome({
      text: t("projectPage.harness.setup.committed", { branch: result.data.branch }),
      again: false,
    });
  };

  // The host's draft takes the template's place in the preview on screen; apply then sends the
  // draft's digest, and the host writes the draft it holds, never text from here.
  const draftClaudeMd = async () => {
    if (drafting) return;
    const round = previewRound.current;
    setDrafting(true);
    setDraftRefusal(null);
    const result = await store
      .hostRequest(hostId, "project.harness.draft", { path, part: "claudeMd" })
      .finally(() => {
        // An old draft's end must not free the button of a newer preview's draft.
        if (round === previewRound.current) setDrafting(false);
      });
    if (round !== previewRound.current) return;
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
      {templates.length > 0 && (
        <Field label={t("projectPage.harness.setup.startFrom")}>
          {(control) => (
            <NativeSelect
              {...control}
              value={template}
              onChange={(event) => setTemplate(event.target.value)}
            >
              <option value="">{t("projectPage.harness.setup.builtIn")}</option>
              {templates.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
      )}
      <div>
        <ActionButton variant="outline" pending={busy} onClick={() => void preview()}>
          {t("projectPage.harness.setup.action")}
        </ActionButton>
      </div>
      {/* Mounted before anything is said, so a screen reader reads what fills them, and live even
          though the outcome also takes the focus: a focus lost (a remount, a dialog handing it
          back) must not leave the outcome unsaid. Some readers may say it twice. */}
      <div // NOSONAR: holds flow content (paragraphs, a list or placeholders), which <output> may not
        role="status"
        ref={said}
        tabIndex={-1}
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        {outcome && !outcome.refused && <p className="text-sm">{outcome.text}</p>}
      </div>
      <div
        role="alert"
        ref={refusedBox}
        tabIndex={-1}
        className="rounded-sm focus-visible:outline-2 focus-visible:outline-ring"
      >
        {outcome?.refused && <p className="text-sm">{outcome.text}</p>}
      </div>
      {outcome?.again && (
        <div>
          <ActionButton variant="outline" pending={busy} onClick={() => void preview()}>
            {t("projectPage.harness.setup.again")}
          </ActionButton>
        </div>
      )}
      {outcome && props.canCommit && wrote && (
        <div>
          <ActionButton variant="outline" pending={busy} onClick={() => setAskingCommit(true)}>
            {t("projectPage.harness.setup.commit")}
          </ActionButton>
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
          // A draft under way would replace the file being applied: wait for it.
          confirmDisabled={nothing || (tick && !ticked) || drafting}
          onCancel={() => {
            leavePreview();
            setShown(null);
          }}
          onConfirm={() => void apply(shown, tick && ticked)}
        >
          {/* A long preview scrolls, so Apply and Cancel stay in sight on a small window. */}
          <div className="max-h-[60vh] overflow-y-auto">
            <Details
              preview={shown}
              trusted={trusted}
              t={t}
              draft={{
                // A template brings its own Markdown: the host's draft would replace a file it chose.
                offered: props.canDraft === true && template === "",
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
