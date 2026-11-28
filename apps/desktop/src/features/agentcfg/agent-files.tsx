import type { AgentCfgItem } from "@flightdeck/protocol";
import { ChevronRight, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { ActionButton, ConfirmDialog, InlineNotice } from "@/shared/feedback/index.ts";
import {
  EmptyState,
  ErrorState,
  Field,
  Form,
  FormActions,
  LoadingState,
} from "@/shared/layout/index.ts";
import { Markdown } from "@/shared/markdown/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { inReadingOrder, shownPath, titleOf } from "./domain/file-list.ts";
import { getField, parseDocument, serialize, setField } from "./domain/frontmatter.ts";

type Kind = AgentCfgItem["kind"];
type Origin = AgentCfgItem["origin"];
/** A one-line or a multi-line field of the frontmatter form. */
type TextField = HTMLInputElement | HTMLTextAreaElement;

/** The file being edited; `hash` is `null` for one that does not exist yet. */
interface Opened {
  path: string;
  origin: Origin;
  readOnly: boolean;
  hash: string | null;
  /** The text as last read or saved, to tell what changed. */
  saved: string;
}

const NEW_NAME = /^[A-Za-z0-9][\w.-]*$/;
const NEW_CLAUDEMD = /^(?:[^/\\]+\/)*CLAUDE\.md$|^CLAUDE\.local\.md$/;

/** The path a new file takes, or null while what was typed cannot be one. */
function newPath(kind: Kind, typed: string): string | null {
  const value = typed.trim();
  if (kind === "claudemd") return NEW_CLAUDEMD.test(value) ? value : null;
  if (!NEW_NAME.test(value)) return null;
  return kind === "agent" ? `.claude/agents/${value}.md` : `.claude/skills/${value}/SKILL.md`;
}

/** What a new file starts with: an agent or a skill needs its name; CLAUDE.md a first line. */
const template = (kind: Kind, typed: string) =>
  kind === "claudemd" ? "# CLAUDE.md\n" : `---\nname: ${typed.trim()}\n---\n`;

/** One file of the list: its name, its path when that differs, and where it comes from. */
function FileRow(
  props: Readonly<{
    item: AgentCfgItem;
    current: boolean;
    originLabel: string;
    t: AppStore["i18n"]["t"];
    onOpen(): void;
  }>,
) {
  const { item, current, t } = props;
  const name = titleOf(item);
  return (
    <li>
      <button
        type="button"
        aria-current={current ? "true" : undefined}
        aria-label={t("agent.files.open", { name, origin: props.originLabel })}
        onClick={props.onOpen}
        className={cn(
          "flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent",
          current && "bg-accent",
        )}
      >
        <span className="flex items-center gap-1">
          {current && (
            <span data-row-leading className="shrink-0">
              <ChevronRight aria-hidden="true" className="size-4" />
            </span>
          )}
          <span className="font-medium [overflow-wrap:anywhere]">{name}</span>
        </span>
        {item.name && item.name !== shownPath(item) && (
          <span className="break-all text-muted-foreground text-xs">{shownPath(item)}</span>
        )}
        <span className="flex flex-wrap gap-1">
          <Badge variant="secondary">{props.originLabel}</Badge>
          {item.readOnly && <Badge variant="outline">{t("agent.readOnly")}</Badge>}
        </span>
      </button>
    </li>
  );
}

/** The open file's path and origin, and the button that flips between editing and previewing. */
function FileHeader(
  props: Readonly<{
    opened: Opened;
    originLabel: string;
    preview: boolean;
    t: AppStore["i18n"]["t"];
    onTogglePreview(): void;
  }>,
) {
  const { opened, preview, t } = props;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <code className="break-all text-sm">{shownPath(opened)}</code>
      <Badge variant="secondary">{props.originLabel}</Badge>
      {opened.readOnly && <Badge variant="outline">{t("agent.readOnly")}</Badge>}
      <span className="flex-1" />
      <Button variant="ghost" size="sm" onClick={props.onTogglePreview}>
        {preview ? t("agent.files.edit") : t("agent.files.preview")}
      </Button>
    </div>
  );
}

type T = AppStore["i18n"]["t"];

