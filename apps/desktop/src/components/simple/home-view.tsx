import type { Template, TemplateField } from "@flightdeck/protocol";
import { FileText, FolderSearch, GitCompare, type LucideIcon, Sparkles } from "lucide-react";
import { useState } from "react";
import { ActionButton } from "@/components/feedback/action-button";
import { Field, FieldRow, NativeSelect } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { T } from "../../i18n/index.ts";
import type { TaskState } from "../../lib/simple-task.ts";

export interface HomeTask {
  sessionId: string;
  title: string;
  state: TaskState;
}

export interface HomeViewProps {
  templates: Template[];
  tasks: HomeTask[];
  t: T;
  /** Where the folder dialog is available, the field offers it (the desktop app on this machine). */
  canPickFolder: boolean;
  onPickFolder(): Promise<string | null>;
  /** Starts a task; resolves when it has started (the screen then moves to it). */
  onStart(templateId: string, values: Record<string, string>): Promise<void>;
  onOpenTask(sessionId: string): void;
}

const ICONS: Record<string, LucideIcon> = {
  "folder-search": FolderSearch,
  "file-text": FileText,
  "file-check": FileText,
  "git-compare": GitCompare,
};

/** What a template asks, as a form: one control per field, the start held until it is filled in. */
function TemplateForm(
  props: Readonly<{
    template: Template;
    t: T;
    canPickFolder: boolean;
    onPickFolder(): Promise<string | null>;
    onStart(values: Record<string, string>): Promise<void>;
    onClose(): void;
  }>,
) {
  const { template, t } = props;
  const lang = t.lang;
  const [values, setValues] = useState<Record<string, string>>({});
  const set = (id: string, value: string) => setValues((before) => ({ ...before, [id]: value }));
  const missing = template.fields.some((field) => !field.optional && !values[field.id]?.trim());

  const control = (field: TemplateField, id: string) => {
    if (field.kind === "choice") {
      return (
        <NativeSelect
          id={id}
          value={values[field.id] ?? ""}
          onChange={(e) => set(field.id, e.target.value)}
        >
          <option value="">{t("simple.home.pickOne")}</option>
          {field.choices?.map((choice) => (
            <option key={choice.id} value={choice.id}>
              {choice.label[lang]}
            </option>
          ))}
        </NativeSelect>
      );
    }
    return (
      <div className="field-row">
        <Input
          id={id}
          value={values[field.id] ?? ""}
          onChange={(e) => set(field.id, e.target.value)}
        />
        {field.kind === "folder" && props.canPickFolder && (
          <Button
            type="button"
            variant="outline"
            onClick={async () => {
              const picked = await props.onPickFolder();
              if (picked) set(field.id, picked);
            }}
          >
            {t("simple.home.chooseFolder")}
          </Button>
        )}
      </div>
    );
  };

  return (
    <form
      className="form-stack"
      onSubmit={(e) => {
        e.preventDefault();
      }}
    >
      {template.fields.map((field) => (
        <Field key={field.id} label={field.label[lang]}>
          {(c) => control(field, c.id)}
        </Field>
      ))}
      <FieldRow>
        <ActionButton
          disabled={missing}
          disabledReason={t("simple.home.needsAnswer")}
          onClick={async () => {
            const filled = Object.fromEntries(
              Object.entries(values).filter(([, value]) => value.trim() !== ""),
            );
            await props.onStart(filled);
            props.onClose();
          }}
        >
          {t("simple.home.start")}
        </ActionButton>
        <Button type="button" variant="ghost" onClick={props.onClose}>
          {t("simple.home.cancel")}
        </Button>
      </FieldRow>
    </form>
  );
}

/** The first place of simple mode: the templates, what waits for an answer, the recent tasks. */
export function HomeView(props: Readonly<HomeViewProps>) {
  const { t } = props;
  const [chosen, setChosen] = useState<Template | null>(null);
  const waiting = props.tasks.filter((task) => task.state === "waiting");

  const taskRow = (task: HomeTask) => (
    <li key={task.sessionId} className="home-task">
      <Button
        variant="ghost"
        aria-label={t("simple.home.open", { title: task.title })}
        onClick={() => props.onOpenTask(task.sessionId)}
      >
        {task.title}
      </Button>
      <span className="task-chip" data-state={task.state}>
        {t(`simple.state.${task.state}`)}
      </span>
    </li>
  );

  return (
    <div className="home-simple">
      <h1 className="task-title">{t("simple.home.title")}</h1>

      {waiting.length > 0 && (
        <section aria-label={t("simple.home.waiting")} className="home-waiting">
          <ul className="task-files">{waiting.map(taskRow)}</ul>
        </section>
      )}

      <section aria-label={t("simple.home.templates")}>
        {props.templates.length === 0 ? (
          <p className="question-card-note">{t("simple.home.noTemplates")}</p>
        ) : (
          <ul className="template-cards">
            {props.templates.map((template) => {
              const Icon = ICONS[template.icon] ?? Sparkles;
              return (
                <li key={template.id}>
                  <button
                    type="button"
                    className="template-card"
                    onClick={() => setChosen(template)}
                  >
                    <Icon aria-hidden="true" className="size-5 text-muted-foreground" />
                    <span className="template-card-title">{template.title[t.lang]}</span>
                    <span className="question-card-note">{template.description[t.lang]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-label={t("simple.home.recent")}>
        <h2 className="home-heading">{t("simple.home.recent")}</h2>
        {props.tasks.length === 0 ? (
          <p className="question-card-note">{t("simple.home.empty")}</p>
        ) : (
          <ul aria-label={t("simple.home.recent")} className="task-files">
            {props.tasks.map(taskRow)}
          </ul>
        )}
      </section>

      <Dialog open={chosen !== null} onOpenChange={(open) => !open && setChosen(null)}>
        <DialogContent>
          {chosen && (
            <>
              <DialogHeader>
                <DialogTitle>{chosen.title[t.lang]}</DialogTitle>
                <DialogDescription>{chosen.description[t.lang]}</DialogDescription>
              </DialogHeader>
              <TemplateForm
                template={chosen}
                t={t}
                canPickFolder={props.canPickFolder}
                onPickFolder={props.onPickFolder}
                onStart={(values) => props.onStart(chosen.id, values)}
                onClose={() => setChosen(null)}
              />
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
