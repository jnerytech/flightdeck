/** The last `capacity` bytes written, as one circular buffer. */
export class Ring {
  private chunks: Uint8Array[] = [];
  private size = 0;

  constructor(readonly capacity: number) {}

  append(chunk: Uint8Array): void {
    // Copied: the PTY may reuse the memory of the chunk it hands over.
    if (chunk.length >= this.capacity) {
      this.chunks = [chunk.slice(chunk.length - this.capacity)];
      this.size = this.capacity;
      return;
    }
    this.chunks.push(chunk.slice());
    this.size += chunk.length;
    while (this.size > this.capacity) {
      const excess = this.size - this.capacity;
      const head = this.chunks[0] as Uint8Array;
      if (head.length <= excess) {
        this.chunks.shift();
        this.size -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.size -= excess;
      }
    }
  }

  /** What is kept, oldest byte first. */
  snapshot(): Uint8Array {
    const out = new Uint8Array(this.size);
    let at = 0;
    for (const chunk of this.chunks) {
      out.set(chunk, at);
      at += chunk.length;
    }
    return out;
  }
}
