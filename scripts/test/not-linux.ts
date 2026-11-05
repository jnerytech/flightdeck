/**
 * True off Linux. A test that is unstable there is skipped with `test.skipIf(notLinux)` and a
 * `// unstable: #<issue> <reason>` note (docs/TDD.md); it keeps running on Ubuntu, under the
 * coverage gate.
 */
export const notLinux = process.platform !== "linux";