/** The words of one kind of file: its empty list, its add button and the label of its name field. */
function kindLabels(kind: Kind, t: T) {
  return {
    claudemd: {
      empty: t("agent.files.emptyClaudemd"),
      add: t("agent.files.newClaudemd"),
      field: t("agent.files.pathLabel"),
    },
    agent: {
      empty: t("agent.files.emptyAgent"),
      add: t("agent.files.newAgent"),
      field: t("agent.files.agentName"),
    },
    skill: {
      empty: t("agent.files.emptySkill"),
      add: t("agent.files.newSkill"),
      field: t("agent.files.skillName"),
    },
  }[kind];
}

/** The small form that asks for the name or path of a new file. */
function NewFileForm(
  props: Readonly<{
    kind: Kind;
    labels: ReturnType<typeof kindLabels>;
    typed: string;
    t: T;
    onTyped(typed: string): void;
    onSubmit(): void;
    onCancel(): void;
  }>,
) {
  const { kind, labels, typed, t } = props;
  /** What was typed is not empty and cannot be a path: the rule turns into an error. */
  const refused = typed.trim() !== "" && newPath(kind, typed) === null;
  return (
    <div className="rounded-lg border p-3">
      <Form variant="inline" onSubmit={props.onSubmit}>
        <Field
          label={labels.field}
          help={t(`agent.files.rule.${kind}`)}
          error={refused ? t(`agent.files.refused.${kind}`) : undefined}
        >
          {(control) => (
            <Input
              {...control}
              autoFocus
              value={typed}
              onChange={(e) => props.onTyped(e.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Escape") return;
                // The form closes alone: a screen around it must not also close on this key.
                event.stopPropagation();
                props.onCancel();
              }}
            />
          )}
        </Field>
        <FormActions
          submit={t("agent.files.create")}
          disabled={newPath(kind, typed) === null}
          cancel={t("common.cancel")}
          onCancel={props.onCancel}
        />
      </Form>
    </div>
  );
}

type FieldProps = {
  value: string;
  readOnly: boolean;
  disabled: boolean;
  onChange: (e: { target: { value: string } }) => void;
};

/** The frontmatter of an agent or a skill as fields: its name and description, and an agent's tools and model. */
function FrontmatterFields(
  props: Readonly<{
    kind: Kind;
    edit: (key: string) => FieldProps;
    takeFirst: (el: TextField | null) => void;
    t: T;
  }>,
) {
  const { kind, edit, takeFirst, t } = props;
  return (
    <div className="grid gap-2 @2xl:grid-cols-2">
      <Field label={t("agent.files.name")}>
        {(control) => <Input {...control} {...edit("name")} ref={takeFirst} />}
      </Field>
      <Field label={t("agent.files.description")}>
        {(control) => <Input {...control} {...edit("description")} />}
      </Field>
      {kind === "agent" && (
        <>
          <Field label={t("agent.files.tools")}>
            {(control) => <Input {...control} {...edit("tools")} />}
          </Field>
          <Field label={t("agent.files.model")}>
            {(control) => <Input {...control} {...edit("model")} />}
          </Field>
        </>
      )}
    </div>
  );
}

/** The save button, with why it waits, and the note beside it: unsaved changes, or that the file was saved. */
function SaveBar(
  props: Readonly<{
    disabled: boolean;
    nothingChanged: boolean;
    note: string | null;
    t: T;
    onSave(): Promise<void>;
  }>,
) {
  const { t } = props;
  return (
    <div className="flex items-center gap-3">
      <ActionButton
        disabled={props.disabled}
        disabledReason={props.nothingChanged ? t("agent.files.nothingChanged") : undefined}
        onClick={props.onSave}
      >
        {t("agent.files.save")}
      </ActionButton>
      {/* Mounted before its text comes: a live region inserted with its text is often not read. */}
      <output className="text-muted-foreground text-sm">{props.note}</output>
    </div>
  );
}

/** What the editor reads from a file's text: its parts, which fields it cannot edit, and whether it may be saved. */
function editorOf(text: string, form: boolean, readOnly: boolean, onText: (text: string) => void) {
  const doc = parseDocument(text);
  const complex = (key: string) => doc.entries.some((e) => e.key === key && e.complex);
  const edit = (key: string): FieldProps => ({
    value: getField(doc, key) ?? "",
    readOnly,
    disabled: complex(key),
    onChange: (e) => onText(serialize(setField(doc, key, e.target.value))),
  });
  const present = (key: string) => complex(key) || (getField(doc, key) ?? "").trim() !== "";
  return { doc, complex, edit, valid: !form || (present("name") && present("description")) };
}

