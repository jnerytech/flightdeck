import type { MemoryFile, MemorySuggestion } from "@flightdeck/protocol";
import { Plus } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { EmptyState, LoadingState } from "@/components/layout/states";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { AppStore } from "../lib/app-store.ts";
import { ConfirmDialog } from "./ConfirmDialog.tsx";

/** The file being edited; `hash` is `null` for one that does not exist yet. */
interface Opened {
  name: string;
  hash: string | null;
  /** The text as last read or saved, to tell what changed. */
  saved: string;
}

const NEW_NAME = /^[A-Za-z0-9][A-Za-z0-9 _-]{0,90}$/;

/**
 * Phase 26: the auto memory Claude Code keeps for the project. Read and edited only on an explicit
 * action, each write behind a confirmation and the hash of what was opened; the cleanup
 * suggestions only point, they never change a file.
 */
export function AgentMemory(props: { store: AppStore; hostId: string; projectId: string }) {
  const { store, hostId, projectId } = props;
  const { t } = store.i18n;
  const [files, setFiles] = useState<MemoryFile[] | null>(null);
  const [exists, setExists] = useState(true);
  const [suggestions, setSuggestions] = useState<MemorySuggestion[] | null>(null);
  const [opened, setOpened] = useState<Opened | null>(null);
  const [text, setText] = useState("");
  const [stale, setStale] = useState<{ content: string; hash: string } | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  const [creating, setCreating] = useState(false);
  const [typed, setTyped] = useState("");
  const [confirming, setConfirming] = useState<"save" | { remove: MemoryFile } | null>(null);

  const load = useCallback(async () => {
    const listed = await store.hostCommand(hostId, "memory.list", { projectId });
    if (listed) {
      setFiles(listed.files);
      setExists(listed.exists);
    } else setFiles([]);
    const suggested = await store.hostCommand(hostId, "memory.suggest", { projectId });
    setSuggestions(suggested?.suggestions ?? []);
  }, [store, hostId, projectId]);

  useEffect(() => {
    void load();
  }, [load]);

  const show = (file: Opened, content: string) => {
    setOpened(file);
    setText(content);
    setStale(null);
    setJustSaved(false);
  };

  const open = async (name: string) => {
    const read = await store.hostCommand(hostId, "memory.read", { projectId, name });
    if (read) show({ name, hash: read.hash, saved: read.content }, read.content);
  };

  const create = () => {
    if (!NEW_NAME.test(typed.trim())) return;
    show({ name: `${typed.trim()}.md`, hash: null, saved: "" }, "");
    setCreating(false);
    setTyped("");
  };

  const save = async () => {
    setConfirming(null);
    if (!opened) return;
    const written = await store.hostCommand(hostId, "memory.write", {
      projectId,
      name: opened.name,
      content: text,
      expectedHash: opened.hash,
      confirm: true,
    });
    if (written) {
      setOpened({ ...opened, hash: written.hash, saved: text });
      setJustSaved(true);
      await load();
      return;
    }
    // Refused: when the file changed on disk, say so and keep what the user wrote.
    const now = await store.hostCommand(hostId, "memory.read", { projectId, name: opened.name });
    if (now && now.hash !== opened.hash) setStale({ content: now.content, hash: now.hash });
  };

  const remove = async (file: MemoryFile) => {
    setConfirming(null);
    const done = await store.hostCommand(hostId, "memory.delete", {
      projectId,
      name: file.name,
      expectedHash: file.hash,
      confirm: true,
    });
    if (done) {
      if (opened?.name === file.name) setOpened(null);
      await load();
    }
  };

  if (files === null) return <LoadingState label={t("agent.loading")} />;
  const dirty = opened ? opened.hash === null || text !== opened.saved : false;
  const label = (suggestion: MemorySuggestion) => t(`memoryUi.suggestion.${suggestion.kind}`);

  return (
    <div className="grid gap-4 md:grid-cols-[18rem_minmax(0,1fr)]">
      <div className="flex flex-col gap-3">
        <div>
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus aria-hidden="true" />
            {t("memoryUi.new")}
          </Button>
        </div>
        {creating && (
          <div className="flex flex-col gap-2 rounded-lg border p-3">
            <Input
              aria-label={t("memoryUi.fileName")}
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
            />
            <Button size="sm" disabled={!NEW_NAME.test(typed.trim())} onClick={create}>
              {t("memoryUi.create")}
            </Button>
          </div>
        )}
        {(!exists || files.length === 0) && <EmptyState title={t("memoryUi.empty")} />}
        <ul aria-label={t("memoryUi.list")} className="flex flex-col gap-1">
          {files.map((file) => (
            <li
              key={file.name}
              className={cn(
                "flex items-start gap-1 rounded-md border px-3 py-2 text-sm",
                opened?.name === file.name && "bg-accent",
              )}
            >
              <button
                type="button"
                aria-label={t("memoryUi.open", { name: file.name })}
                onClick={() => void open(file.name)}
                className="flex min-w-0 flex-1 flex-col items-start gap-1 text-left"
              >
                <span data-name className="break-all font-medium">
                  {file.name}
                </span>
                <span className="flex flex-wrap gap-1">
                  {file.type && <Badge variant="secondary">{file.type}</Badge>}
                  {!file.inIndex && <Badge variant="outline">{t("memoryUi.outOfIndex")}</Badge>}
                </span>
              </button>
              {file.name !== "MEMORY.md" && (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={t("memoryUi.delete", { name: file.name })}
                  onClick={() => setConfirming({ remove: file })}
                >
                  {t("memoryUi.deleteShort")}
                </Button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex min-w-0 flex-col gap-4">
        {!opened && <p className="text-muted-foreground text-sm">{t("memoryUi.pick")}</p>}
        {opened && (
          <div className="flex flex-col gap-3">
            <code className="break-all text-sm">{opened.name}</code>
            {stale && (
              <InlineNotice>
                {t("memoryUi.stale")}{" "}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    show({ ...opened, hash: stale.hash, saved: stale.content }, stale.content)
                  }
                >
                  {t("memoryUi.reload")}
                </Button>
              </InlineNotice>
            )}
            <Textarea
              aria-label={t("memoryUi.content", { name: opened.name })}
              rows={14}
              className="font-mono text-sm"
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <div className="flex items-center gap-3">
              <Button disabled={!dirty} onClick={() => setConfirming("save")}>
                {t("memoryUi.save")}
              </Button>
              {justSaved && !dirty && (
                <span role="status" className="text-muted-foreground text-sm">
                  {t("memoryUi.saved")}
                </span>
              )}
            </div>
          </div>
        )}
        <section
          aria-label={t("memoryUi.suggestions")}
          className="flex flex-col gap-2 rounded-lg border p-3"
        >
          <h3 className="font-medium text-sm">{t("memoryUi.suggestions")}</h3>
          {suggestions?.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("memoryUi.noSuggestions")}</p>
          )}
          <ul className="flex flex-col gap-1 text-sm">
            {(suggestions ?? []).map((suggestion) => (
              <li key={`${suggestion.kind}/${suggestion.files.join(",")}`}>
                {label(suggestion)}:{" "}
                {suggestion.files.map((name, i) => (
                  <span key={name}>
                    {i > 0 && ", "}
                    <button
                      type="button"
                      aria-label={t("memoryUi.view", { name })}
                      className="underline"
                      onClick={() => void open(name)}
                    >
                      {name}
                    </button>
                  </span>
                ))}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">{t("memoryUi.neverAlone")}</p>
        </section>
      </div>

      {confirming === "save" && opened && (
        <ConfirmDialog
          message={t("memoryUi.saveMessage", { name: opened.name })}
          confirmLabel={t("memoryUi.saveConfirm")}
          onConfirm={() => void save()}
          onCancel={() => setConfirming(null)}
        />
      )}
      {confirming && confirming !== "save" && (
        <ConfirmDialog
          message={t("memoryUi.deleteMessage", { name: confirming.remove.name })}
          confirmLabel={t("memoryUi.deleteConfirm")}
          destructive
          onConfirm={() => void remove(confirming.remove)}
          onCancel={() => setConfirming(null)}
        />
      )}
    </div>
  );
}
