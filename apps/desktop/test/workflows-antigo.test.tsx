import { afterEach, expect, test } from "bun:test";
import { liveScreen, registerDom } from "./dom.ts";

registerDom();
const { act, cleanup, render, within } = await import("@testing-library/react");
const screen = liveScreen(within);
const { WorkflowsPage } = await import("../src/ui/WorkflowsPage.tsx");

afterEach(cleanup);

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
  };
  await act(async () => {
    render(<WorkflowsPage store={store as never} hostId="h1" projectId="p1" projectName="app" />);
  });
  await act(() => Bun.sleep(20));
  expect(screen.queryByText("steps.0.id is required")).not.toBeNull();
});
