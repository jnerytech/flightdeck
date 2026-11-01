import type { Card, Issue, IssuesConfig, Project } from "@flightdeck/protocol";
import { ExternalLink, RefreshCw, Settings } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { InlineNotice } from "@/components/feedback/inline-notice";
import { NativeSelect } from "@/components/layout/form";
import { EmptyState, ErrorState, LoadingState } from "@/components/layout/states";
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
import { useMinLoading } from "@/hooks/use-min-loading";
import type { AppStore } from "../lib/app-store.ts";
import { filterIssues, issueLabel, issueNumber } from "../lib/issues.ts";

/** The external-author seal: third-party content, so no automatic approval on the card. */
export function ExternalSeal({ t }: { t: AppStore["i18n"]["t"] }) {
  return (
    <Badge variant="outline" className="text-status-needs-you" title={t("issuesUi.externalHint")}>
      {t("issuesUi.external")}
    </Badge>
  );
}

function ConfigForm(props: {
  store: AppStore;
  current: IssuesConfig | null;
  onSave(config: IssuesConfig): void;
}) {
  const { t } = props.store.i18n;
  const [provider, setProvider] = useState<IssuesConfig["provider"]>(
    props.current?.provider ?? "github",
  );
  const [query, setQuery] = useState(props.current?.query ?? "");
  const [commentOnPr, setCommentOnPr] = useState(props.current?.commentOnPr ?? false);
  const save = () => {
    const text = query.trim();
    props.onSave({ provider, ...(text ? { query: text } : {}), commentOnPr });
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
      <div>
        <Button onClick={save}>
          {t(props.current ? "issuesUi.save" : "issuesUi.connectButton")}
        </Button>
      </div>
    </div>
  );
}

function IssueRow(props: {
  store: AppStore;
  issue: Issue;
  card: Card | null;
  onCreate(): void;
  onOpenCard(cardId: string): void;
}) {
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
export function IssuesPanel(props: {
  store: AppStore;
  hostId: string;
  project: Project;
  /** The project's cards: an issue that already has one offers Abrir card. */
  cards: Card[];
  onClose(): void;
  onProject(project: Project): void;
  onOpenCard(cardId: string): void;
}) {
  const { store, hostId, project } = props;
  const { t } = store.i18n;
  const [issues, setIssues] = useState<Issue[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState("");
  const [configuring, setConfiguring] = useState(false);
  const configured = project.issues !== null;
  const loading = useMinLoading(configured && issues === null && !failed);

  const load = useCallback(async () => {
    setFailed(false);
    const result = await store.hostCommand(hostId, "issues.list", { projectId: project.id });
    if (result) setIssues(result.issues);
    else setFailed(true);
  }, [store, hostId, project.id]);
  useEffect(() => {
    if (configured) void load();
  }, [configured, load]);

  const save = async (config: IssuesConfig) => {
    const updated = await store.hostCommand(hostId, "project.update", {
      projectId: project.id,
      issues: config,
    });
    if (!updated) return;
    props.onProject(updated);
    setConfiguring(false);
    setIssues(null);
  };
  const create = (issue: Issue) =>
    void store.hostCommand(hostId, "issues.createCard", {
      projectId: project.id,
      issueRef: issue.ref,
    });

  const shown = filterIssues(issues ?? [], filter);
  const provider = project.issues?.provider === "azure" ? "azure" : "github";
  return (
    <Sheet open onOpenChange={(open) => !open && props.onClose()}>
      <SheetContent side="right" showCloseButton={false} className="w-[28rem] max-w-full">
        <SheetHeader>
          <SheetTitle>{t("issuesUi.title")}</SheetTitle>
          <SheetDescription>
            {configured
              ? t(provider === "azure" ? "issuesUi.fromAzure" : "issuesUi.fromGithub")
              : ""}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-4 pb-4">
          <div className="flex items-center gap-2">
            {configured && (
              <>
                <Button variant="outline" size="sm" onClick={() => void load()}>
                  <RefreshCw aria-hidden="true" />
                  {t("issuesUi.reload")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfiguring(!configuring)}>
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
            <ConfigForm store={store} current={project.issues} onSave={(c) => void save(c)} />
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
              {failed && (
                <ErrorState
                  message={t("issuesUi.failed")}
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
