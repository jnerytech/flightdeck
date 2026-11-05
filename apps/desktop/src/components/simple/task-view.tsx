import { type TaskFile, type TaskResultsResult, taskActivity } from "@flightdeck/protocol";
import { ArrowLeft, FileText, Loader2 } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { T } from "../../i18n/index.ts";
import type { SessionState } from "../../lib/session-state.ts";
import { lastSummary, pendingQuestion, recentTools, taskState } from "../../lib/simple-task.ts";
import { Markdown } from "../../ui/Markdown.tsx";
import { QuestionCard } from "./question-card.tsx";

export interface TaskViewHandlers {
  onBack(): void;
  onStop(): void;
  onAnswer(requestId: string, decision: "allow" | "deny", held?: boolean): void;
  onOpenFull(): void;
  onCopy(text: string): void;
  onOpenFile(path: string): void;
  onRevealFile(path: string): void;
  /** The start of a text file; null when there is none to show. */
  onPreview(path: string): Promise<{ text: string; truncated: boolean } | null>;
  onAskChanges(text: string): void;
  onTryAgain(): void;
  onShowDetails(): void;
}

const PREVIEWABLE = /\.(txt|md|markdown|csv)$/i;

/** A size as a person reads it: bytes, KB or MB. */
function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function FileRow(props: {
  file: TaskFile;
  t: T;
  canOpen: boolean;
  onOpen(): void;
  onReveal(): void;
}) {
  const { file, t } = props;
  return (
    <li className="task-file">
      <FileText aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
      <span className="task-file-name">{file.name}</span>
      <span className="task-file-tag">
        {t(file.change === "new" ? "simple.fileNew" : "simple.fileChanged")}
      </span>
      <span className="task-file-size">{sizeText(file.sizeBytes)}</span>
      {props.canOpen && (
        <>
          <Button
            size="sm"
            variant="outline"
            aria-label={t("simple.openFile", { name: file.name })}
            onClick={props.onOpen}
          >
            {t("simple.open")}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t("simple.showInFolder", { name: file.name })}
            onClick={props.onReveal}
          >
            {t("simple.showFolder")}
          </Button>
        </>
      )}
    </li>
  );
}

/** One task as simple mode shows it: header, what is happening, the question, the result. */
export function TaskView(
  props: {
    title: string;
    session: SessionState;
    results: TaskResultsResult | null;
    t: T;
    /** The host is locked to simple: no way to full mode. */
    locked: boolean;
    /** The platform can open files of the host. */
    canOpen: boolean;
  } & TaskViewHandlers,
) {
  const { t, session } = props;
  const state = taskState(session);
  const question = state === "waiting" ? pendingQuestion(session) : null;
  const [preview, setPreview] = useState<{
    file: TaskFile;
    text: string;
    truncated: boolean;
  } | null>(null);
  const [change, setChange] = useState("");
  const ended = state === "done" || state === "stopped" || state === "failed";

  const open = async (file: TaskFile) => {
    const shown = PREVIEWABLE.test(file.name) ? await props.onPreview(file.path) : null;
    if (shown) setPreview({ file, ...shown });
    else props.onOpenFile(file.path);
  };

  return (
    <article className="task-view">
      <header className="task-head">
        <Button variant="ghost" size="sm" onClick={() => props.onBack()}>
          <ArrowLeft aria-hidden="true" />
          {t("simple.back")}
        </Button>
        <h1 className="task-title">{props.title}</h1>
        <span data-slot="task-chip" data-state={state} className="task-chip">
          {t(`simple.state.${state}`)}
        </span>
        {(state === "working" || state === "waiting") && (
          <Button
            variant="outline"
            size="sm"
            aria-label={t("simple.stopLabel")}
            onClick={() => props.onStop()}
          >
            {t("simple.stop")}
          </Button>
        )}
      </header>

      {state === "working" && (
        <output aria-label={t("simple.activity")} className="task-activity">
          <Loader2 aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          {taskActivity(recentTools(session), t.lang, true).text}
        </output>
      )}

      {question && (
        <QuestionCard
          plain={question.plain}
          t={t}
          locked={props.locked}
          onAnswer={(decision, held) =>
            held
              ? props.onAnswer(question.requestId, decision, true)
              : props.onAnswer(question.requestId, decision)
          }
          onOpenFull={props.onOpenFull}
          onCopy={props.onCopy}
        />
      )}

      {state === "failed" && (
        <section className="task-failed">
          <p>{t("simple.failedText")}</p>
          <div className="question-card-actions">
            <Button onClick={() => props.onTryAgain()}>{t("simple.tryAgain")}</Button>
            {!props.locked && (
              <Button variant="outline" onClick={() => props.onShowDetails()}>
                {t("simple.details")}
              </Button>
            )}
          </div>
        </section>
      )}

      {state === "done" && (
        <>
          <section aria-label={t("simple.summary")} className="task-summary">
            <Markdown text={lastSummary(session)} />
          </section>
          <FilesBlock
            results={props.results}
            t={t}
            canOpen={props.canOpen}
            onOpen={(file) => void open(file)}
            onReveal={(file) => props.onRevealFile(file.path)}
          />
          {preview && (
            <section
              aria-label={t("simple.previewLabel", { name: preview.file.name })}
              className="task-preview"
            >
              <pre>{preview.text}</pre>
              {preview.truncated && <p className="question-card-note">{t("simple.previewCut")}</p>}
              <div className="question-card-actions">
                <Button
                  size="sm"
                  aria-label={t("simple.openFile", { name: preview.file.name })}
                  onClick={() => props.onOpenFile(preview.file.path)}
                >
                  {t("simple.open")}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setPreview(null)}>
                  {t("simple.closePreview")}
                </Button>
              </div>
            </section>
          )}
          <form
            className="task-ask"
            onSubmit={(e) => {
              e.preventDefault();
              const text = change.trim();
              if (!text) return;
              props.onAskChanges(text);
              setChange("");
            }}
          >
            <Textarea
              aria-label={t("simple.askChanges")}
              placeholder={t("simple.askPlaceholder")}
              rows={2}
              value={change}
              onChange={(e) => setChange(e.target.value)}
            />
            <Button type="submit" disabled={change.trim() === ""}>
              {t("simple.askSend")}
            </Button>
          </form>
          {!props.locked && (
            <Button variant="link" className="task-details" onClick={() => props.onShowDetails()}>
              {t("simple.details")}
            </Button>
          )}
        </>
      )}
      {ended && state === "stopped" && !props.locked && (
        <Button variant="link" className="task-details" onClick={() => props.onShowDetails()}>
          {t("simple.details")}
        </Button>
      )}
    </article>
  );
}

function FilesBlock(props: {
  results: TaskResultsResult | null;
  t: T;
  canOpen: boolean;
  onOpen(file: TaskFile): void;
  onReveal(file: TaskFile): void;
}) {
  const { t, results } = props;
  if (!results) return null;
  if (results.files.length === 0)
    return <p className="question-card-note">{t("simple.noFiles")}</p>;
  return (
    <section aria-label={t("simple.files")}>
      <ul aria-label={t("simple.files")} className="task-files">
        {results.files.map((file) => (
          <FileRow
            key={file.path}
            file={file}
            t={t}
            canOpen={props.canOpen}
            onOpen={() => props.onOpen(file)}
            onReveal={() => props.onReveal(file)}
          />
        ))}
      </ul>
    </section>
  );
}
