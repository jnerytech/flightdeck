/** The address a daemon prints when it listens (`listening on ws://...`), as soon as it does. */
export async function announcedUrl(out: string[]): Promise<string> {
  for (;;) {
    const found = out.join("").match(/listening on (ws:\/\/\S+)/)?.[1];
    if (found) return found;
    await Bun.sleep(20);
  }
}
