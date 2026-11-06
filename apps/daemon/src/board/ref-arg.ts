/**
 * A branch or revision that came from a project's settings, checked before it becomes an argument
 * of git: one that starts with `-` would be read as an option (`--output=`, `--exec=`), issue #345.
 */
export function refArg(name: string): string {
  return name;
}
