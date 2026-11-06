import { Check } from "lucide-react";
import { useSyncExternalStore } from "react";
import { Page, Section } from "@/components/layout/page";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import { type SetupStep, setupProgress, setupSteps } from "../lib/setup-steps.ts";

/** A list of steps: a check or its number in a circle, one sentence, one action. */
function StepList(props: {
  label: string;
  steps: SetupStep[];
  /** The step the person should do next, if it is in this list. */
  current: string | null;
  go: (route: Route) => void;
}) {
  const t = useT();
  return (
    <ol aria-label={props.label} className="flex flex-col gap-2">
      {props.steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.id === props.current ? "step" : undefined}
          className="flex items-start gap-3 rounded-lg border bg-card p-3 aria-[current=step]:border-ring"
        >
          <span
            aria-hidden="true"
            className={
              step.done
                ? "flex size-5 shrink-0 items-center justify-center rounded-full border border-foreground bg-foreground text-background"
                : "flex size-5 shrink-0 items-center justify-center rounded-full border text-muted-foreground text-xs"
            }
          >
            {step.done ? <Check className="size-3" /> : index + 1}
          </span>
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <p className="font-medium text-sm">
              {t(`setup.step.${step.id}.title` as Key)}
              <span className="sr-only">{`. ${step.done ? t("setup.done") : t("setup.todo")}`}</span>
            </p>
            <p className="text-muted-foreground text-xs">
              {t(`setup.step.${step.id}.text` as Key)}
            </p>
          </div>
          {step.done ? (
            <span className="shrink-0 text-muted-foreground text-xs">{t("setup.done")}</span>
          ) : (
            <Button
              size="sm"
              variant={step.id === props.current ? "default" : "outline"}
              className="shrink-0"
              onClick={() => props.go(step.route)}
            >
              {t(`setup.step.${step.id}.action` as Key)}
            </Button>
          )}
        </li>
      ))}
    </ol>
  );
}

/** The setup checklist: what is done and what is not, from the real state, each with its action. */
export function SetupPage(props: { store: AppStore; state: AppState; go: (route: Route) => void }) {
  const t = useT();
  const { store, state } = props;
  const notified = useSyncExternalStore(store.setup.subscribe, () => store.setup.notified);
  const steps = setupSteps({
    hosts: state.hosts,
    projects: state.projects,
    cards: state.cards,
    hub: state.hub,
    budgets: state.budgets,
    externals: state.externals,
    probes: state.setupProbes,
    notified,
  });
  const progress = setupProgress(steps);
  const core = steps.filter((step) => step.core);
  const optional = steps.filter((step) => !step.core);
  const current = core.find((step) => !step.done)?.id ?? null;
  return (
    <Page title={t("setup.title")} subtitle={t("setup.subtitle")}>
      <Section title={t("setup.core")}>
        <p className="text-muted-foreground text-sm" role="status">
          {progress.complete
            ? t("setup.allDone")
            : t("setup.ring", { done: progress.done, total: progress.total })}
        </p>
        <StepList label={t("setup.core")} steps={core} current={current} go={props.go} />
      </Section>
      {optional.length > 0 && (
        <Section title={t("setup.optional")}>
          <StepList label={t("setup.optional")} steps={optional} current={null} go={props.go} />
        </Section>
      )}
      <Button variant="ghost" className="self-start" onClick={() => store.setup.setHidden(true)}>
        {t("setup.hide")}
      </Button>
    </Page>
  );
}
