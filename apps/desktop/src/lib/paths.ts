/** Last path segment, for both `/` and `\` separators. */
export const basename = (path: string): string =>
  path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
