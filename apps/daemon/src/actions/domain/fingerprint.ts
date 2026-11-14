export interface Fingerprint {
  /** sha256 of what the action declares (not its name nor its description). */
  declaration: string;
  /** Path (relative to the project, with `/`) → sha256 of the file's content. */
  files: Record<string, string>;
}
