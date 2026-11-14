import { describe, expect, test } from "bun:test";
import type { SessionIdentity } from "@flightdeck/protocol";
import { type Caller, teamAddMember, teamRemoveMember } from "../../src/messaging/tools.ts";

const as: SessionIdentity = { session: "s1" };

/** A daemon that only records what it was asked. */
function recorder() {
  const calls: Array<{ type: string; payload: unknown }> = [];
  const daemon = {
    call: async (type: string, payload: unknown) => {
      calls.push({ type, payload });
      return {};
    },
  } as unknown as Caller;
  return { daemon, calls };
}

/**
 * Issue #2090: the MCP tools `team_add_member` and `team_remove_member` speak the protocol of the
 * local daemon with the asking session attached; the host, not the tool, decides who may ask.
 */
describe("team-manage tools: what the coordinator's tools send to the daemon (#2090)", () => {
  test("adding a member sends the persona and the model only when they were given", async () => {
    const { daemon, calls } = recorder();
    await teamAddMember(daemon, as, "t1", "Check the form.", "qa", "sonnet");
    await teamAddMember(daemon, as, "t1", "Just help.");
    expect(calls).toEqual([
      {
        type: "teams.add_member",
        payload: { team: "t1", brief: "Check the form.", persona: "qa", model: "sonnet", as },
      },
      { type: "teams.add_member", payload: { team: "t1", brief: "Just help.", as } },
    ]);
  });

  test("removing a member names the team and the member", async () => {
    const { daemon, calls } = recorder();
    await teamRemoveMember(daemon, as, "t1", "login · executora 2");
    expect(calls).toEqual([
      { type: "teams.remove_member", payload: { team: "t1", member: "login · executora 2", as } },
    ]);
  });
});
