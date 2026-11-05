// Fixture of scripts/test/lint-sonar.test.ts: Sonar S9382, an await inside a loop.
export async function total(
  items: number[],
  read: (n: number) => Promise<number>,
): Promise<number> {
  let sum = 0;
  for (const item of items) {
    sum += await read(item);
  }
  return sum;
}
