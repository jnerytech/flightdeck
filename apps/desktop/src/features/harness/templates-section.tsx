import type { HarnessTemplateInfo } from "@flightdeck/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { ConfirmDialog } from "@/shared/feedback/index.ts";
import { Inline, ListRow, Panel, Stack } from "@/shared/layout/index.ts";
import { formatBytes } from "../../i18n/format.ts";
import type { AppStore } from "../../lib/app-store.ts";

/**
 * The host's Claude Code setup templates (`harness.templates.*`, #75): the ones shared from a
 * project, each with a way to delete it. Deleting asks first, and sends the id with `confirm`.
 */
export function HarnessTemplatesSection(props: Readonly<{ store: AppStore; hostId: string }>) {
  const t = useT();
  const { store, hostId } = props;
  const [templates, setTemplates] = useState<HarnessTemplateInfo[] | null>(null);
  const [deleting, setDeleting] = useState<HarnessTemplateInfo | null>(null);
  const [failed, setFailed] = useState(false);
  // The Delete button that opened the dialog: a cancel gives the focus back to it.
  const opener = useRef<HTMLElement | null>(null);
  const cancelled = useRef(false);
  // Where the focus goes once a delete's refresh is in: its row's neighbours, in the order to try.
  const rows = useRef(new Map<string, HTMLElement>());
  const emptyNote = useRef<HTMLParagraphElement>(null);
  const failureNote = useRef<HTMLParagraphElement>(null);
  const [refocus, setRefocus] = useState<{ round: number; order: string[] }>({
    round: 0,
    order: [],
  });
  const refresh = useCallback(async () => {
    const next = await store.hostCommand(hostId, "harness.templates.list", {});
    setFailed(next === null);
    if (next) setTemplates(next.templates);
  }, [store, hostId]);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  // After the dialog is gone: its own focus return has nothing to go back to (no trigger).
  useEffect(() => {
    if (deleting !== null || !cancelled.current) return;
    cancelled.current = false;
    const id = setTimeout(() => opener.current?.focus(), 0);
    return () => clearTimeout(id);
  }, [deleting]);

  // The Delete button that opened the dialog is gone (or kept, after a refusal) once the list is in:
  // the focus goes to the next row, the previous one, the empty note or the failure, never the page.
  useEffect(() => {
    if (refocus.round === 0) return;
    // Only a focus the delete left on the page is taken: a person who moved on keeps theirs.
    const now = document.activeElement;
    if (now !== null && now !== document.body) return;
    const row = refocus.order.map((id) => rows.current.get(id)).find((el) => el !== undefined);
    (row ?? emptyNote.current ?? failureNote.current)?.focus();
  }, [refocus]);

  const remove = async (template: HarnessTemplateInfo) => {
    setDeleting(null);
    const ids = (templates ?? []).map((item) => item.id);
    const at = ids.indexOf(template.id);
    // Not retried from the banner: a delete repeated later, unseen, would run without a question.
    const done = await store.hostCommand(
      hostId,
      "harness.templates.delete",
      { id: template.id, confirm: true },
      { retry: false },
    );
    await refresh();
    // A refused delete keeps its row: that row first. A done one: the rows after it, then before it.
    const around = [...ids.slice(at + 1), ...ids.slice(0, at).reverse()];
    const order = done ? around : [template.id, ...around];
    setRefocus((now) => ({ round: now.round + 1, order }));
    if (done) store.success(t("harnessTemplates.deleted", { title: template.title }));
  };
  const facts = (template: HarnessTemplateInfo) =>
    t("harnessTemplates.facts", {
      files:
        template.files.length === 1
          ? t("harnessTemplates.filesOne")
          : t("harnessTemplates.filesMany", { n: String(template.files.length) }),
      size: formatBytes(template.bytes, store.i18n.lang),
    });
  return (
    <>
      <Panel title={t("harnessTemplates.title")} label={t("harnessTemplates.title")}>
        <p className="text-muted-foreground text-sm">{t("harnessTemplates.hint")}</p>
        {templates === null && !failed && (
          <p role="status" className="text-muted-foreground text-sm">
            {t("harnessTemplates.asking")}
          </p>
        )}
        {failed && (
          <Inline>
            <p role="alert" ref={failureNote} tabIndex={-1} className="text-sm">
              {t("harnessTemplates.loadFailed")}
            </p>
            <Button variant="outline" size="sm" onClick={() => void refresh()}>
              {t("harnessTemplates.retry")}
            </Button>
          </Inline>
        )}
        {!failed && templates?.length === 0 && (
          <p ref={emptyNote} tabIndex={-1} className="text-sm">
            {t("harnessTemplates.none")}
          </p>
        )}
        {!failed && templates && templates.length > 0 && (
          <Stack as="ul" gap={2}>
            {templates.map((template) => (
              <li key={template.id}>
                <ListRow
                  boxed
                  title={template.title}
                  meta={facts(template)}
                  trailing={
                    <Button
                      variant="outline"
                      size="sm"
                      ref={(el) => {
                        if (el) rows.current.set(template.id, el);
                        else rows.current.delete(template.id);
                      }}
                      aria-label={t("harnessTemplates.deleteLabel", { title: template.title })}
                      onClick={(event) => {
                        opener.current = event.currentTarget;
                        setDeleting(template);
                      }}
                    >
                      {t("harnessTemplates.delete")}
                    </Button>
                  }
                />
              </li>
            ))}
          </Stack>
        )}
      </Panel>
      {deleting && (
        <ConfirmDialog
          message={t("harnessTemplates.confirmMessage", { title: deleting.title })}
          warning={t("harnessTemplates.confirmWarning")}
          confirmLabel={t("harnessTemplates.confirmButton")}
          destructive
          onConfirm={() => void remove(deleting)}
          onCancel={() => {
            cancelled.current = true;
            setDeleting(null);
          }}
        />
      )}
    </>
  );
}
