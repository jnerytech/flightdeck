import type { CardDiff, DiffLine } from "@flightdeck/protocol";
import { useState } from "react";

/** Pairs each line with its side: removals on the left, additions on the right. */
const sides = (line: DiffLine): [string, string] => [
  line.op === "+" ? "" : line.text,
  line.op === "-" ? "" : line.text,
];

/** The card's changes per file, unified or side by side; uncommitted files are marked. */
export function DiffView({ diff }: { diff: CardDiff }) {
  const [mode, setMode] = useState<"unified" | "split">("unified");
  return (
    <div className="diff">
      <ul aria-label="Arquivos alterados">
        {diff.files.map((file) => (
          <li key={`${file.path}:${file.uncommitted}`}>
            <span>{file.path}</span> <span>{`+${file.additions} −${file.deletions}`}</span>
            {file.uncommitted && <span className="badge badge-warn">não commitado</span>}
          </li>
        ))}
      </ul>
      <div className="row">
        <button type="button" aria-pressed={mode === "unified"} onClick={() => setMode("unified")}>
          Unificada
        </button>
        <button type="button" aria-pressed={mode === "split"} onClick={() => setMode("split")}>
          Lado a lado
        </button>
      </div>
      <section aria-label={mode === "unified" ? "Diff unificado" : "Diff lado a lado"}>
        {diff.files.map((file) => (
          <div key={`${file.path}:${file.uncommitted}`} className="diff-file">
            <h4>{file.path}</h4>
            {file.hunks.map((hunk, h) =>
              mode === "unified" ? (
                // biome-ignore lint/suspicious/noArrayIndexKey: hunks are immutable and ordered
                <pre key={h}>
                  {[hunk.header, ...hunk.lines.map((l) => `${l.op}${l.text}`)].join("\n")}
                </pre>
              ) : (
                // biome-ignore lint/suspicious/noArrayIndexKey: hunks are immutable and ordered
                <table key={h}>
                  <tbody>
                    {hunk.lines.map(sides).map(([left, right], i) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: lines are immutable and ordered
                      <tr key={i}>
                        <td>{left}</td>
                        <td>{right}</td>
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
