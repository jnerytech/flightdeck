import type { AgentCfgItem } from "@flightdeck/protocol";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AppStore } from "../lib/app-store.ts";
import { getField, parseDocument, serialize, setField } from "../lib/frontmatter.ts";
import { Markdown } from "./Markdown.tsx";

type Kind = AgentCfgItem["kind"];
type Origin = AgentCfgItem["origin"];

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

/**
 * One kind of file of the agent: the project's CLAUDE.md, agents or skills (editable, with a hash
 * check) and the user's (read-only). An agent or a skill has a form for its frontmatter.
 */
export function AgentFiles(props: {
  store: AppStore;
  hostId: string;
  projectId: string;
  kind: Kind;
}) {
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

  const load = useCallback(async () => {
    setFailed(false);
    const result = await store.hostCommand(hostId, "agentcfg.list", { projectId, kind });
    if (result) setItems(result.items);
    else setFailed(true);
  }, [store, hostId, projectId, kind]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (file: Opened, content: string) => {
    setOpened(file);
    setText(content);
    setPreview(false);
    setStale(null);
    setJustSaved(false);
  };

  const open = async (item: AgentCfgItem) => {
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

  const create = () => {
    const path = newPath(kind, typed);
    if (!path) return;
    show(
      { path, origin: "project", readOnly: false, hash: null, saved: "" },
      template(kind, typed),
    );
    setCreating(false);
    setTyped("");
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
    show({ ...opened, hash: stale.hash, saved: stale.content }, stale.content);
  };

  const originLabel = (origin: Origin) =>
    origin === "project" ? t("agent.originProject") : t("agent.originUser");

  if (failed) {
    return (
      <ErrorState message={t("agent.loadFailed")} retryLabel={t("agent.retry")} onRetry={load} />
    );
  }
  if (items === null) return <LoadingState label={t("agent.loading")} />;

  const labels = {
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

  const doc = parseDocument(text);
  const form = kind !== "claudemd";
  const complex = (key: string) => doc.entries.some((e) => e.key === key && e.complex);
  const edit = (key: string) => ({
    value: getField(doc, key) ?? "",
    readOnly: opened?.readOnly ?? false,
    disabled: complex(key),
    onChange: (e: { target: { value: string } }) =>
      setText(serialize(setField(doc, key, e.target.value))),
  });
  const present = (key: string) => complex(key) || (getField(doc, key) ?? "").trim() !== "";
  const valid = !form || (present("name") && present("description"));
  const dirty = opened ? opened.hash === null || text !== opened.saved : false;
  const versioned =
    opened?.origin === "project" &&
    (opened.path === "CLAUDE.local.md" ? t("agent.localFile") : t("agent.versioned"));

  return (
    <div className="grid gap-4 @3xl:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {labels.add}
          </Button>
        </div>
        {creating && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Input
              aria-label={labels.field}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <Button size="sm" disabled={newPath(kind, typed) === null} onClick={create}>
              {t("agent.files.create")}
            </Button>
          </div>
        )}
        {items.length === 0 && <EmptyState title={labels.empty} />}
        <ul aria-label={t("agent.files.list")} className="flex flex-col gap-1">
          {items.map((item) => {
            const name = item.name ?? item.path;
            const current = opened?.path === item.path && opened.origin === item.origin;
            return (
              <li key={`${item.origin}/${item.path}`}>
                <button
                  type="button"
                  aria-current={current ? "true" : undefined}
                  aria-label={t("agent.files.open", { name, origin: originLabel(item.origin) })}
                  onClick={() => void open(item)}
                  className={cn(
                    "flex w-full flex-col items-start gap-1 rounded-md border px-3 py-2 text-left text-sm hover:bg-accent",
                    current && "bg-accent",
                  )}
                >
                  <span className="font-medium">{name}</span>
                  {item.path !== name && (
                    <span className="break-all text-muted-foreground text-xs">{item.path}</span>
                  )}
                  <span className="flex flex-wrap gap-1">
                    <Badge variant="secondary">{originLabel(item.origin)}</Badge>
                    {item.readOnly && <Badge variant="outline">{t("agent.readOnly")}</Badge>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col gap-3">
        {!opened && <p className="text-muted-foreground text-sm">{t("agent.files.pick")}</p>}
        {opened && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <code className="break-all text-sm">{opened.path}</code>
              <Badge variant="secondary">{originLabel(opened.origin)}</Badge>
              {opened.readOnly && <Badge variant="outline">{t("agent.readOnly")}</Badge>}
              <span className="flex-1" />
              <Button variant="ghost" size="sm" onClick={() => setPreview((on) => !on)}>
                {preview ? t("agent.files.edit") : t("agent.files.preview")}
              </Button>
            </div>
            {versioned && <InlineNotice>{versioned}</InlineNotice>}
            {stale && (
              <InlineNotice>
                {t("agent.files.stale")}{" "}
                <Button variant="outline" size="sm" onClick={reload}>
                  {t("agent.files.reload")}
                </Button>
              </InlineNotice>
            )}
            {form && (
              <div className="grid gap-2 @2xl:grid-cols-2">
                <Input aria-label={t("agent.files.name")} {...edit("name")} />
                <Input aria-label={t("agent.files.description")} {...edit("description")} />
                {kind === "agent" && (
                  <>
                    <Input aria-label={t("agent.files.tools")} {...edit("tools")} />
                    <Input aria-label={t("agent.files.model")} {...edit("model")} />
                  </>
                )}
              </div>
            )}
            {form && (complex("name") || complex("description")) && (
              <p className="text-muted-foreground text-xs">{t("agent.files.multiline")}</p>
            )}
            {preview ? (
              <Markdown text={form ? doc.body : text} />
            ) : (
              <Textarea
                aria-label={
                  form ? t("agent.files.body") : t("agent.files.content", { path: opened.path })
                }
                readOnly={opened.readOnly}
                rows={16}
                className="font-mono text-sm"
                value={form ? doc.body : text}
                onChange={(e) =>
                  setText(form ? serialize({ ...doc, body: e.target.value }) : e.target.value)
                }
              />
            )}
            {!valid && <InlineNotice tone="error">{t("agent.files.needFields")}</InlineNotice>}
            {!opened.readOnly && (
              <div className="flex items-center gap-3">
                <Button disabled={!valid || !dirty} onClick={() => void save()}>
                  {t("agent.files.save")}
                </Button>
                {justSaved && !dirty && (
                  <span role="status" className="text-muted-foreground text-sm">
                    {t("agent.files.saved")}
                  </span>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
