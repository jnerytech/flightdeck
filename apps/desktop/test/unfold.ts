/**
 * Every project of the Sessions page starts folded (issue #111): this opens them all, with the
 * page's own "Expand all" button, once the page has drawn it.
 */
export async function unfoldAll(act: (callback: () => Promise<void>) => Promise<unknown>) {
  // Only once a project is drawn: "Expand all" opens the projects there are when it is pressed.
  const drawn = () =>
    [...document.querySelectorAll("button")].some((b) =>
      /^(Mostrar ou esconder|Show or hide) /.test(b.getAttribute("aria-label") ?? ""),
    );
  const find = () =>
    drawn()
      ? [...document.querySelectorAll("button")].find((b) =>
          /^(Expandir tudo|Expand all)$/.test(b.textContent ?? ""),
        )
      : undefined;
  const start = Date.now();
  while (!find() && Date.now() - start < 4000) {
    await act(async () => {
      await Bun.sleep(20);
    });
  }
  const button = find();
  if (!button) throw new Error("the Sessions page has no Expand all button");
  await act(async () => {
    button.click();
  });
}
