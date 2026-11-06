import { Check } from "lucide-react";
import { useEffect, useSyncExternalStore } from "react";
import { Page, Section } from "@/components/layout/page";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import type { Key } from "../i18n/index.ts";
import type { AppState, AppStore } from "../lib/app-store.ts";
import type { Route } from "../lib/router.ts";
import { type SetupStep, setupProgress, setupSteps } from "../lib/setup-steps.ts";

/** A list of steps: a check or its number in a circle, one sentence, one action. */
function StepList(
  props: Readonly<{
    label: string;
    steps: SetupStep[];
    /** The step the person should do next, if it is in this list. */
    current: string | null;
    go: (route: Route) => void;
  }>,
) {
  const t = useT();
  return (
    <Stack as="ol" gap={2} label={props.label}>
      {props.steps.map((step, index) => (
        <li
          key={step.id}
          aria-current={step.id === props.current ? "step" : undefined}
          className="setup-step aria-[current=step]:border-ring"
        >
          <span
            aria-hidden="true"
            className={step.done ? "setup-mark setup-mark-done" : "setup-mark setup-mark-todo"}
          >
            {step.done ? <Check className="size-3" /> : index + 1}
          </span>
          <div className="setup-step-text">
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
    </Stack>
  );
}

/** The setup checklist: what is done and what is not, from the real state, each with its action. */
export function SetupPage(
  props: Readonly<{
    store: AppStore;
    /** The parts of the state the checklist reads. */
    state: Pick<
      AppState,
      "hosts" | "projects" | "cards" | "hub" | "budgets" | "externals" | "setupProbes"
    >;
    go: (route: Route) => void;
  }>,
) {
  const t = useT();
  const { store, state } = props;
  const notified = useSyncExternalStore(store.setup.subscribe, () => store.setup.notified);
  // GitHub runs `gh auth status` on the host: it is asked about when the person opens this screen.
  const onlineIds = state.hosts
    .filter((host) => host.status === "online")
    .map((host) => host.id)
    .join(",");
  useEffect(() => {
    for (const id of onlineIds === "" ? [] : onlineIds.split(",")) {
      void store.refreshSetup(id, { github: true });
    }
  }, [store, onlineIds]);
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
