/**
 * `bun run release vX.Y.Z` (issue #275): the steps of a release in order, coordinator only.
 * See the tests for the contract; the real effects arrive through `ReleaseDeps`.
 */

export interface ReleaseResult {
  code: number;
  stdout: string;
}

export interface ReleaseDeps {
  git(args: string[]): Promise<ReleaseResult>;
  gh(args: string[]): Promise<ReleaseResult>;
  /** Runs `bun <args>` in the repository. */
  bun(args: string[]): Promise<ReleaseResult>;
  read(path: string): string;
  write(path: string, text: string): void;
  env: Record<string, string | undefined>;
  log(line: string): void;
}

/** `package.json` with `"version": "<from>"` moved to `<to>`. */
export function bumpPackageJson(text: string, from: string, to: string): string {
  void from;
  void to;
  return text;
}

/** `bun.lock` with the three workspaces' version moved to `<to>`. */
export function bumpLock(text: string, from: string, to: string): string {
  void from;
  void to;
  return text;
}

/** The version test with the product version (and its red message) moved to `<to>`. */
export function bumpVersaoTest(text: string, from: string, to: string): string {
  void from;
  void to;
  return text;
}

/** True when `a` is a later version than `b` (`x.y.z`). */
export function newer(a: string, b: string): boolean {
  void a;
  void b;
  return false;
}

export async function release(argv: string[], deps: ReleaseDeps): Promise<number> {
  void argv;
  void deps;
  return 1;
}
