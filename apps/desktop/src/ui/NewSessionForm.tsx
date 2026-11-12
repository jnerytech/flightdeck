import type { CommandPayload, EffortLevel, PermissionMode } from "@flightdeck/protocol";
import { ChevronRight } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { AssistField } from "@/components/assistant/assist-field";
import { Field, Form, FormActions, NativeSelect } from "@/components/layout/form";
import { Page } from "@/components/layout/page";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useT } from "@/i18n/context";
import { cn } from "@/lib/utils";
import {
  choicesToKeep,
  createPayload,
  joinPath,
  ModelOptions,
  opensMoreOptions,
  promptMissing,
  sessionModes,
  startChoices,
  startFolder,
  underRoot,
} from "../features/sessions/index.ts";
import type { Key } from "../i18n/index.ts";
import type { AppStore, HostView } from "../lib/app-store.ts";
import { CLAUDE_MODELS } from "../lib/new-session-prefs.ts";
import { hasFeature } from "../lib/version.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { FolderPicker } from "./FolderPicker.tsx";

const EFFORTS: EffortLevel[] = ["low", "medium", "high", "xhigh", "max"];
type Runtime = "claude" | "opencode";

/** `onCreate` may answer with a promise: the button stays busy until it settles. */
const isThenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof (value as PromiseLike<unknown> | undefined)?.then === "function";

