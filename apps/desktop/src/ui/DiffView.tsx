import type { CardDiff, DiffLine } from "@flightdeck/protocol";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/** Pairs each line with its side: removals on the left, additions on the right. */
const sides = (line: DiffLine): [string, string] => [
  line.op === "+" ? "" : line.text,
  line.op === "-" ? "" : line.text,
];

/** The card's changes per file, unified or side by side; uncommitted files are marked. */
export function DiffView({ diff }: { diff: CardDiff }) {
  const [mode, setMode] = useState<"unified" | "split">("unified");
  return (
    <div className="flex flex-col gap-3">
      <ul aria-label="Arquivos alterados" className="flex flex-col gap-1 text-sm">
        {diff.files.map((file) => (
          <li key={`${file.path}:${file.uncommitted}`} className="flex items-center gap-2">
            <span className="font-mono text-xs">{file.path}</span>{" "}
            <span className="text-muted-foreground text-xs tabular-nums">{`+${file.additions} −${file.deletions}`}</span>
            {file.uncommitted && (
              <Badge variant="outline" className="text-status-needs-you">
                não commitado
              </Badge>
            )}
          </li>
        ))}
      </ul>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          aria-pressed={mode === "unified"}
          className="aria-pressed:bg-accent"
          onClick={() => setMode("unified")}
        >
          Unificada
        </Button>
        <Button
          variant="outline"
          size="sm"
          aria-pressed={mode === "split"}
          className="aria-pressed:bg-accent"
          onClick={() => setMode("split")}
        >
          Lado a lado
        </Button>
      </div>
      <section
        aria-label={mode === "unified" ? "Diff unificado" : "Diff lado a lado"}
        className="flex flex-col gap-4"
      >
        {diff.files.map((file) => (
          <div key={`${file.path}:${file.uncommitted}`} className="flex flex-col gap-2">
            <h4 className="font-medium font-mono text-xs">{file.path}</h4>
            {file.hunks.map((hunk) =>
              mode === "unified" ? (
                <pre
                  key={hunk.header}
                  className="overflow-x-auto rounded-md border bg-muted p-3 font-mono text-xs"
                >
                  {[hunk.header, ...hunk.lines.map((l) => `${l.op}${l.text}`)].join("\n")}
                </pre>
              ) : (
                <table key={hunk.header} className="w-full table-fixed border font-mono text-xs">
                  <tbody>
                    {hunk.lines.map(sides).map(([left, right], i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: lines are immutable and ordered
                      <tr key={i}>
                        <td className="w-1/2 whitespace-pre-wrap border-r px-2 align-top">
                          {left}
                        </td>
                        <td className="w-1/2 whitespace-pre-wrap px-2 align-top">{right}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ),
            )}
          </div>
        ))}
      </section>
    </div>
  );
}
