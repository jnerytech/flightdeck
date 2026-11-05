/**
 * What `sonar-project.properties` tells SonarCloud (#283): which files are excluded, which are test
 * code, and which count for coverage. SonarCloud Code Analysis on the PR is the only Sonar check;
 * sonar-coverage.test.ts uses these to keep SonarCloud's coverage on exactly our 100% gate's files.
 */

/** The comma-separated globs of one property of a sonar-project.properties file. */
function listOf(properties: string, key: string): string[] {
  const line = properties.split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1).split(",") : [];
}

/** `**` crosses folders, `*` stays inside one. */
function globToRegExp(glob: string): RegExp {
  const body = glob.replace(/\*\*\/|\*\*|\*|[.+^${}()|[\]\\]/g, (token) => {
    if (token === "**/") return "(?:.*/)?";
    if (token === "**") return ".*";
    if (token === "*") return "[^/]*";
    return `\\${token}`;
  });
  return new RegExp(`^${body}$`);
}

/** The `sonar.exclusions` globs of a sonar-project.properties file. */
export function exclusionsOf(properties: string): string[] {
  return listOf(properties, "sonar.exclusions");
}

/** Whether a Sonar glob (`**` crosses folders, `*` stays in one) matches a repository path. */
export function matchesGlob(glob: string, path: string): boolean {
  return globToRegExp(glob).test(path);
}

/** The `sonar.test.inclusions` globs of a sonar-project.properties file. */
export function testInclusionsOf(properties: string): string[] {
  return listOf(properties, "sonar.test.inclusions");
}

/** Whether SonarCloud treats this file as test code. */
export function isTestFile(path: string, inclusions: string[]): boolean {
  return inclusions.some((glob) => matchesGlob(glob, path));
}

/** Whether SonarCloud reads this file's coverage: analysed, not a test, not coverage-excluded. */
export function countsForCoverage(path: string, properties: string): boolean {
  const any = (key: string) => listOf(properties, key).some((glob) => matchesGlob(glob, path));
  return (
    !any("sonar.exclusions") && !any("sonar.test.inclusions") && !any("sonar.coverage.exclusions")
  );
}
