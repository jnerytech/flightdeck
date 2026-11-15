import { mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";
import { parseJsonOr, writeFileAtomic } from "../../kernel/index.ts";
import { PinsJson } from "../domain/json-reads.ts";
import type { Pin, PinStore } from "../ports.ts";

/** Pins kept in a JSON file; one that cannot be read is no pin at all. */
export function filePins(path: string): PinStore {
  const read = async (): Promise<Record<string, Pin>> => {
    try {
      return parseJsonOr<Record<string, Pin>>(PinsJson, await readFile(path, "utf8"), {});
    } catch {
      return {};
    }
  };
  // Changes go one after the other, so two at once cannot read the same file and lose one.
  let turn: Promise<unknown> = Promise.resolve();
  const change = (apply: (pins: Record<string, Pin>) => Record<string, Pin>): Promise<void> => {
    const done = turn.then(async () => {
      await mkdir(dirname(path), { recursive: true });
      await writeFileAtomic(path, JSON.stringify(apply(await read()), null, 2));
    });
    turn = done.catch(() => {});
    return done;
  };
  return {
    all: read,
    set: (id, pin) => change((pins) => ({ ...pins, [id]: pin })),
    delete: (id) =>
      change((pins) => {
        const { [id]: _gone, ...rest } = pins;
        return rest;
      }),
  };
}
