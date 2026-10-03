import { describe, expect, it } from "vitest";
import type { Connector } from "wagmi";
import { connectError } from "./walletErrors";
import { orderWallets, type WalletOption } from "./walletList";

const opt = (id: string, type = "injected", group: WalletOption["group"] = "installed"): WalletOption => ({
  key: id,
  connector: { id, type, uid: id, name: id } as unknown as Connector,
  group,
  name: id,
  hint: "",
  icon: null,
  verb: "",
  waiting: "",
});

describe("orderWallets", () => {
  it("hides the generic injected connector once wallets announce themselves, and drops duplicates", () => {
    const out = orderWallets([opt("injected"), opt("io.metamask"), opt("io.rabby"), opt("io.metamask")], { recent: null, hasLegacyInjected: true });
    expect(out.map((o) => o.connector.id)).toEqual(["io.metamask", "io.rabby"]);
  });

  it("keeps the generic connector only for a legacy window.ethereum wallet", () => {
    expect(orderWallets([opt("injected")], { recent: null, hasLegacyInjected: true })).toHaveLength(1);
    expect(orderWallets([opt("injected")], { recent: null, hasLegacyInjected: false })).toHaveLength(0);
  });

  it("puts the recently used wallet first and badges it", () => {
    const out = orderWallets([opt("io.metamask"), opt("io.rabby"), opt("app.phantom")], { recent: "io.rabby", hasLegacyInjected: false });
    expect(out.map((o) => o.connector.id)).toEqual(["io.rabby", "io.metamask", "app.phantom"]);
    expect(out[0]!.recent).toBe(true);
    expect(out[1]!.recent).toBe(false);
  });
});

describe("connectError", () => {
  it("names the wallet when the person declines", () => {
    const e = Object.assign(new Error("Connection request reset"), { cause: { code: 4001, message: "User rejected the request." } });
    expect(connectError(e, "MetaMask")).toEqual({ message: "You declined the request in MetaMask.", rejected: true });
  });

  it("explains a request already pending in the extension", () => {
    expect(connectError({ code: -32002, message: "Already processing" }, "Rabby Wallet").message).toMatch(/Rabby Wallet already has a request open/);
  });
});
