import type { DeviceKey, Platform } from "../platform/types.ts";

/** The approval keys the prints use (#4154): public halves only, made once for the demo, each with its id (the SHA-256 hex of its DER). */
export const DEMO_THIS_KEY: DeviceKey = {
  publicKey:
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEQ0mtYUcImbWNGGQSCN7QLdFIjs6xHZK7cRTU0UC2gR6JpZ1a5q3/FQvzCofRrqWzBIpELhMKmdab3LQWf3gFww==",
  keyId: "0e5847bede1c2f04c38f2589f6aad75a7511361e05839136d0fd2f7d27bc20c7",
};
/** Another enrolled device, listed by the host and held by nobody here. */
export const DEMO_OTHER_KEY: DeviceKey = {
  publicKey:
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEVZ0nQWJtDoMsFU7HIx+mXgH4Uqt65bD1WQuCrt1wN25blhs3qDVBkg0tv1M6NttuG5vJhkxEesuzu884aelFWw==",
  keyId: "f9e125e4a3ea50a3b126692154544435e0bf1275e8b123cc268a82c1ccca9dbf",
};
/** A new device's key: the one this app makes when it asks to be added, and the one an enrolled device reads to add. */
export const DEMO_NEW_KEY: DeviceKey = {
  publicKey:
    "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEZ/af8n9jFL6QeFPVBMIUWcugKjh8WsuyoLyuuABrTzxRk/D57scmWB/twuOg9Zl650OtP/TTbD1OxGFSAsDRRg==",
  keyId: "b6bfe89972b186f5fc736faae8d1a87351b094b441de3830d4e736f714d8e57d",
};

/** What `sign` gives: no key signs anything for real here, and the host's answer to it is the print's own. */
const DEMO_SIGNATURE = "ZGVtbw==";

/**
 * A stand-in for the desktop's key store, for the prints: the web build has none, so the approving-devices
 * panel would never show. `enrolled` holds `DEMO_THIS_KEY` from the start; `empty` holds none until the page
 * asks for one, which is then `DEMO_NEW_KEY`. Nothing is signed for real: `sign` gives a fixed text.
 * `daemonSeen` hears each host id the page asks about.
 */
export function demoApprovalKeys(
  mode: "enrolled" | "empty",
  daemonSeen: (daemonId: string) => void,
): NonNullable<Platform["approvalKeys"]> {
  let held: DeviceKey | null = mode === "enrolled" ? DEMO_THIS_KEY : null;
  return {
    get: (daemonId) => {
      daemonSeen(daemonId);
      return Promise.resolve(held);
    },
    create: (daemonId) => {
      daemonSeen(daemonId);
      held = mode === "enrolled" ? DEMO_THIS_KEY : DEMO_NEW_KEY;
      return Promise.resolve(held);
    },
    delete: () => {
      held = null;
      return Promise.resolve();
    },
    sign: () => Promise.resolve(DEMO_SIGNATURE),
  };
}
