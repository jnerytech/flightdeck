import { afterEach, describe, expect, setDefaultTimeout, test } from "bun:test";
import { en } from "../../src/i18n/en.ts";
import { ptBR } from "../../src/i18n/pt-BR.ts";
import { liveScreen, registerDom } from "../dom.ts";
import { daemon as makeDaemon, memoryPlatform, TOKEN } from "../fixtures.ts";
import { waiter } from "../wait.ts";

registerDom();
const { act, cleanup, fireEvent, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { AppStore } = await import("../../src/lib/app-store.ts");
const { App } = await import("../../src/app/App.tsx");

setDefaultTimeout(40_000);
const cleanups: Array<() => unknown> = [];
afterEach(async () => {
  cleanup();
  for (const fn of cleanups.splice(0).reverse()) await fn();
});
const settle = waiter(10_000);

async function costsPage(lang: "en" | "pt-BR") {
  const d = makeDaemon(cleanups, { roi: true, costs: true });
  const mem = memoryPlatform(false, lang);
  const store = new AppStore(mem.platform, { baseDelayMs: 60_000 });
  cleanups.push(() => store.dispose());
  render(<App store={store} />);
  await act(async () => {
    await store.roster.add({ name: "alfa", url: d.listen().url, token: TOKEN });
  });
  await settle(() => store.getState().hosts[0]?.status === "online");
  const hostId = store.getState().hosts[0]?.id ?? "";
  d.eventStore.db
    .query(
      `INSERT INTO usage_entries (message_id, claude_session_id, at, day, project_key, model, origin, speed, input, output,
         cache_read, cache_write_5m, cache_write_1h, cost_usd)
       VALUES ('u1', 's1', ?, ?, 'k', 'm', 'app', 'standard', 1, 0, 0, 0, 0, 1)`,
    )
    .run(new Date().toISOString(), new Date().toISOString().slice(0, 10));
  await act(async () => {
    store.router.push({ name: "costs" });
  });
  return { store, hostId };
}

const type = async (label: string, value: string) => {
  await act(async () => {
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  });
};
/** Enter in a field of a form submits that form: the form is what the test submits. */
const submitFormOf = async (label: string) => {
  const form = screen.getByLabelText(label).closest("form");
  expect(form).not.toBeNull();
  await act(async () => {
    fireEvent.submit(form as HTMLFormElement);
  });
};
const said = (text: string) =>
  screen.queryAllByRole("status").some((line) => line.textContent === text);
/** The alert that sits under `label`'s field: the control's description names it. */
const alertOf = (label: string) => {
  const control = screen.getByLabelText(label);
  const ids = (control.getAttribute("aria-describedby") ?? "").split(" ");
  const alert = screen.queryByRole("alert");
  return alert && ids.includes(alert.id) ? alert.textContent : null;
};

const NEW = {
  en: {
    added: "Person added.",
    removed: "Person removed.",
    reviewOn: "Review time now counts as cost.",
    reviewOff: "Review time no longer counts as cost.",
    taken: "Belongs to Ana",
  },
  "pt-BR": {
    added: "Pessoa adicionada.",
    removed: "Pessoa removida.",
    reviewOn: "O tempo de revisão agora conta como custo.",
    reviewOff: "O tempo de revisão não conta mais como custo.",
    taken: "É de Ana",
  },
} as const;

for (const [lang, t] of [
  ["en", en],
  ["pt-BR", ptBR],
] as const) {
  const S = t.roiUi.settingsPanel;
  const N = NEW[lang];
  describe(`roi-ajustes-form (${lang}): forms, fields, switches and announcements (#4193)`, () => {
    test("Enter in the rate saves the rate alone, and Enter in the cap saves the cap alone, each saying Saved", async () => {
      const { store } = await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.defaultRate) !== null);
      const rateForm = screen.getByLabelText(S.defaultRate).closest("form");
      expect(rateForm).not.toBeNull();
      expect(rateForm).not.toBe(screen.getByLabelText(S.reviewCap).closest("form"));
      await type(S.defaultRate, "42.5");
      await type(S.reviewCap, "10");
      await submitFormOf(S.defaultRate);
      expect(store.roi.data().defaultRate).toBe(42.5);
      expect(store.roi.data().reviewCapMinutes).not.toBe(10);
      expect(said(S.saved)).toBe(true);
      await submitFormOf(S.reviewCap);
      expect(store.roi.data().reviewCapMinutes).toBe(10);
      expect(said(S.saved)).toBe(true);
    });

    test("a bad rate shows its error under the rate field and focus goes to the field", async () => {
      await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.defaultRate) !== null);
      await type(S.defaultRate, "abc");
      await submitFormOf(S.defaultRate);
      expect(alertOf(S.defaultRate)).toBe(S.error.number);
      expect(document.activeElement).toBe(screen.getByLabelText(S.defaultRate));
    });

    test("a bad cap shows its error under the cap field and focus goes to the field", async () => {
      await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.reviewCap) !== null);
      await type(S.reviewCap, "0");
      await submitFormOf(S.reviewCap);
      expect(alertOf(S.reviewCap)).toBe(S.error.review_cap_invalid);
      expect(document.activeElement).toBe(screen.getByLabelText(S.reviewCap));
    });

    test("Enter in the add-person fields adds the person and clears them; a person with no name is refused under the name", async () => {
      const { store } = await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.personName) !== null);
      await submitFormOf(S.personName);
      expect(alertOf(S.personName)).toBe(S.error.person_name_empty);
      expect(document.activeElement).toBe(screen.getByLabelText(S.personName));
      expect(said(N.added)).toBe(false);
      await type(S.personName, "Ana");
      await submitFormOf(S.personName);
      expect(store.roi.data().people).toMatchObject([{ name: "Ana" }]);
      expect((screen.getByLabelText(S.personName) as HTMLInputElement).value).toBe("");
      expect(said(N.added)).toBe(true);
    });

    test("a limit that is not a number is refused under its own field", async () => {
      await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.personName) !== null);
      await type(S.personName, "Cy");
      await type(S.costLimit, "abc");
      await submitFormOf(S.personName);
      expect(alertOf(S.costLimit)).toBe(S.error.person_limit_invalid);
      expect(document.activeElement).toBe(screen.getByLabelText(S.costLimit));
    });

    test("removing a person says so", async () => {
      const { store, hostId } = await costsPage(lang);
      store.roi.addPerson({ name: "Ana", hostIds: [hostId] });
      const remove = S.removePerson.replace("{name}", "Ana");
      await settle(() => screen.queryByRole("button", { name: remove }) !== null);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: remove }));
      });
      await act(async () => {
        fireEvent.click(
          within(screen.getByRole("alertdialog")).getByRole("button", { name: S.removeConfirm }),
        );
      });
      expect(store.roi.data().people).toEqual([]);
      expect(said(N.removed)).toBe(true);
    });

    test("counting review time is a switch, and each change is announced", async () => {
      const { store } = await costsPage(lang);
      await settle(() => screen.queryByLabelText(S.countReview) !== null);
      expect(screen.queryByRole("switch", { name: S.countReview })).not.toBeNull();
      const toggle = () => screen.getByRole("switch", { name: S.countReview });
      await act(async () => {
        fireEvent.click(toggle());
      });
      expect(store.roi.data().countReview).toBe(true);
      expect(said(N.reviewOn)).toBe(true);
      await act(async () => {
        fireEvent.click(toggle());
      });
      expect(store.roi.data().countReview).toBe(false);
      expect(said(N.reviewOff)).toBe(true);
      expect(said(N.reviewOn)).toBe(false);
    });

    test("a host that belongs to another person is disabled and says who has it", async () => {
      const { store, hostId } = await costsPage(lang);
      store.roi.addPerson({ name: "Ana", hostIds: [hostId] });
      await settle(() => screen.queryByLabelText(S.personName) !== null);
      const box = within(screen.getByRole("group", { name: S.personHosts })).getByLabelText(
        "alfa",
      ) as HTMLInputElement;
      expect(box.disabled).toBe(true);
      const note = (box.getAttribute("aria-describedby") ?? "")
        .split(" ")
        .map((id) => document.getElementById(id)?.textContent)
        .filter(Boolean);
      expect(note).toEqual([N.taken]);
    });
  });
}
