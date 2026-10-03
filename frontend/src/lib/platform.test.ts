import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, utf8ToBytes } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import { targetError } from "./api/extras";
import { appPath, notificationsReadMessage, recoveryReady, type Notification } from "./api/notifications";
import { CLAUDE_CODE_REMOTE, claudeNewChat, cursorInstallLink, MCP_URL } from "./developer";
import { assertionChallenge, registrationChallenge } from "./devicePasskey";
import { signingString, sourceAuthorizationMessage } from "./gateway";

const ID = `0x${"Ab".repeat(32)}`;

describe("signed messages (byte-identical to backend/internal/auth/wallet.go)", () => {
  it("marks notifications read: all, or the lower-cased ids", () => {
    expect(notificationsReadMessage("0xABCDEF0000000000000000000000000000000001", [], 1700000000)).toBe(
      "CargoFlow notifications read\naddress: 0xabcdef0000000000000000000000000000000001\nids: all\nissued: 1700000000",
    );
    expect(notificationsReadMessage("0xa", ["AAAA-1", "bbbb-2"], 5)).toBe("CargoFlow notifications read\naddress: 0xa\nids: aaaa-1,bbbb-2\nissued: 5");
  });

  it("signs the key type for a passkey device (auth.DeviceAuthorization), and not for ed25519", () => {
    expect(sourceAuthorizationMessage(ID, "PUB", ["inspection-1"], 9, "webauthn")).toBe(
      `CargoFlow evidence source\nshipment: ${ID.toLowerCase()}\npublic key: PUB\nsensors: inspection-1\nkey type: webauthn\nissued: 9`,
    );
    expect(sourceAuthorizationMessage(ID, "PUB", ["a", "b"], 9)).toBe(`CargoFlow evidence source\nshipment: ${ID.toLowerCase()}\npublic key: PUB\nsensors: a,b\nissued: 9`);
  });
});

describe("passkey device challenges (backend/internal/devicetrust/webauthn.go)", () => {
  it("registers with sha256 of the lower-cased shipment id under the CARGOFLOW-V1-REGISTER prefix", () => {
    expect(bytesToHex(registrationChallenge(ID))).toBe(bytesToHex(sha256(utf8ToBytes(`CARGOFLOW-V1-REGISTER\n${ID.toLowerCase()}`))));
  });
  it("signs requests with sha256 of the CARGOFLOW-V1 signing string", () => {
    const body = '{"points":[]}';
    expect(bytesToHex(assertionChallenge("POST", "/v1/shipments/x/telemetry", 10, body))).toBe(bytesToHex(sha256(utf8ToBytes(signingString("POST", "/v1/shipments/x/telemetry", 10, body)))));
  });
});

describe("alerts: Slack targets", () => {
  it("accepts only Slack incoming-webhook URLs", () => {
    expect(targetError("slack", "https://hooks.slack.com/services/T000/B000/XXXX")).toBeNull();
    expect(targetError("slack", "https://example.com/services/T000")).toMatch(/hooks\.slack\.com/);
    expect(targetError("slack", "http://hooks.slack.com/services/T0/B0/X")).toMatch(/hooks\.slack\.com/);
    expect(targetError("slack", "")).toMatch(/Slack/);
  });
});

describe("notifications", () => {
  const n = (over: Partial<Notification>): Notification => ({ id: "1", address: "0xa", shipmentId: ID.toLowerCase(), kind: "PAUSED", title: "", body: "", link: "", data: {}, readAt: null, createdAt: "2026-10-03T10:00:00Z", ...over });
  it("turns backend links into in-app paths", () => {
    expect(appPath("https://cargoflow.example/track/0xabc?recover=1", "http://localhost:3000")).toBe("/track/0xabc?recover=1");
    expect(appPath("/market/r1")).toBe("/market/r1");
    expect(appPath("https://t.me/bot", "http://localhost:3000")).toBe("https://t.me/bot");
  });
  it("finds a recovery-ready notification for this shipment after the pause", () => {
    const list = [n({ kind: "RECOVERY_READY", id: "2" }), n({ kind: "PAUSED" })];
    expect(recoveryReady(list, ID)?.id).toBe("2");
    expect(recoveryReady(list, ID, Date.parse("2026-10-04T00:00:00Z") / 1000)).toBeNull();
    expect(recoveryReady(list, `0x${"cd".repeat(32)}`)).toBeNull();
  });
});

describe("developer links", () => {
  it("builds the Claude, Claude Code and Cursor install links", () => {
    expect(claudeNewChat("a b&c")).toBe("https://claude.ai/new?q=a%20b%26c");
    expect(CLAUDE_CODE_REMOTE).toBe(`claude mcp add --transport http cargoflow ${MCP_URL}`);
    const link = new URL(cursorInstallLink("https://mcp.example/mcp"));
    expect(link.protocol).toBe("cursor:");
    expect(link.searchParams.get("name")).toBe("cargoflow");
    expect(JSON.parse(atob(link.searchParams.get("config")!))).toEqual({ url: "https://mcp.example/mcp" });
  });
});
