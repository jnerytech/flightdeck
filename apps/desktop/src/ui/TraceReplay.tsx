import type { SessionTrace, SnapshotFiles } from "@flightdeck/protocol";
import { useEffect, useMemo, useState } from "react";
import { NativeSelect } from "@/components/layout/form";
import { Button } from "@/components/ui/button";
import { useT } from "@/i18n/context";
import { Panel } from "../components/layout/panel.tsx";
import { Inline, Stack } from "../components/layout/stack.tsx";
import type { AppStore } from "../lib/app-store.ts";
import { flatten, turnOf } from "../lib/trace.ts";
import { hasFeature } from "../lib/version.ts";
import { nodeNumbers, nodeTitle } from "./TracePanel.tsx";

const SPEEDS = [1, 2, 4];

/**
 * The replay: the trace walked one node at a time, with play, pause and a speed, and, when the
 * host keeps checkpoints (phase 12), the files the turn of that step changed.
 */
export function TraceReplay(props: {
  store: AppStore;
  hostId: string;
  claudeSessionId: string;
  trace: SessionTrace;
}) {
  const t = useT();
  const { store, hostId, claudeSessionId, trace } = props;
  const steps = useMemo(() => flatten(trace.turns), [trace]);
  const [index, setIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [files, setFiles] = useState<Record<number, SnapshotFiles | null>>({});
  const step = steps[index];
  const withFiles = hasFeature(
    store.getState().hosts.find((h) => h.id === hostId)?.hostInfo?.features,
    "checkpoints",
    false,
  );
  const turn = step ? turnOf(trace.turns, step.id) : null;

  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= steps.length - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(timer);
  }, [playing, speed, steps.length]);

  useEffect(() => {
    if (!withFiles || turn === null || turn in files) return;
    void store
      .hostCommand(hostId, "snapshots.files", { claudeSessionId, n: turn })
      .then((result) => setFiles((known) => ({ ...known, [turn]: result })));
  }, [store, hostId, claudeSessionId, withFiles, turn, files]);

  const changed = turn === null ? null : files[turn];
  return (
    <section aria-label={t("trace.replayRegion")}>
      <Panel size="sm">
        <Stack gap={2}>
          <Inline gap={2}>
            <Button
              variant="outline"
              size="sm"
              disabled={index === 0}
              onClick={() => setIndex((i) => Math.max(0, i - 1))}
            >
              {t("trace.previous")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                if (index >= steps.length - 1) setIndex(0);
                setPlaying((on) => !on);
              }}
            >
              {t(playing ? "trace.pause" : "trace.play")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={index >= steps.length - 1}
              onClick={() => setIndex((i) => Math.min(steps.length - 1, i + 1))}
            >
              {t("trace.next")}
            </Button>
            <NativeSelect
              inline
              compact
              aria-label={t("trace.speed")}
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {SPEEDS.map((s) => (
                <option key={s} value={s}>{`${s}x`}</option>
              ))}
            </NativeSelect>
            <span className="text-sm">
              {t("trace.step", { n: index + 1, total: steps.length })}
            </span>
          </Inline>
          {step && (
            <Stack gap={1}>
              <span className="font-medium text-sm">{nodeTitle(step, t)}</span>
              <span className="text-muted-foreground text-xs">{nodeNumbers(step, t)}</span>
              {step.input && <span className="text-xs">{step.input}</span>}
              {step.result && <span className="text-xs">{step.result}</span>}
            </Stack>
          )}
          {changed && changed.files.length > 0 && (
            <Stack gap={1}>
              <span className="text-xs">{t("trace.files")}</span>
              <Stack as="ul" gap={1}>
                {changed.files.map((file) => (
                  <li key={file.path} className="text-xs">
                    {`${file.path} · ${t(`trace.${file.change}` as never)}`}
                  </li>
                ))}
                <li className="text-xs">{`+${changed.insertions} −${changed.deletions}`}</li>
              </Stack>
            </Stack>
          )}
        </Stack>
      </Panel>
    </section>
  );
}
