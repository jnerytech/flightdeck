/**
 * Issue #1439: the fake review the demo shows. Two findings on the first two added lines of the
 * prompt's diff (high, then medium) and one on a line the diff does not add, so it stays loose.
 */
export function cannedReview(prompt: string): string {
  const diff = /<diff>\n([\s\S]*?)\n<\/diff>/.exec(prompt)?.[1] ?? "";
  const added: Array<{ path: string; line: number }> = [];
  let path = "";
  let line = 0;
  const lines = diff.split("\n");
  // Inside a hunk its header's counts say how many lines are content: there, no line is a header.
  let oldLeft = 0;
  let newLeft = 0;
  for (let i = 0; i < lines.length; i++) {
    const text = lines[i] ?? "";
    if (oldLeft > 0 || newLeft > 0) {
      if (text.startsWith("+")) {
        added.push({ path, line: line++ });
        newLeft--;
      } else if (text.startsWith("-")) oldLeft--;
      else {
        line++;
        oldLeft--;
        newLeft--;
      }
    } else if (text.startsWith("--- ") && lines[i + 1]?.startsWith("+++ ")) {
      path = (lines[i + 1] ?? "").slice(4);
      i++;
    } else if (text.startsWith("@@")) {
      const m = /-\d+(?:,(\d+))? \+(\d+)(?:,(\d+))?/.exec(text);
      line = Number(m?.[2] ?? 0);
      oldLeft = Number(m?.[1] ?? 1);
      newLeft = Number(m?.[3] ?? 1);
    }
  }
  const [first, second] = added;
  const findings = [
    ...(first
      ? [
          {
            ...first,
            severity: "high",
            body: "This value looks hard-coded; read it from the settings instead.",
          },
        ]
      : []),
    ...(second
      ? [
          {
            ...second,
            severity: "medium",
            body: "A test for this branch would catch a regression.",
          },
        ]
      : []),
    {
      path: first?.path ?? "README.md",
      line: 100_000,
      severity: "low",
      body: "Consider a note in the changelog.",
    },
  ];
  return JSON.stringify({ summary: "Two findings on the changes, one general note.", findings });
}
