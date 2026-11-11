/**
 * Chooses an item of the sidebar's account menu ("Settings", "Toggle theme", "Manual"): opens the
 * menu from the account row, then clicks the item. Call after `registerDom()`.
 */
export async function chooseFromAccountMenu(name: string | RegExp): Promise<void> {
  const { act, fireEvent, screen } = await import("@testing-library/react");
  const trigger = screen
    .getAllByRole("button")
    .find((b) => b.getAttribute("data-slot") === "account-trigger");
  if (!trigger) throw new Error("the account row is not in the sidebar");
  await act(async () => {
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false, pointerType: "mouse" });
  });
  const item = await screen.findByRole("menuitem", { name });
  await act(async () => {
    fireEvent.click(item);
  });
}
