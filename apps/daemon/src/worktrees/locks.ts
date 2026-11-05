/** Folders being removed, which nothing may start in. (Stub: holds nothing.) */
export class FolderLocks {
  hold(_path: string): void {}
  release(_path: string): void {}
  isHeld(_cwd: string): boolean {
    return false;
  }
}
