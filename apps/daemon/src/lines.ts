/** The lines of a byte stream (a child's stdout, stdin), without their `\n` or `\r\n`. */
export async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let pending = "";
  // How far `pending` holds no newline: a long line is scanned once, not again with every chunk.
  let scanned = 0;
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    let start = 0;
    for (let end = pending.indexOf("\n", scanned); end >= 0; end = pending.indexOf("\n", start)) {
      yield pending.slice(start, end).replace(/\r$/, "");
      start = end + 1;
    }
    pending = pending.slice(start);
    scanned = pending.length;
  }
  if (pending) yield pending;
}