/** The text of the open file: previewed as Markdown, or edited (the body only, when a form holds the frontmatter). */
function FileBody(
  props: Readonly<{
    opened: Opened;
    text: string;
    doc: ReturnType<typeof parseDocument>;
    form: boolean;
    preview: boolean;
    takeFirst: (el: TextField | null) => void;
    t: T;
    onText(text: string): void;
  }>,
) {
  const { opened, text, doc, form, t } = props;
  if (props.preview) return <Markdown text={form ? doc.body : text} />;
  return (
    <Textarea
      ref={form ? undefined : props.takeFirst}
      aria-label={form ? t("agent.files.body") : t("agent.files.content", { path: opened.path })}
      readOnly={opened.readOnly}
      rows={16}
      className="font-mono text-sm"
      value={form ? doc.body : text}
      onChange={(e) =>
        props.onText(form ? serialize({ ...doc, body: e.target.value }) : e.target.value)
      }
    />
  );
}

/** The open file: its header, the frontmatter form of an agent or a skill, the text and the save button. */
function FileEditor(
  props: Readonly<{
    kind: Kind;
    opened: Opened;
    originLabel: string;
    text: string;
    preview: boolean;
    stale: { content: string; hash: string } | null;
    dirty: boolean;
    justSaved: boolean;
    takeFirst: (el: TextField | null) => void;
    t: T;
    onText(text: string): void;
    onTogglePreview(): void;
    onReload(): void;
    onSave(): Promise<void>;
  }>,
) {
  const { kind, opened, text, preview, stale, dirty, justSaved, takeFirst, t } = props;
  const form = kind !== "claudemd";
  let note: string | null = null;
  if (text !== opened.saved) note = t("agent.files.unsaved");
  else if (justSaved && !dirty) note = t("agent.files.saved");
  const { doc, complex, edit, valid } = editorOf(text, form, opened.readOnly, props.onText);
  const versioned =
    opened.origin === "project" &&
    (opened.path === "CLAUDE.local.md" ? t("agent.localFile") : t("agent.versioned"));
  return (
    <>
      <FileHeader
        opened={opened}
        originLabel={props.originLabel}
        preview={preview}
        t={t}
        onTogglePreview={props.onTogglePreview}
      />
      {opened.hash === null && (
        <p className="text-muted-foreground text-sm">{t("agent.files.newFile")}</p>
      )}
      {versioned && <InlineNotice>{versioned}</InlineNotice>}
      {stale && (
        <InlineNotice>
          {t("agent.files.stale")}{" "}
          <Button variant="outline" size="sm" onClick={props.onReload}>
            {t("agent.files.reload")}
          </Button>
        </InlineNotice>
      )}
      {form && <FrontmatterFields kind={kind} edit={edit} takeFirst={takeFirst} t={t} />}
      {form && (complex("name") || complex("description")) && (
        <p className="text-muted-foreground text-xs">{t("agent.files.multiline")}</p>
      )}
      <FileBody
        opened={opened}
        text={text}
        doc={doc}
        form={form}
        preview={preview}
        takeFirst={takeFirst}
        t={t}
        onText={props.onText}
      />
      {!valid && <InlineNotice tone="error">{t("agent.files.needFields")}</InlineNotice>}
      {!opened.readOnly && (
        <SaveBar
          disabled={!valid || !dirty}
          nothingChanged={valid && !justSaved}
          note={note}
          t={t}
          onSave={props.onSave}
        />
      )}
    </>
  );
}

/**
 * One kind of file of the agent: the project's CLAUDE.md, agents or skills (editable, with a hash
 * check) and the user's (read-only). An agent or a skill has a form for its frontmatter.
 */
