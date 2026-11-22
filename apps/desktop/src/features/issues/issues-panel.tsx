import type { Card, Issue, IssuesConfig, Project } from "@flightdeck/protocol";
import { ExternalLink, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { refusalText } from "@/i18n/errors";
import { ActionButton, InlineNotice } from "@/shared/feedback/index.ts";
import { useMinLoading } from "@/shared/hooks/index.ts";
import { EmptyState, ErrorState, LoadingState, NativeSelect } from "@/shared/layout/index.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { filterIssues, issueLabel, issueNumber } from "./domain/issues.ts";

/** The external-author seal: third-party content, so no automatic approval on the card. */
export function ExternalSeal({ t }: Readonly<{ t: AppStore["i18n"]["t"] }>) {
  return (
    <Badge variant="outline" className="text-status-needs-you" title={t("issuesUi.externalHint")}>
      {t("issuesUi.external")}
    </Badge>
  );
}

function ConfigForm(
  props: Readonly<{
    store: AppStore;
    current: IssuesConfig | null;
    /** The refusal of the last save, shown here with the person's values still in the form. */
    error: string | null;
    onSave(config: IssuesConfig): Promise<void>;
  }>,
) {
  const { t } = props.store.i18n;
  const [provider, setProvider] = useState<IssuesConfig["provider"]>(
    props.current?.provider ?? "github",
  );
  const [query, setQuery] = useState(props.current?.query ?? "");
  const [commentOnPr, setCommentOnPr] = useState(props.current?.commentOnPr ?? false);
  const save = () => {
    const text = query.trim();
    return props.onSave({ provider, ...(text ? { query: text } : {}), commentOnPr });
  };
  return (
    <div className="flex flex-col gap-3">
      {!props.current && <p className="text-sm">{t("issuesUi.connect")}</p>}
      <NativeSelect
        aria-label={t("issuesUi.provider")}
        value={provider}
        onChange={(e) => setProvider(e.target.value as IssuesConfig["provider"])}
      >
        <option value="github">{t("issuesUi.github")}</option>
        <option value="azure">{t("issuesUi.azure")}</option>
      </NativeSelect>
      <Input
        aria-label={t("issuesUi.query")}
        placeholder={t("issuesUi.queryHint")}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="flex items-center justify-between gap-3">
        <span className="flex flex-col text-sm">
          {t("issuesUi.commentOnPr")}
          <span className="text-muted-foreground text-xs">{t("issuesUi.commentOnPrHint")}</span>
        </span>
        <Switch
          aria-label={t("issuesUi.commentOnPr")}
          checked={commentOnPr}
          onCheckedChange={setCommentOnPr}
        />
      </div>
      {props.error && <InlineNotice tone="error">{props.error}</InlineNotice>}
      <div>
        <ActionButton onClick={save}>
          {t(props.current ? "issuesUi.save" : "issuesUi.connectButton")}
        </ActionButton>
      </div>
    </div>
  );
}

function IssueRow(
  props: Readonly<{
    store: AppStore;
    issue: Issue;
    card: Card | null;
    onCreate(): void;
    onOpenCard(cardId: string): void;
  }>,
) {
  const { store, issue, card } = props;
  const { t } = store.i18n;
  return (
    <li
      aria-label={t("issuesUi.row", { number: issueNumber(issue.ref), title: issue.title })}
      className="flex flex-col gap-2 rounded-md border bg-card p-3 text-sm"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 flex-col">
          <strong className="font-medium">{issue.title}</strong>
          <span className="flex gap-1 text-muted-foreground text-xs">
            <span>{issueNumber(issue.ref)}</span>
            <span aria-hidden="true">·</span>
            <span>{issue.author}</span>
          </span>
        </span>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 shrink-0"
          aria-label={t("issuesUi.openIssue", { issue: issueLabel(issue.ref) })}
          onClick={() => store.openLink(issue.url)}
        >
          <ExternalLink aria-hidden="true" />
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {issue.external && <ExternalSeal t={t} />}
        {issue.labels.map((label) => (
          <Badge key={label} variant="secondary">
            {label}
          </Badge>
        ))}
      </div>
      <div className="flex items-center gap-2">
        {card ? (
          <>
            <span className="text-muted-foreground text-xs">{t("issuesUi.cardCreated")}</span>
            <Button variant="outline" size="sm" onClick={() => props.onOpenCard(card.id)}>
              {t("issuesUi.openCard")}
            </Button>
          </>
        ) : (
          <Button variant="outline" size="sm" onClick={props.onCreate}>
            {t("issuesUi.createCard")}
          </Button>
        )}
      </div>
    </li>
  );
}

/**
 * The project's issues beside its board: filter, make a card from one, and the provider's
 * connection (GitHub or Azure Boards). An issue by an outside author comes marked.
 */
export function IssuesPanel(
  props: Readonly<{
    store: AppStore;
    hostId: string;
    project: Project;
    /** The project's cards: an issue that already has one offers Abrir card. */
    cards: Card[];
    onClose(): void;
    onProject(project: Project): void;
    onOpenCard(cardId: string): void;
  }>,
) {
  const { store, hostId, project } = props;
  const { t } = store.i18n;
  const [issues, setIssues] = useState<Issue[] | null>(null);
  /** Why the list could not be had, in the person's language; null while it can. */
  const [failure, setFailure] = useState<string | null>(null);
  /** Why the last save was refused: the form stays open with it. */
  const [saveError, setSaveError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [configuring, setConfiguring] = useState(false);
  /** A save just closed the form: the focus goes back to the button that opened it. */
  const [refocus, setRefocus] = useState(false);
  const configure = useRef<HTMLButtonElement>(null);
  /** The latest list request: an older answer, such as the previous project's, is dropped. */
  const latest = useRef(0);
  const configured = project.issues !== null;
  const loading = useMinLoading(configured && issues === null && failure === null);

  const load = useCallback(async () => {
    const mine = ++latest.current;
    setFailure(null);
    const result = await store.hostRequest(hostId, "issues.list", { projectId: project.id });
    if (mine !== latest.current) return;
    if (result.ok) {
      setFailure(null);
      setIssues(result.data.issues);
    } else {
      // A failed list is shown alone: the old one would pass for the current one.
      setIssues(null);
      setFailure(
        t("issuesUi.failed", { why: refusalText(result.code, result.message, t, result) }),
      );
    }
  }, [store, hostId, project.id, t]);
  useEffect(() => {
    setIssues(null);
    setFailure(null);
    if (configured) void load();
  }, [configured, load]);
  useEffect(() => {
    if (!refocus || !configure.current) return;
    configure.current.focus();
    setRefocus(false);
  }, [refocus]);

  const save = async (config: IssuesConfig) => {
    setSaveError(null);
    const result = await store.hostRequest(hostId, "project.update", {
      projectId: project.id,
      issues: config,
    });
    if (!result.ok) {
      setSaveError(refusalText(result.code, result.message, t, result));
      return;
    }
    props.onProject(result.data);
    setConfiguring(false);
    setRefocus(true);
    setIssues(null);
    // A project that was not connected loads in the effect above, as its `configured` turns on.
    if (configured) void load();
  };
  const create = (issue: Issue) =>
    void store.hostCommand(hostId, "issues.createCard", {
      projectId: project.id,
      issueRef: issue.ref,
    });

  const shown = filterIssues(issues ?? [], filter);
  const provider = project.issues?.provider === "azure" ? "azure" : "github";
  const sourceKey = provider === "azure" ? "issuesUi.fromAzure" : "issuesUi.fromGithub";
  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-[28rem] max-w-full">
        <SheetHeader>
          <SheetTitle>{t("issuesUi.title")}</SheetTitle>
          <SheetDescription>{configured ? t(sourceKey) : ""}</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <div className="flex items-center gap-2">
            {configured && (
              <>
                <ActionButton variant="outline" size="sm" onClick={load}>
                  <RefreshCw aria-hidden="true" />
                  {t("issuesUi.reload")}
                </ActionButton>
                <Button
                  ref={configure}
                  variant="ghost"
                  size="sm"
                  aria-expanded={configuring}
                  onClick={() => {
                    setSaveError(null);
                    setConfiguring(!configuring);
                  }}
                >
                  <Settings aria-hidden="true" />
                  {t("issuesUi.configure")}
                </Button>
              </>
            )}
            <SheetClose asChild>
              <Button variant="ghost" size="sm" className="ml-auto">
                {t("toast.close")}
              </Button>
            </SheetClose>
          </div>
          {(!configured || configuring) && (
            <ConfigForm store={store} current={project.issues} error={saveError} onSave={save} />
          )}
          {configured && !configuring && (
            <>
              <Input
                aria-label={t("issuesUi.filter")}
                placeholder={t("issuesUi.filterPlaceholder")}
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
              />
              {loading && <LoadingState label={t("issuesUi.loading")} />}
              {failure && (
                <ErrorState
                  message={failure}
                  retryLabel={t("issuesUi.retry")}
                  onRetry={() => void load()}
                />
              )}
              {issues && shown.length === 0 && <EmptyState title={t("issuesUi.none")} />}
              {issues && shown.some((issue) => issue.external) && (
                <InlineNotice>{t("issuesUi.externalHint")}</InlineNotice>
              )}
              <ul className="flex flex-col gap-2">
                {shown.map((issue) => (
                  <IssueRow
                    key={issue.ref}
                    store={store}
                    issue={issue}
                    card={props.cards.find((c) => c.issueRef === issue.ref) ?? null}
                    onCreate={() => create(issue)}
                    onOpenCard={props.onOpenCard}
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
