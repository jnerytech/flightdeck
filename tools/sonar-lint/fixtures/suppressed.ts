// Fixture of scripts/test/lint-sonar.test.ts: Sonar S3923, both branches are the same.
export function pick(flag: boolean): number {
  return flag ? 1 : 1; // NOSONAR: the fixture keeps this finding on purpose
}
