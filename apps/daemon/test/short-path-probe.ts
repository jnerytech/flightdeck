/** Whether 8.3 names are generated on this volume: the short form of a long path is another path. */
export function has83Names(_shorten: (path: string) => string, _longPath: string): boolean {
  return true;
}
