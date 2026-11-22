import type { TelemetryItem, TelemetryPrompt } from "@flightdeck/protocol";
import { useCallback, useEffect, useState } from "react";
import { formatMs } from "@/features/sessions/index.ts";
import { useT } from "@/i18n/context";
import {
  Bar,
  EmptyState,
  ErrorState,
  Inline,
  LoadingState,
  Panel,
  Stack,
} from "@/shared/layout/index.ts";
import { formatDuration } from "../../i18n/format.ts";
import type { AppStore } from "../../lib/app-store.ts";
import { usd } from "../costs/index.ts";
import { stepKeys } from "./domain/step-keys.ts";
import { label } from "./domain/tempo-label.ts";

type T = ReturnType<typeof useT>;

function Step(props: Readonly<{ item: TelemetryItem; longest: number; t: T }>) {
  const { item, longest, t } = props;
  const time = item.durationMs;
  const failedKey = item.error ? "telemetry.failed" : "telemetry.failedPlain";
  const failed =
    item.kind === "tool" && item.success === false
      ? t(failedKey, { error: item.error ?? "" })
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

function PromptBlock(props: Readonly<{ prompt: TelemetryPrompt; n: number; t: T }>) {
  const { prompt, n, t } = props;
  const longest = Math.max(0, ...prompt.items.map((i) => i.durationMs ?? 0));
  const summary = [
    formatDuration(prompt.endedAt - prompt.startedAt, t),
    ...(prompt.costUsd > 0 ? [usd(prompt.costUsd, t.lang)] : []),
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
        {stepKeys(prompt.items).map(({ key, item }) => (
          <Step key={key} item={item} longest={longest} t={t} />
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
export function TempoPanel(
  props: Readonly<{ store: AppStore; hostId: string; claudeSessionId: string }>,
) {
  const t = useT();
  const { store, hostId, claudeSessionId } = props;
  // `null` while loading, `"failed"` when the host did not answer: that is not "no data".
  const [prompts, setPrompts] = useState<TelemetryPrompt[] | "failed" | null>(null);

  const load = useCallback(() => {
    setPrompts(null);
    void store
      .hostCommand(hostId, "telemetry.session", { claudeSessionId })
      .then((result) => setPrompts(result ? result.prompts : "failed"));
  }, [store, hostId, claudeSessionId]);
  useEffect(load, [load]);

  if (prompts === null) return <LoadingState label={t("states.loading")} />;
  if (prompts === "failed") {
    return (
      <ErrorState
        message={t("telemetry.loadFailed")}
        retryLabel={t("telemetry.retry")}
        onRetry={load}
      />
    );
  }
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