export function AgentFiles(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    projectId: string;
    kind: Kind;
  }>,
) {
  const { store, hostId, projectId, kind } = props;
  const { t } = store.i18n;
  const [items, setItems] = useState<AgentCfgItem[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [stale, setStale] = useState<{ content: string; hash: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [typed, setTyped] = useState("");
  /** The editor's first field, and a count of the files shown: each one moves the focus there, a save does not (#4080, #4266). */
  const firstField = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const takeFirst = useCallback((el: HTMLInputElement | HTMLTextAreaElement | null) => {
    firstField.current = el;
  }, []);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (shown > 0) firstField.current?.focus();
  }, [shown]);
  const newButton = useRef<HTMLButtonElement>(null);
  /** What waits for the person to say the edits of the open file may go (#4078). */
  const [discarding, setDiscarding] = useState<(() => void) | null>(null);

  const load = useCallback(async () => {
    setFailed(false);
    const result = await store.hostCommand(hostId, "agentcfg.list", { projectId, kind });
    if (result) setItems(result.items);
    else setFailed(true);
  }, [store, hostId, projectId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = opened ? opened.hash === null || text !== opened.saved : false;

  /** Something that replaces the open file asks first when it holds edits that were not saved. */
  const replacing = (action: () => void) => {
    if (dirty) setDiscarding(() => action);
    else action();
  };

  const show = (file: Opened, content: string) => {
    setShown((n) => n + 1);
    setOpened(file);
    setText(content);
    setPreview(false);
    setStale(null);
    setJustSaved(false);
  };

  const read = async (item: AgentCfgItem) => {
    const result = await store.hostCommand(hostId, "agentcfg.read", {
      projectId,
      kind,
      path: item.path,
      origin: item.origin,
    });
    if (result) {
      show(
        {
          path: item.path,
          origin: item.origin,
          readOnly: item.readOnly,
          hash: result.hash,
          saved: result.content,
        },
        result.content,
      );
    }
  };

  const open = (item: AgentCfgItem) => replacing(() => void read(item));

  const create = () => {
    const path = newPath(kind, typed);
    if (!path) return;
    replacing(() => {
      show(
        { path, origin: "project", readOnly: false, hash: null, saved: "" },
        template(kind, typed),
      );
      setCreating(false);
      setTyped("");
    });
  };

  const cancelCreate = () => {
    setCreating(false);
    setTyped("");
    newButton.current?.focus();
  };

  const save = async () => {
    if (!opened) return;
    const common = { projectId, kind, path: opened.path, origin: opened.origin };
    const result = await store.hostCommand(hostId, "agentcfg.write", {
      ...common,
      content: text,
      expectedHash: opened.hash,
      confirm: true,
    });
    if (result) {
      setOpened({ ...opened, hash: result.hash, saved: text });
      setJustSaved(true);
      await load();
      return;
    }
    // Refused: when the file changed on disk, say so and keep what the user wrote.
    const now = await store.hostCommand(hostId, "agentcfg.read", common);
    if (now && now.hash !== opened.hash) setStale({ content: now.content, hash: now.hash });
  };

  const reload = () => {
    if (!opened || !stale) return;
    replacing(() => show({ ...opened, hash: stale.hash, saved: stale.content }, stale.content));
  };

  const originLabel = (origin: Origin) =>
    origin === "project" ? t("agent.originProject") : t("agent.originUser");

  if (failed) {
    return (
      <ErrorState message={t("agent.loadFailed")} retryLabel={t("agent.retry")} onRetry={load} />
    );
  }
  if (items === null) return <LoadingState label={t("agent.loading")} />;

  const labels = kindLabels(kind, t);

  return (
    <div className="grid gap-4 @3xl:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div>
          <Button ref={newButton} variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {labels.add}
          </Button>
        </div>
        {creating && (
          <NewFileForm
            kind={kind}
            labels={labels}
            typed={typed}
            t={t}
            onTyped={setTyped}
            onSubmit={create}
            onCancel={cancelCreate}
          />
        )}
        {items.length === 0 ? (
          <EmptyState title={labels.empty} />
        ) : (
          <ul aria-label={t("agent.files.list")} className="flex flex-col gap-1">
            {inReadingOrder(items).map((item) => (
              <FileRow
                key={`${item.origin}/${item.path}`}
                item={item}
                current={opened?.path === item.path && opened.origin === item.origin}
                originLabel={originLabel(item.origin)}
                t={t}
                onOpen={() => open(item)}
              />
            ))}
          </ul>
        )}
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {opened ? (
          <FileEditor
            kind={kind}
            opened={opened}
            originLabel={originLabel(opened.origin)}
            text={text}
            preview={preview}
            stale={stale}
            dirty={dirty}
            justSaved={justSaved}
            takeFirst={takeFirst}
            t={t}
            onText={setText}
            onTogglePreview={() => setPreview((on) => !on)}
            onReload={reload}
            onSave={save}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("agent.files.pick")}</p>
        )}
      </div>
      {discarding && opened && (
        <ConfirmDialog
          message={t("agent.files.discardMessage", { name: shownPath(opened) })}
          confirmLabel={t("agent.files.discardConfirm")}
          destructive
          onConfirm={() => {
            const action = discarding;
            setDiscarding(null);
            action();
          }}
          onCancel={() => setDiscarding(null)}
        />
      )}
    </div>
  );
}
