// Fixture of scripts/test/lint-sonar.test.ts: the same issue, suppressed with a reason.
import { test } from "bun:test";

test.skip("waits for a day", () => {}); // NOSONAR: the fixture keeps this finding on purpose
