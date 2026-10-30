import { describe, expect, test } from "bun:test";
import { describeSecret } from "../src/lib/vault-types.ts";

/** Generated with ssh-keygen -t ed25519; the second one has the passphrase "pw12345". */
const PLAIN_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW
QyNTUxOQAAACCzEW5NqZ0HEON/fuAssJsD3vEvl8HsW1VaSEoamw1SEwAAAJB5pesveaXr
LwAAAAtzc2gtZWQyNTUxOQAAACCzEW5NqZ0HEON/fuAssJsD3vEvl8HsW1VaSEoamw1SEw
AAAEAzgY0LtZK5Q0sXfPaMLYBfcPMvmlqW/TeBmaQWohlem7MRbk2pnQcQ439+4CywmwPe
8S+XwexbVVpIShqbDVITAAAAB3Rlc3RAZmQBAgMEBQY=
-----END OPENSSH PRIVATE KEY-----
`;
const ENCRYPTED_KEY = `-----BEGIN OPENSSH PRIVATE KEY-----
b3BlbnNzaC1rZXktdjEAAAAACmFlczI1Ni1jdHIAAAAGYmNyeXB0AAAAGAAAABA0RwLuRN
AbWfxfCdgyDYV7AAAAGAAAAAEAAAAzAAAAC3NzaC1lZDI1NTE5AAAAIJHTQWa4UpOgtf7/
rX3Kg7yF9juodJlpG5UI0jOiOrOfAAAAkIUNM4obBwETnB6q37clHBEhAIHp+o68cw0xep
GvW2FmDoRXIlqzWYw41i3BEwN5CkKktu8rFQp80dT6E3utqXwZP63wUJ1DpSkKBsZlRpeK
eXUqjiZNzf1wca/bhymQbSxU45r+V0eNzji0W1cKjrBz6Tn/Nk0ys/Dt+c5kMBBkrJMRY4
Myjp0XKsRVn7QmPw==
-----END OPENSSH PRIVATE KEY-----
`;

describe("cofre-tipos", () => {
  test("an ssh-key shows its public key and its SHA256 fingerprint", async () => {
    expect(await describeSecret("ssh-key", PLAIN_KEY)).toEqual({
      publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAILMRbk2pnQcQ439+4CywmwPe8S+XwexbVVpIShqbDVIT",
      fingerprint: "SHA256:THp2yU9f/RZubLhRaD22o9ZGLGxV3k2pMz6NL1xou18",
    });
  });

  test("an ssh-key protected by a passphrase still shows both, because the public part is in the clear", async () => {
    expect(await describeSecret("ssh-key", ENCRYPTED_KEY)).toEqual({
      publicKey: "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJHTQWa4UpOgtf7/rX3Kg7yF9juodJlpG5UI0jOiOrOf",
      fingerprint: "SHA256:eqZBYWSgyMJzQiAGLDHQoa/LTN9sWHe6QXO/Gg6LCaw",
    });
  });

  test("text that is not an OpenSSH private key shows nothing", async () => {
    expect(await describeSecret("ssh-key", "not a key")).toEqual({});
    expect(
      await describeSecret(
        "ssh-key",
        "-----BEGIN OPENSSH PRIVATE KEY-----\nAAAA\n-----END OPENSSH PRIVATE KEY-----",
      ),
    ).toEqual({});
  });

  test("a key body that is not valid base64 shows nothing", async () => {
    expect(
      await describeSecret(
        "ssh-key",
        "-----BEGIN OPENSSH PRIVATE KEY-----\n%%%\n-----END OPENSSH PRIVATE KEY-----",
      ),
    ).toEqual({});
  });

  test("a token shows its prefix and its last four characters", async () => {
    expect(await describeSecret("token", "ghp_0123456789abcdefghijWXYZ")).toEqual({
      hint: "ghp_…WXYZ",
    });
    expect(await describeSecret("token", "sk-ant-api03-0123456789abcdefghij")).toEqual({
      hint: "sk-…ghij",
    });
  });

  test("a token without a recognizable prefix shows its first three characters, and a short one nothing", async () => {
    expect(await describeSecret("token", "0123456789abcdefghij")).toEqual({ hint: "012…ghij" });
    expect(await describeSecret("token", "short-token")).toEqual({});
  });

  test("an env set shows its names in order and never the values", async () => {
    const info = await describeSecret(
      "env",
      "# deploy\nAPI_URL=https://x\n\nDB_PASS=s3cr=et\nbad line\n_OK1 = 2\n",
    );
    expect(info).toEqual({ names: ["API_URL", "DB_PASS", "_OK1"] });
    expect(JSON.stringify(info).includes("s3cr")).toBe(false);
  });

  test("a password shows nothing", async () => {
    expect(await describeSecret("password", "hunter2")).toEqual({});
  });
});