/** New session on a host: folder inside one of its allowedRoots, name, permission mode, prompt. */
export function NewSessionForm(
  props: Readonly<{
    host: HostView;
    /** Lets the folder be browsed on the host; without it the folder is typed. */
    store?: AppStore;
    onCreate(payload: CommandPayload<"session.create">): void | Promise<unknown>;
    /** The first prompt, filled in (a snippet, phase 18). */
    prompt?: string;
    /** The session cannot start without a first prompt (a background session, #940). */
    promptRequired?: boolean;
    /** More fields above Criar sessão: the persona picker (phase 20). */
    extra?: React.ReactNode;
    /** Something in `extra` is set (a persona, background), so More options opens (issue #1135). */
    extraSet?: boolean;
    /** Told the folder as it is chosen, so what depends on it (a client's persona) can follow. */
    onFolder?(cwd: string): void;
    /** The hosts a session can start on (online); the form offers a choice when there are two or more. */
    hosts?: Array<{ id: string; name: string }>;
    onHost?(hostId: string): void;
    /** Opens the host's page, where its folders are added. */
    onAddFolder?(): void;
  }>,
) {
  const t = useT();
  const roots = props.host.info?.allowedRoots ?? [];
  // The folder picked, else the host's first: its folders may arrive after the form opened.
  const [picked, setPicked] = useState<string | null>(null);
  // The folder the last session here started in (issue #1135), while the host still allows it.
  const prefs = props.store?.newSessionPrefs;
  // The subfolder typed; before that, the remembered one (only with the remembered folder).
  const [typedSub, setTypedSub] = useState<string | null>(null);
  const { root, sub } = startFolder({
    roots,
    picked,
    typedSub,
    kept: prefs?.folderOf(props.host.id),
  });
  // The person's own click on More options; until then it follows `wanted` (below).
  const [moreOpen, setMoreOpen] = useState<boolean | null>(null);
  const [latched, setLatched] = useState(false);
  const optionsId = useId();
  const [browsing, setBrowsing] = useState(false);
  /** The host answers `fs.dirs`: an older daemon does not, and there the folder is typed. */
  const canBrowse =
    props.store !== undefined && hasFeature(props.host.hostInfo?.features, "fs.dirs", false);
  /** A folder the host resolved to a path none of its configured roots start: kept as a root. */
  const [extra, setExtra] = useState<string | null>(null);
  const folders = extra && !roots.includes(extra) ? [...roots, extra] : roots;
  const pick = (path: string) => {
    setBrowsing(false);
    // The configured root that holds it; its rest is the subfolder.
    const held = underRoot(path, roots);
    if (held) {
      setPicked(held.root);
      setTypedSub(held.sub);
    } else {
      setExtra(path);
      setPicked(path);
      setTypedSub("");
    }
  };
  const { onFolder } = props;
  const cwd = joinPath(root, sub);
  useEffect(() => onFolder?.(cwd), [onFolder, cwd]);
  const [name, setName] = useState("");
  const start = startChoices(prefs?.value);
  const [mode, setMode] = useState<PermissionMode>(start.mode);
  const [model, setModel] = useState(start.model);
  /** Phase 39: the agent, offered when the host has OpenCode on; its models come from the host. */
  const [runtime, setRuntime] = useState<Runtime>("claude");
  const opencode = runtime === "opencode";
  // More options is folded, except that it opens by itself for what would otherwise act unseen: a
  // subfolder, OpenCode, or a setting of the screen's own. Once open for that it stays open, so
  // the field being edited never disappears from under the cursor.
  const wanted = opensMoreOptions(sub, opencode, props.extraSet === true);
  if (wanted && !latched) setLatched(true);
  const more = moreOpen ?? latched;
  const hasOpenCode =
    props.host.hostInfo?.runtimes?.some((r) => r.kind === "opencode" && r.available) === true;
  const [openCodeModels, setOpenCodeModels] = useState<string[]>([]);
  const [effort, setEffort] = useState<EffortLevel | "">("");
  const { store } = props;
  const hostId = props.host.id;
  useEffect(() => {
    if (!opencode || !store) return;
    let live = true;
    void store.hostRequest(hostId, "runtime.models", { runtime: "opencode" }).then((result) => {
      if (live) setOpenCodeModels(result.ok ? result.data.models.map((m) => m.id) : []);
    });
    return () => {
      live = false;
    };
  }, [opencode, store, hostId]);
  const chooseRuntime = (next: Runtime) => {
    setRuntime(next);
    setModel("");
    setMode("default");
  };
  const [prompt, setPrompt] = useState(props.prompt ?? "");
  /** A required prompt is still empty; OpenCode sessions are not started in the background. */
  const missingPrompt = promptMissing(props.promptRequired === true, opencode, prompt);
  /** The session is being created: the button is busy and a second press does nothing. */
  const [creating, setCreating] = useState(false);
  /** Bypass asks again each time the session is created. */
  const [asking, setAsking] = useState(false);
  const allowBypass = props.host.hostInfo?.allowBypassPermissions === true;
  const modes = sessionModes(opencode, allowBypass);
  const models = opencode ? openCodeModels : CLAUDE_MODELS;
  const submit = (confirmed = false) => {
    if (!root || creating || missingPrompt) return;
    if (mode === "bypassPermissions" && !confirmed) {
      setAsking(true);
      return;
    }
    setAsking(false);
    // OpenCode's modes and models are its own: only the folder is kept from such a session.
    if (prefs) {
      prefs.remember(props.host.id, {
        root,
        sub,
        ...choicesToKeep({ opencode, last: prefs.value, mode, model }),
      });
    }
    const done = props.onCreate(
      createPayload({ cwd, prompt, mode, model, name, opencode, effort }),
    );
    if (isThenable(done)) {
      setCreating(true);
      const finished = () => setCreating(false);
      done.then(finished, finished);
    }
  };
  return (
    <Page title={t("newSession.title", { host: props.host.name })}>
      <Form onSubmit={() => submit()}>
        {props.hosts && props.hosts.length > 1 && props.onHost && (
          <Field label={t("newSession.host")}>
            {(control) => (
              <NativeSelect
                {...control}
                value={props.host.id}
                onChange={(e) => props.onHost?.(e.target.value)}
              >
                {props.hosts?.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name}
                  </option>
                ))}
              </NativeSelect>
            )}
          </Field>
        )}
        <Field label={t("newSession.prompt")}>
          {(control) => {
            const area = (assist?: { onKeyDown?(event: React.KeyboardEvent): void }) => (
              <Textarea
                {...control}
                {...assist}
                // The task is what the person came to write: the form opens on it (issue #1135).
                autoFocus
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => {
                  assist?.onKeyDown?.(e);
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={t("newSession.optional")}
                className="min-h-28"
              />
            );
            // The AI wand (phase 40): it improves the prompt and never starts the session.
            return store ? (
              <AssistField
                binding={{
                  controller: store.assistant,
                  kind: "prompt",
                  fieldHostId: hostId,
                  ...(cwd ? { cwd } : {}),
                  openSettings: () => store.router.push({ name: "settings", section: "assistant" }),
                }}
                value={prompt}
                onChange={setPrompt}
                t={t}
              >
                {area}
              </AssistField>
            ) : (
              area()
            );
          }}
        </Field>
        <Field label={t("newSession.folder")}>
          {(control) => (
            <NativeSelect {...control} value={root} onChange={(e) => setPicked(e.target.value)}>
              {folders.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </NativeSelect>
          )}
        </Field>
        {canBrowse && (
          <Button
            type="button"
            variant="outline"
            className="self-start"
            onClick={() => setBrowsing(true)}
          >
            {t("folderPicker.browse")}
          </Button>
        )}
        {browsing && props.store && canBrowse && (
          <FolderPicker
            store={props.store}
            host={props.host}
            onPick={pick}
            onClose={() => setBrowsing(false)}
          />
        )}
        <Field label={t("newSession.mode")}>
          {(control) => (
            <>
              <NativeSelect
                {...control}
                value={mode}
                onChange={(e) => setMode(e.target.value as PermissionMode)}
              >
                {modes.map((m) => (
                  <option key={m} value={m}>
                    {t("modes.option", {
                      name: t(`modes.${m}.name` as Key),
                      description: t(`modes.${m}.description` as Key),
                    })}
                  </option>
                ))}
              </NativeSelect>
              {mode === "bypassPermissions" && (
                <p role="alert" className="text-status-error text-xs">
                  {t("modes.bypassWarning")}
                </p>
              )}
            </>
          )}
        </Field>
        <Field label={t("session.modelLabel")}>
          {(control) => (
            <NativeSelect {...control} value={model} onChange={(e) => setModel(e.target.value)}>
              <option value="">{t("session.modelDefault")}</option>
              <ModelOptions models={models} />
            </NativeSelect>
          )}
        </Field>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="self-start"
          aria-expanded={more}
          aria-controls={optionsId}
          onClick={() => setMoreOpen(!more)}
        >
          <ChevronRight
            aria-hidden="true"
            className={cn("size-4 transition-transform", more && "rotate-90")}
          />
          {t("newSession.moreOptions")}
        </Button>
        <div id={optionsId} hidden={!more}>
          <Stack gap={4}>
            {hasOpenCode && (
              <Field label={t("newSession.agent")}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={runtime}
                    onChange={(e) => chooseRuntime(e.target.value as Runtime)}
                  >
                    <option value="claude">{t("newSession.agentClaude")}</option>
                    <option value="opencode">{t("newSession.agentOpenCode")}</option>
                  </NativeSelect>
                )}
              </Field>
            )}
            <Field label={t("newSession.subfolder")}>
              {(control) => (
                <Input
                  {...control}
                  value={sub}
                  onChange={(e) => setTypedSub(e.target.value)}
                  placeholder={t("newSession.optional")}
                />
              )}
            </Field>
            <Field label={t("newSession.name")}>
              {(control) => (
                <Input
                  {...control}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("newSession.optional")}
                />
              )}
            </Field>
            {opencode && (
              <Field label={t("newSession.effort")}>
                {(control) => (
                  <NativeSelect
                    {...control}
                    value={effort}
                    onChange={(e) => setEffort(e.target.value as EffortLevel | "")}
                  >
                    <option value="">{t("newSession.effortDefault")}</option>
                    {EFFORTS.map((level) => (
                      <option key={level} value={level}>
                        {level}
                      </option>
                    ))}
                  </NativeSelect>
                )}
              </Field>
            )}
            {!opencode && props.extra}
          </Stack>
        </div>
        {asking && (
          <ConfirmDialog
            destructive
            message={t("newSession.bypassMessage", { host: props.host.name, folder: cwd })}
            confirmLabel={t("newSession.bypassConfirm")}
            onCancel={() => setAsking(false)}
            onConfirm={() => submit(true)}
          />
        )}
        <FormActions
          sticky
          submit={t("newSession.create")}
          busy={creating}
          disabled={!root || missingPrompt}
          disabledReason={
            root ? (
              t("newSession.needPrompt")
            ) : (
              <span>
                {t("newSession.needFolder")}{" "}
                {props.onAddFolder && (
                  <Button type="button" variant="link" onClick={props.onAddFolder}>
                    {t("newSession.addFolder", { host: props.host.name })}
                  </Button>
                )}
              </span>
            )
          }
        />
      </Form>
    </Page>
  );
}
