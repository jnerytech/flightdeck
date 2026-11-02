import type { TelemetrySummary } from "@flightdeck/protocol";
import { useEffect, useState } from "react";
import { useT } from "@/i18n/context";
import { Panel } from "../components/layout/panel.tsx";
import { Stack } from "../components/layout/stack.tsx";
import { formatDuration } from "../i18n/format.ts";
import type { AppStore } from "../lib/app-store.ts";
import { projectLabel } from "../lib/costs.ts";
import { formatMs } from "../lib/timing.ts";

/**
 * In Custos: per project, the time people kept Claude waiting for a permission and the slowest
 * tools, from the telemetry of terminal sessions (`telemetry.summary`). Nothing while there is none.
 */
export function TimingBreakdown(props: {
  store: AppStore;
  hostId: string;
  /** How a project is named on screen; the Costs screen's set, so a project reads the same. */
  label?: (projectKey: string) => string;
}) {
  const t = useT();
  const { store, hostId } = props;
  const [summary, setSummary] = useState<TelemetrySummary | null>(null);

  useEffect(() => {
    void store.hostCommand(hostId, "telemetry.summary", {}).then(setSummary);
  }, [store, hostId]);

  if (!summary || summary.projects.length === 0) return null;
  return (
    <section aria-label={t("telemetry.costsTitle")}>
      <Panel title={t("telemetry.costsTitle")}>
        <Stack as="ul" gap={3}>
          {summary.projects.map((project) => (
            <li key={project.projectKey}>
              <Stack gap={1}>
                <h4 className="font-medium text-sm">{projectLabel(project.projectKey)}</h4>
                {project.waitMs > 0 && (
                  <p className="text-muted-foreground text-xs">
                    {t("telemetry.waited", { wait: formatDuration(project.waitMs, t) })}
                  </p>
                )}
                <Stack as="ul" gap={1}>
                  {project.slowest.map((tool) => (
                    <li key={tool.toolName} className="text-sm">
                      {t("telemetry.slowTool", {
                        tool: tool.toolName,
                        avg: formatMs(tool.avgMs, t),
                        max: formatMs(tool.maxMs, t),
                        calls: t("telemetry.calls", { n: tool.calls }),
                      })}
                    </li>
                  ))}
                </Stack>
              </Stack>
            </li>
          ))}
        </Stack>
      </Panel>
    </section>
  );
}
