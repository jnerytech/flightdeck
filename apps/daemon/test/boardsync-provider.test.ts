import { providerContract } from "./boardsync-contract.ts";
import { fakeHarness } from "./boardsync-fake.ts";

providerContract("the fake provider", fakeHarness);
