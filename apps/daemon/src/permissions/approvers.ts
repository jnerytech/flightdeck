/** The devices that approve for the person (#3439): challenges, enrollment, revoke and the list. */
import type { Database } from "bun:sqlite";
import type { ApprovalKeyInfo, CommandPayload } from "@flightdeck/protocol";
import { ApprovalStore } from "./approval-store.ts";
import type { EnrolledKey } from "./domain/approval-gate.ts";
import { NonceBook, type NoncePurpose } from "./domain/nonce-book.ts";

export interface ApproversOptions {
  now: () => Date;
  /** A monotonic clock in ms (a nonce's life). */
  mono: () => number;
  /** Unguessable text, for nonces and the daemon id. */
  random: () => string;
}

/** Who asks: the connection (a nonce is held per connection), the address it came from and the name it said hello with. */
export interface Asker {
  connection: number;
  address: string;
  client: string;
}

export class Approvers {
  readonly store: ApprovalStore;
  readonly nonces: NonceBook;

  constructor(db: Database, opts: ApproversOptions) {
    this.store = new ApprovalStore(db, opts.random);
    this.nonces = new NonceBook({ mono: opts.mono, random: opts.random });
  }

  daemonId(): string {
    return "";
  }

  /** The enrolled keys, read from the store on every call. */
  keys(): EnrolledKey[] {
    return [{ keyId: "", publicKey: "" }];
  }

  list(): { daemonId: string; protectionOff: boolean; keys: ApprovalKeyInfo[] } {
    return { daemonId: "", protectionOff: false, keys: [] };
  }

  challenge(
    _purpose: NoncePurpose,
    _requestId: string | undefined,
    _connection: number,
  ): { nonce: string; daemonId: string; expiresInMs: number } {
    return { nonce: "", daemonId: "", expiresInMs: 0 };
  }

  enroll(
    _payload: CommandPayload<"approval.enroll">,
    _asker: Asker,
  ): { keyId: string; daemonId: string } {
    return { keyId: "", daemonId: "" };
  }

  revoke(_payload: CommandPayload<"approval.revoke">): { keyId: string } {
    return { keyId: "" };
  }
}
