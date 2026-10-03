// Every message pinned against the exact strings backend/internal/auth/wallet_test.go pins for the Go builders.
import { describe, expect, it } from "vitest";
import * as m from "../src/messages";

describe("wallet messages match backend/internal/auth byte for byte", () => {
  it("source and recovery (wallet_test.go TestAuthorizationMessages)", () => {
    expect(m.sourceMessage("0xabc", "PUB", ["a", "b"], 42)).toBe("CargoFlow evidence source\nshipment: 0xabc\npublic key: PUB\nsensors: a,b\nissued: 42");
    expect(m.recoveryMessage("0xabc", "sensor-2", "0xDEF", 7)).toBe("CargoFlow recovery\nshipment: 0xabc\nsensor: sensor-2\nsubmitter: 0xdef\nissued: 7");
  });

  it("documents, alerts, vessel, market and gas (wallet_test.go)", () => {
    const sh = "0xABC";
    const cases: [string, string][] = [
      [m.documentMessage(sh, "invoice", "0xAA", 1), "CargoFlow document\nshipment: 0xabc\nkind: invoice\nsha256: 0xaa\nissued: 1"],
      [m.alertsMessage(sh, "webhook", "https://X.io/h", 2), "CargoFlow alerts\nshipment: 0xabc\nchannel: webhook\ntarget: https://X.io/h\nissued: 2"],
      [m.alertsOffMessage("sub-1", 3), "CargoFlow alerts off\nsubscription: sub-1\nissued: 3"],
      [m.vesselMessage(sh, "636012345", 4), "CargoFlow vessel\nshipment: 0xabc\nmmsi: 636012345\nissued: 4"],
      [m.requestMessage(sh, "40000000000", 250, 4, 5), "CargoFlow financing request\nshipment: 0xabc\namount: 40000000000\nmax fee bps: 250\nmilestones: 4\nissued: 5"],
      [m.offerMessage("RID", 200, 6), "CargoFlow offer\nrequest: rid\nfee bps: 200\nissued: 6"],
      [m.acceptMessage("RID", "OID", 7), "CargoFlow accept\nrequest: rid\noffer: oid\nissued: 7"],
      [m.closeRequestMessage("RID", 8), "CargoFlow close request\nrequest: rid\nissued: 8"],
      [m.gasMessage("0xDEF", 9), "CargoFlow gas\naddress: 0xdef\nissued: 9"],
    ];
    for (const [got, want] of cases) expect(got).toBe(want);
  });

  it("signs the alert target exactly as sent (case kept, Telegram empty) and accepts bigint amounts", () => {
    expect(m.alertsMessage("0xA", "telegram", "", 1)).toBe("CargoFlow alerts\nshipment: 0xa\nchannel: telegram\ntarget: \nissued: 1");
    expect(m.requestMessage("0xA", 40_000_000_000n, 250, 4, 5)).toContain("amount: 40000000000\n");
  });

  it("does not trim values (Go does not)", () => {
    expect(m.offerMessage(" RID", 1, 1)).toBe("CargoFlow offer\nrequest:  rid\nfee bps: 1\nissued: 1");
  });

  it("never ends with a newline", () => {
    for (const s of [m.gasMessage("0x1", 1), m.closeRequestMessage("r", 2), m.sourceMessage("0x1", "k", ["a"], 3)]) expect(s.endsWith("\n")).toBe(false);
  });

  it("device registration with a key type line (device_test.go TestDeviceAuthorizationKeepsTheEd25519Message)", () => {
    expect(m.deviceMessage("0xAB", "key", "p256", ["a"], 7)).toBe("CargoFlow evidence source\nshipment: 0xab\npublic key: key\nsensors: a\nkey type: p256\nissued: 7");
    expect(m.deviceMessage("0xab", "key", "ed25519", ["a", "b"], 7)).toBe(m.sourceMessage("0xab", "key", ["a", "b"], 7));
    expect(m.deviceMessage("0xab", "key", "", ["a"], 7)).toBe(m.sourceMessage("0xab", "key", ["a"], 7));
    expect(m.deviceMessage("0xab", "k", "webauthn", ["s"], 1)).toBe("CargoFlow evidence source\nshipment: 0xab\npublic key: k\nsensors: s\nkey type: webauthn\nissued: 1");
  });

  it("notifications read (wallet.go NotificationsReadAuthorization; the API signs ids lower-cased and comma-joined, or all)", () => {
    expect(m.notificationsReadMessage("0xDEF", "all", 9)).toBe("CargoFlow notifications read\naddress: 0xdef\nids: all\nissued: 9");
    expect(m.notificationsReadMessage("0xdef", [], 9)).toBe("CargoFlow notifications read\naddress: 0xdef\nids: all\nissued: 9");
    expect(m.notificationsReadMessage("0xdef", ["AA-1", "bb-2"], 9)).toBe("CargoFlow notifications read\naddress: 0xdef\nids: aa-1,bb-2\nissued: 9");
  });
});
