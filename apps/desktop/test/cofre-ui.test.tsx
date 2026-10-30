import { afterEach, describe, expect, test } from "bun:test";
import type { SecretMeta } from "../src/lib/vault.ts";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { SecretPicker } = await import("../src/components/vault/secret-picker.tsx");

afterEach(cleanup);

const secret = (
  id: string,
  name: string,
  type: SecretMeta["type"],
  tags: string[] = [],
): SecretMeta => ({
  id,
  name,
  type,
  description: "",
  tags,
  createdAt: 1,
  lastUsedAt: null,
  allowedHosts: ["local"],
});

const SECRETS = [
  secret("a1", "deploy key", "ssh-key", ["prod", "ssh"]),
  secret("b2", "github", "token"),
  secret("c3", "db", "password", ["prod"]),
];

const picker = () =>
  screen.queryByRole("combobox", { name: "Segredo" }) as HTMLSelectElement | null;
const options = () => [...(picker()?.options ?? [])].map((o) => [o.value, o.textContent]);

describe("cofre-ui: SecretPicker", () => {
  test("lists the secrets by name and tags, valued by id, after an empty option", () => {
    render(<SecretPicker label="Segredo" secrets={SECRETS} value="" onChange={() => {}} />);
    expect(options()).toEqual([
      ["", "Nenhum segredo"],
      ["a1", "deploy key · prod, ssh"],
      ["b2", "github"],
      ["c3", "db · prod"],
    ]);
    expect(picker()?.value).toBe("");
  });

  test("shows the chosen secret", () => {
    render(<SecretPicker label="Segredo" secrets={SECRETS} value="b2" onChange={() => {}} />);
    expect(picker()?.value).toBe("b2");
  });

  test("the types filter hides the other types", () => {
    render(
      <SecretPicker
        label="Segredo"
        secrets={SECRETS}
        value=""
        types={["ssh-key", "password"]}
        onChange={() => {}}
      />,
    );
    expect(options().map(([id]) => id)).toEqual(["", "a1", "c3"]);
  });

  test("choosing calls onChange with the id, and choosing none with an empty string", () => {
    const seen: string[] = [];
    render(
      <SecretPicker
        label="Segredo"
        secrets={SECRETS}
        value="a1"
        onChange={(id) => seen.push(id)}
      />,
    );
    expect(picker()).not.toBeNull();
    fireEvent.change(picker() as HTMLSelectElement, { target: { value: "c3" } });
    fireEvent.change(picker() as HTMLSelectElement, { target: { value: "" } });
    expect(seen).toEqual(["c3", ""]);
  });
});
