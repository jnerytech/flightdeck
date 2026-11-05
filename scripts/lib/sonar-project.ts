/**
 * What `sonar-project.properties` tells SonarCloud (#283): which files are excluded, which are test
 * code, and which count for coverage. SonarCloud Code Analysis on the PR is the only Sonar check;
 * sonar-coverage.test.ts uses these to keep SonarCloud's coverage on exactly our 100% gate's files.
 */

/** The `sonar.exclusions` globs of a sonar-project.properties file. */
export function exclusionsOf(_properties: string): string[] {
  return [];
}

/** Whether a Sonar glob (`**` crosses folders, `*` stays in one) matches a repository path. */
export function matchesGlob(_glob: string, _path: string): boolean {
  return false;
}

/** The `sonar.test.inclusions` globs of a sonar-project.properties file. */
export function testInclusionsOf(_properties: string): string[] {
  return [];
}

/** Whether SonarCloud treats this file as test code. */
export function isTestFile(_path: string, _inclusions: string[]): boolean {
  return false;
}

/** Whether SonarCloud reads this file's coverage: analysed, not a test, not coverage-excluded. */
export function countsForCoverage(_path: string, _properties: string): boolean {
  return false;
}
