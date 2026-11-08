import { afterEach, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { WorkflowsPage } = await import("../src/ui/WorkflowsPage.tsx");

afterEach(cleanup);

const NO_HOSTS = { hosts: [] };

test("a workflow from a daemon that sends no issues shows its error texts as they came", async () => {
  const store = {
    hostCommand: async () => ({
      workflows: [
        {
          name: "velho",
          hash: "h",
          trusted: false,
          checks: [],
          errors: ["steps.0.id is required"],
        },
      ],
    }),
    // The templates dialog reads the hosts (#1221): one state, so every read is the same.
    getState: () => NO_HOSTS,
    subscribe: () => () => {},
  };
  await act(async () => {
    render(<WorkflowsPage store={store as never} hostId="h1" projectId="p1" projectName="app" />);
  });
  expect(await screen.findByText("steps.0.id is required")).toBeTruthy();
});
