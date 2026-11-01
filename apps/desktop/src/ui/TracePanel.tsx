import type { SessionTrace, TraceNode } from "@flightdeck/protocol";
import { useEffect, useMemo, useState } from "react";
import { NativeSelect } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { Bar } from "../components/layout/bar.tsx";
import { Panel } from "../components/layout/panel.tsx";
import { Inline, Stack } from "../components/layout/stack.tsx";
import { EmptyState, LoadingState } from "../components/layout/states.tsx";
import { TreeBranch, TreeItem } from "../components/layout/tree.tsx";
import { formatDuration } from "../i18n/format.ts";
import type { AppStore } from "../lib/app-store.ts";
import { usd } from "../lib/costs.ts";
import { formatMs } from "../lib/timing.ts";
import { longest, onlyTool, toolNames } from "../lib/trace.ts";
import { TraceReplay } from "./TraceReplay.tsx";

type T = ReturnType<typeof useT>;

/** What a node says of itself, in one line. */
export function nodeTitle(node: TraceNode, t: T): string {
  if (node.kind === "turn") {
    return `${t("trace.turn", { n: node.n ?? 0 })}${node.label ? ` · ${node.label}` : ""}`;
  }
  if (node.kind === "thinking") return t("trace.thinking");
  return node.label ? `${node.name} · ${node.label}` : node.name;
}

/** The numbers of a node: time, cost and tokens, those it has. */
export function nodeNumbers(node: TraceNode, t: T): string {
  const tokens = node.inputTokens + node.outputTokens;
  return [
    node.durationMs === null ? null : formatMs(node.durationMs, t),
    node.costUsd === null ? null : usd(node.costUsd),
    tokens === 0 ? null : t("trace.tokens", { input: node.inputTokens, output: node.outputTokens }),
    node.error ? t("trace.failed") : null,
  ]
    .filter((part) => part !== null)
    .join(" · ");
}

function Node(props: { node: TraceNode; against: number; trace: SessionTrace; t: T }) {
  const { node, against, trace, t } = props;
  const numbers = nodeNumbers(node, t);
  const detail = node.kind === "turn" ? null : (node.input ?? node.result);
  return (
    <TreeItem id={node.id}>
      <Inline gap={2}>
        <span className="font-medium text-sm">{nodeTitle(node, t)}</span>
        {numbers && <span className="text-muted-foreground text-xs">{numbers}</span>}
        {trace.costliest === node.id && (
          <span data-highlight="costliest" className="text-xs">
            {t("trace.costliest")}
          </span>
        )}
        {trace.slowest === node.id && (
          <span data-highlight="slowest" className="text-xs">
            {t("trace.slowest")}
          </span>
        )}
      </Inline>
      {node.kind !== "turn" && node.durationMs !== null && against > 0 && (
        <Bar ratio={node.durationMs / against} />
      )}
      {detail && <span className="text-muted-foreground text-xs">{detail}</span>}
      {node.kind !== "turn" && node.input && node.result && (
        <span className="text-muted-foreground text-xs">{node.result}</span>
      )}
      {node.children.length > 0 && (
        <TreeBranch>
          {node.children.map((child) => (
            <Node
              key={child.id}
              node={child}
              against={node.kind === "turn" ? longest(node.children) : against}
              trace={trace}
              t={t}
            />
          ))}
        </TreeBranch>
      )}
    </TreeItem>
  );
}

/**
 * The Rastro tab: the session's turns with the tools, thoughts and subagents under them, bars
 * for the time, cost and tokens per node, the costliest and the slowest marked, a filter by tool,
 * the replay and the export (`trace.get`, `trace.export`).
 */
export function TracePanel(props: { store: AppStore; hostId: string; claudeSessionId: string }) {
  const t = useT();
  const { store, hostId, claudeSessionId } = props;
  const [trace, setTrace] = useState<SessionTrace | null>(null);
  const [tool, setTool] = useState("");
  const [replaying, setReplaying] = useState(false);
  const [withContent, setWithContent] = useState(false);
  const [hidden, setHidden] = useState<number | null>(null);

  useEffect(() => {
    void store.hostCommand(hostId, "trace.get", { claudeSessionId }).then(setTrace);
  }, [store, hostId, claudeSessionId]);

  const shown = useMemo(() => (trace ? onlyTool(trace.turns, tool) : []), [trace, tool]);
  if (trace === null) return <LoadingState label={t("states.loading")} />;
  if (trace.turns.length === 0) return <EmptyState title={t("trace.empty")} />;

  const totals = [
    trace.costUsd === null ? null : usd(trace.costUsd),
    trace.durationMs === null ? null : formatDuration(trace.durationMs, t),
  ]
    .filter((part) => part !== null)
    .join(" · ");

  const exportTrace = async () => {
    const out = await store.hostCommand(hostId, "trace.export", {
      claudeSessionId,
      includeContent: withContent,
    });
    if (!out) return;
    setHidden(out.redacted);
    await store.saveFile(out.filename, out.json);
  };

  return (
    <section aria-label={t("trace.region")}>
      <Stack gap={3}>
        <Inline gap={3}>
          <span className="text-sm">{totals}</span>
          <NativeSelect
            inline
            compact
            aria-label={t("trace.filter")}
            value={tool}
            onChange={(e) => setTool(e.target.value)}
          >
            <option value="">{t("trace.allTools")}</option>
            {toolNames(trace.turns).map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </NativeSelect>
          <Button variant="outline" size="sm" onClick={() => setReplaying((on) => !on)}>
            {t("trace.replay")}
          </Button>
        </Inline>
        {replaying && (
          <TraceReplay
            store={store}
            hostId={hostId}
            claudeSessionId={claudeSessionId}
            trace={trace}
          />
        )}
        <Panel>
          <TreeBranch>
            {shown.map((turn) => (
              <Node
                key={turn.id}
                node={turn}
                against={longest(turn.children)}
                trace={trace}
                t={t}
              />
            ))}
          </TreeBranch>
        </Panel>
        <Panel size="sm">
          <Inline gap={3}>
            <Button variant="outline" size="sm" onClick={() => void exportTrace()}>
              {t("trace.export")}
            </Button>
            <label>
              <input
                type="checkbox"
                checked={withContent}
                onChange={(e) => setWithContent(e.target.checked)}
              />{" "}
              {t("trace.includeContent")}
            </label>
          </Inline>
          <p className="text-muted-foreground text-xs">
            {t(withContent ? "trace.contentNote" : "trace.structureNote")}
          </p>
          {hidden !== null && hidden > 0 && (
            <p className="text-sm">{t("trace.exported", { n: hidden })}</p>
          )}
        </Panel>
      </Stack>
    </section>
  );
}
