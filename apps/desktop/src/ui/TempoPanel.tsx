import type { TelemetryItem, TelemetryPrompt } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import { Bar } from "../components/layout/bar.tsx";
import { Panel } from "../components/layout/panel.tsx";
import { Inline, Stack } from "../components/layout/stack.tsx";
import { EmptyState, LoadingState } from "../components/layout/states.tsx";
import { formatDuration } from "../i18n/format.ts";
import type { AppStore } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import { formatMs } from "../lib/timing.ts";

type T = ReturnType<typeof useT>;

/** Who answered a permission, in words. */
function by(source: string | null, t: T): string {
  if (source === "config") return t("telemetry.byConfig");
  if (source === "hook") return t("telemetry.byHook");
  if (source?.startsWith("user_")) return t("telemetry.byYou");
  return t("telemetry.byOther");
}

/** What a step says, without its time. */
function label(item: TelemetryItem, t: T): string {
  switch (item.kind) {
    case "tool":
      return item.toolName ?? "";
    case "permission":
      return t("telemetry.permission", {
        tool: item.toolName ?? "",
        decision: t(item.decision === "reject" ? "telemetry.denied" : "telemetry.allowed"),
        by: by(item.source, t),
      }).trim();
    case "api":
      return t("telemetry.api");
    case "error":
      return item.error
        ? t("telemetry.apiError", { status: item.error })
        : t("telemetry.apiErrorPlain");
  }
}

function Step(props: { item: TelemetryItem; longest: number; t: T }) {
  const { item, longest, t } = props;
  const time = item.durationMs;
  const failed =
    item.kind === "tool" && item.success === false
      ? t(item.error ? "telemetry.failed" : "telemetry.failedPlain", { error: item.error ?? "" })
      : null;
  const text = [label(item, t), time === null ? null : formatMs(time, t), failed]
    .filter((part) => part !== null)
    .join(" · ");
  return (
    <li>
      <Stack gap={1}>
        <span className="text-sm">{text}</span>
        {time !== null && longest > 0 && <Bar ratio={time / longest} />}
      </Stack>
    </li>
  );
}

function PromptBlock(props: { prompt: TelemetryPrompt; n: number; t: T }) {
  const { prompt, n, t } = props;
  const longest = Math.max(0, ...prompt.items.map((i) => i.durationMs ?? 0));
  const summary = [
    formatDuration(prompt.endedAt - prompt.startedAt, t),
    ...(prompt.costUsd > 0 ? [usd(prompt.costUsd)] : []),
    ...(prompt.waitMs > 0
      ? [t("telemetry.waited", { wait: formatDuration(prompt.waitMs, t) })]
      : []),
  ].join(" · ");
  return (
    <Panel
      as="li"
      size="sm"
      title={t("telemetry.prompt", { n })}
      label={t("telemetry.prompt", { n })}
    >
      <p className="text-muted-foreground text-xs">{summary}</p>
      <Stack as="ul" gap={2}>
        {prompt.items.map((item) => (
          <Step
            key={`${item.at}-${item.kind}-${item.toolName ?? ""}`}
            item={item}
            longest={longest}
            t={t}
          />
        ))}
      </Stack>
    </Panel>
  );
}

/**
 * The Tempo tab: each prompt of a terminal session with its tools, the permissions a person
 * answered (and how long they kept Claude waiting), the API requests and their errors, from
 * Claude Code's OTLP telemetry (`telemetry.session`).
 */
export function TempoPanel(props: { store: AppStore; hostId: string; claudeSessionId: string }) {
  const t = useT();
  const { store, hostId, claudeSessionId } = props;
  const [prompts, setPrompts] = useState<TelemetryPrompt[] | null>(null);

  useEffect(() => {
    void store
      .hostCommand(hostId, "telemetry.session", { claudeSessionId })
      .then((result) => setPrompts(result?.prompts ?? []));
  }, [store, hostId, claudeSessionId]);

  if (prompts === null) return <LoadingState label={t("states.loading")} />;
  return (
    <section aria-label={t("telemetry.region")}>
      <Stack gap={3}>
        {prompts.length === 0 ? (
          <EmptyState title={t("telemetry.empty")} />
        ) : (
          <Stack as="ul" gap={3}>
            {prompts.map((prompt, i) => (
              <PromptBlock
                key={prompt.promptId ?? `none-${prompt.startedAt}`}
                prompt={prompt}
                n={i + 1}
                t={t}
              />
            ))}
          </Stack>
        )}
        <Inline>
          <p className="text-muted-foreground text-xs">{t("telemetry.note")}</p>
        </Inline>
      </Stack>
    </section>
  );
}
