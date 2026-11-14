import { expect, test } from "bun:test";
import {
  loadQuietSnooze,
  QUIET_SNOOZE_KEY,
} from "../../src/features/needs-you/domain/quiet-snooze.ts";

test("a snooze that is not a future time is left out and the running ones stay (#1609)", () => {
  const raw = '{"a":2000,"b":500,"c":"soon","d":null}';
  const storage = {
    getItem: (key: string) => (key === QUIET_SNOOZE_KEY ? raw : null),
    setItem: () => {},
  };
  expect(loadQuietSnooze(storage, 1000)).toEqual({ a: 2000 });
});
