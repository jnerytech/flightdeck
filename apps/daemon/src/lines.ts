/** The lines of a byte stream (a child's stdout, stdin), without their `\n` or `\r\n`. */
export async function* linesOf(stream: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  let pending = "";
  const decoder = new TextDecoder();
  for await (const chunk of stream) {
    pending += decoder.decode(chunk, { stream: true });
    for (let end = pending.indexOf("\n"); end >= 0; end = pending.indexOf("\n")) {
      yield pending.slice(0, end).replace(/\r$/, "");
      pending = pending.slice(end + 1);
    }
  }
  if (pending) yield pending;
}
