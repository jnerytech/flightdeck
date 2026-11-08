import type { WorkflowTemplate } from "@flightdeck/protocol";
import { FilePlus2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { AppDialogContent } from "@/components/feedback/dialog-content";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { Inline, Stack } from "@/components/layout/stack";
import { LoadingState } from "@/components/layout/states";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useT } from "@/i18n/context";
import type { AppStore } from "../../lib/app-store.ts";

/**
 * Issue #79: "Add from a template" on the Workflows screen. A template is a file: the host lists
 * them (the check line already holds the project's test command when it is known) and the person
 * copies one and commits it to the base branch. The host writes nothing, and trust stays on the
 * page behind this dialog.
 */
export function WorkflowTemplates(
  props: Readonly<{ store: AppStore; hostId: string; projectId: string }>,
) {
  const t = useT();
  const { store, hostId, projectId } = props;
  /** Null until the host answers. */
  const [templates, setTemplates] = useState<WorkflowTemplate[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [shownId, setShownId] = useState<string | null>(null);
  /** What the last copy did: nothing yet (or one is on its way), it worked, or the clipboard refused. */
  const [copied, setCopied] = useState<"worked" | "refused" | null>(null);
  /** The template whose button takes the focus back when the list is shown again. */
  const [restore, setRestore] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const shown = templates?.find((template) => template.id === shownId) ?? null;

  useEffect(() => {
    if (shown) heading.current?.focus();
  }, [shown]);
  useEffect(() => {
    if (shown || restore === null) return;
    list.current?.querySelector<HTMLElement>(`[data-template="${restore}"]`)?.focus();
    setRestore(null);
  }, [shown, restore]);

  const load = async () => {
    const result = await store.hostCommand(hostId, "workflow.templates", { projectId });
    setFailed(result === null);
    setTemplates(result?.templates ?? null);
  };
  const onOpenChange = (open: boolean) => {
    if (!open) return;
    setTemplates(null);
    setFailed(false);
    setShownId(null);
    setCopied(null);
    void load();
  };
  const show = (template: WorkflowTemplate) => {
    setCopied(null);
    setShownId(template.id);
  };
  const back = () => {
    setRestore(shownId);
    setShownId(null);
  };
  const copy = async (template: WorkflowTemplate) => {
    // Emptied first, so a second copy that works is announced again, not left as the same text.
    setCopied(null);
    setCopied((await store.copyText(template.yaml)) ? "worked" : "refused");
  };

  return (
    <Dialog onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline">
          <FilePlus2 aria-hidden="true" />
          {t("workflowsUi.templates.open")}
        </Button>
      </DialogTrigger>
      <AppDialogContent>
        <DialogHeader>
          <DialogTitle>{t("workflowsUi.templates.title")}</DialogTitle>
          <DialogDescription>{t("workflowsUi.templates.intro")}</DialogDescription>
        </DialogHeader>
        {failed && <InlineNotice tone="error">{t("workflowsUi.templates.failed")}</InlineNotice>}
        {!failed && templates === null && (
          <LoadingState label={t("workflowsUi.templates.loading")} />
        )}
        {templates?.length === 0 && (
          <InlineNotice tone="info">{t("workflowsUi.templates.none")}</InlineNotice>
        )}
        {templates && templates.length > 0 && !shown && (
          <div ref={list}>
            <Stack as="ul" label={t("workflowsUi.templates.list")} gap={3}>
              <ListedTemplates templates={templates} onShow={show} />
            </Stack>
          </div>
        )}
        {shown && (
          <TemplateFile
            template={shown}
            copied={copied}
            headingRef={heading}
            onCopy={() => void copy(shown)}
            onBack={back}
          />
        )}
      </AppDialogContent>
    </Dialog>
  );
}

/** One row per template: what it is and a button that opens its file. */
function ListedTemplates(
  props: Readonly<{
    templates: readonly WorkflowTemplate[];
    onShow(template: WorkflowTemplate): void;
  }>,
) {
  const t = useT();
  return props.templates.map((template) => (
    <li key={template.id} className="rounded-lg border p-3 text-sm">
      <Stack gap={2}>
        <strong>{template.title[t.lang]}</strong>
        <span>{template.description[t.lang]}</span>
        <Button
          variant="outline"
          size="sm"
          className="self-start"
          data-template={template.id}
          onClick={() => props.onShow(template)}
        >
          {t("workflowsUi.templates.show", { name: template.title[t.lang] })}
        </Button>
      </Stack>
    </li>
  ));
}

/** A template opened: its limits, where to commit it, the file itself and how to copy it. */
function TemplateFile(
  props: Readonly<{
    template: WorkflowTemplate;
    copied: "worked" | "refused" | null;
    headingRef: React.RefObject<HTMLHeadingElement | null>;
    onCopy(): void;
    onBack(): void;
  }>,
) {
  const t = useT();
  const { template } = props;
  return (
    <Stack gap={3}>
      <h3 ref={props.headingRef} tabIndex={-1} className="font-semibold text-base outline-none">
        {template.title[t.lang]}
      </h3>
      <p className="text-sm">{template.description[t.lang]}</p>
      <p className="text-muted-foreground text-sm">{template.limits[t.lang]}</p>
      <p className="text-sm">{t("workflowsUi.templates.persona", { persona: template.persona })}</p>
      <p className="text-sm">
        {t("workflowsUi.templates.inputs", { inputs: template.inputs.join(", ") })}
      </p>
      {template.checkFilled === true && (
        <InlineNotice tone="info">{t("workflowsUi.templates.checkFilled")}</InlineNotice>
      )}
      {template.checkFilled === false && (
        <InlineNotice tone="warn">{t("workflowsUi.templates.checkPlaceholder")}</InlineNotice>
      )}
      <p className="text-sm">{t("workflowsUi.templates.path", { path: template.path })}</p>
      <section
        aria-label={t("workflowsUi.templates.file", { path: template.path })}
        // The file can be longer than the dialog: it scrolls, and a keyboard can reach it.
        // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take the focus
        tabIndex={0} // NOSONAR: a region that scrolls must take focus, or the keyboard cannot scroll it (axe scrollable-region-focusable)
        className="max-h-80 overflow-auto rounded-md bg-muted p-3"
      >
        <pre className="font-mono text-xs">{template.yaml}</pre>
      </section>
      <Inline gap={2}>
        <Button onClick={props.onCopy}>{t("workflowsUi.templates.copy")}</Button>
        <Button variant="outline" onClick={props.onBack}>
          {t("workflowsUi.templates.back")}
        </Button>
      </Inline>
      {props.copied === "refused" && (
        <InlineNotice tone="error">{t("workflowsUi.templates.copyFailed")}</InlineNotice>
      )}
      {/* Always in the page: a live region inserted with its text is often not read. */}
      <div // NOSONAR: holds flow content (paragraphs, a list or placeholders), which <output> may not
        data-slot="copy-status"
        role="status"
      >
        {props.copied === "worked" && (
          <p className="rounded-md border px-3 py-2 text-muted-foreground text-sm">
            {t("workflowsUi.templates.copied")}
          </p>
        )}
      </div>
    </Stack>
  );
}
