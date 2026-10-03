"use client";

// The heavy half of passkey accounts, loaded only when someone uses one: the passkey ceremonies against ZeroDev's
// passkey server, the Kernel v3.1 account with the WebAuthn validator, the bundler and the paymaster.
import { createKernelAccount, createKernelAccountClient, createZeroDevPaymasterClient } from "@zerodev/sdk";
import { KERNEL_V3_1, getEntryPoint } from "@zerodev/sdk/constants";
import { PasskeyValidatorContractVersion, toPasskeyValidator } from "@zerodev/passkey-validator";
import { b64ToBytes, findQuoteIndices, hexStringToUint8Array, parseAndNormalizeSig, uint8ArrayToHexString, type WebAuthnKey } from "@zerodev/webauthn-key";
import { createPublicClient, encodeAbiParameters, http, keccak256, type Address, type Hex, type SignableMessage } from "viem";
import { robinhoodTestnet } from "@/lib/chain/config";

import { BUNDLER_URL, PASSKEY_CHAIN_ID, PASSKEY_SERVER_URL, PAYMASTER_URL } from "./env";
import { PasskeyGasError, isPaymasterRefusal, isPrefundError, type Call, type KernelDeps } from "./provider";
import { setPasskeyState, type StoredPasskey } from "./store";

type Swa = typeof import("@simplewebauthn/browser");
type AuthOptions = Parameters<Swa["startAuthentication"]>[0];
type AllowCredentials = Parameters<NonNullable<WebAuthnKey["signMessageCallback"]>>[3];

const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_1;

/** base64 or base64url to bytes (the passkey server answers in either). */
const b64 = (s: string) => b64ToBytes(s.trim());
const toB64Url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${PASSKEY_SERVER_URL}${path}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "include" });
  if (!res.ok) throw new Error(`The passkey server refused the request (${res.status}). Check the ZeroDev project's allowed domains.`);
  return (await res.json()) as T;
}

/** SPKI DER P-256 key to its x and y coordinates (WebCrypto, so no Buffer polyfill is needed). */
async function spkiToXY(spki: Uint8Array): Promise<{ x: Hex; y: Hex }> {
  const key = await crypto.subtle.importKey("spki", spki as BufferSource, { name: "ECDSA", namedCurve: "P-256" }, true, ["verify"]);
  const raw = new Uint8Array(await crypto.subtle.exportKey("raw", key)); // 0x04 || x || y
  return { x: uint8ArrayToHexString(raw.slice(1, 33)), y: uint8ArrayToHexString(raw.slice(33, 65)) };
}

/**
 * Creates a new passkey ("register") or uses one already on this device ("login"), with ZeroDev's passkey server
 * holding only the public key. The same steps as @zerodev/webauthn-key's toWebAuthnKey, minus its Node Buffer use.
 */
export async function obtainPasskey(mode: "register" | "login", name: string): Promise<StoredPasskey> {
  if (!PASSKEY_SERVER_URL) throw new Error("Passkeys are not configured on this deployment.");
  const rpID = window.location.hostname;
  const { startAuthentication, startRegistration } = await import("@simplewebauthn/browser");
  let spki: Uint8Array;
  let authenticatorId: string;
  if (mode === "login") {
    const options = await post<AuthOptions>("/login/options", { rpID });
    const cred = await startAuthentication(options);
    authenticatorId = cred.id;
    const verify = await post<{ verification?: { verified?: boolean }; pubkey?: string; pubKey?: string }>("/login/verify", { cred, rpID });
    if (!verify.verification?.verified) throw new Error("That passkey could not be verified. Try again, or create a new one.");
    const pub = verify.pubkey ?? verify.pubKey;
    if (!pub) throw new Error("The passkey server did not return the passkey's public key.");
    spki = b64(pub);
  } else {
    const options = await post<{ options: Parameters<typeof startRegistration>[0]; userId: string }>("/register/options", { username: name, rpID });
    const cred = await startRegistration(options.options);
    authenticatorId = cred.id;
    const verify = await post<{ verified?: boolean }>("/register/verify", { userId: options.userId, username: name, cred, rpID });
    if (!verify.verified) throw new Error("The new passkey could not be verified. Try again.");
    const pub = (cred.response as { publicKey?: string }).publicKey;
    if (!pub) throw new Error("This browser did not return the passkey's public key. Use a current Chrome, Safari, Edge or Firefox.");
    spki = b64(pub);
  }
  const { x, y } = await spkiToXY(spki);
  return { pubX: x, pubY: y, authenticatorId, authenticatorIdHash: keccak256(uint8ArrayToHexString(b64(authenticatorId))), name };
}

/**
 * Signs with the passkey for the WebAuthn validator. Robinhood Chain Testnet has the RIP-7212 P-256 precompile but
 * is not in the SDK's list of precompile chains, so this sets usePrecompiled (3,450 gas instead of ~330k); the rest
 * mirrors @zerodev/passkey-validator's signMessageUsingWebAuthn, with clientDataJSON decoded as base64url.
 */
async function signWithPasskey(message: SignableMessage, _rpId: string, chainId: number, allowCredentials?: AllowCredentials): Promise<Hex> {
  let content: string;
  if (typeof message === "string") content = message;
  else if (typeof message.raw === "string") content = message.raw;
  else content = uint8ArrayToHexString(message.raw);
  const challenge = toB64Url(hexStringToUint8Array(content.startsWith("0x") ? content.slice(2) : content));
  const { startAuthentication } = await import("@simplewebauthn/browser");
  const cred = await startAuthentication({ challenge, allowCredentials: allowCredentials as AuthOptions["allowCredentials"], userVerification: "required" });
  const authenticatorData = uint8ArrayToHexString(b64(cred.response.authenticatorData));
  const clientDataJSON = new TextDecoder().decode(b64(cred.response.clientDataJSON));
  const { beforeType } = findQuoteIndices(clientDataJSON);
  const { r, s } = parseAndNormalizeSig(uint8ArrayToHexString(b64(cred.response.signature)));
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "bool" }],
    [authenticatorData, clientDataJSON, beforeType, r, s, chainId === PASSKEY_CHAIN_ID],
  );
}

export type KernelSession = { address: Address; deps: KernelDeps; checkSponsorship: () => Promise<void> };

/** Builds the Kernel account for a passkey and the provider dependencies behind it. No prompt happens here. */
export async function openSession(stored: StoredPasskey): Promise<KernelSession> {
  if (!BUNDLER_URL) throw new Error("Passkeys are not configured on this deployment.");
  const publicClient = createPublicClient({ chain: robinhoodTestnet, transport: http() });
  const webAuthnKey: WebAuthnKey = {
    pubX: BigInt(stored.pubX),
    pubY: BigInt(stored.pubY),
    authenticatorId: stored.authenticatorId,
    authenticatorIdHash: stored.authenticatorIdHash,
    rpID: typeof window !== "undefined" ? window.location.hostname : "",
    signMessageCallback: signWithPasskey,
  };
  const validator = await toPasskeyValidator(publicClient, {
    webAuthnKey,
    entryPoint,
    kernelVersion,
    validatorContractVersion: PasskeyValidatorContractVersion.V0_0_3_PATCHED,
  });
  const account = await createKernelAccount(publicClient, { plugins: { sudo: validator }, entryPoint, kernelVersion });
  const paymaster = PAYMASTER_URL ? createZeroDevPaymasterClient({ chain: robinhoodTestnet, transport: http(PAYMASTER_URL) }) : null;
  const sponsored = paymaster
    ? createKernelAccountClient({
        account,
        chain: robinhoodTestnet,
        bundlerTransport: http(BUNDLER_URL),
        client: publicClient,
        paymaster: { getPaymasterData: (userOperation) => paymaster.sponsorUserOperation({ userOperation }) },
      })
    : null;
  const selfPaid = createKernelAccountClient({ account, chain: robinhoodTestnet, bundlerTransport: http(BUNDLER_URL), client: publicClient });
  let sponsorshipOff = !sponsored;
  if (!sponsored) setPasskeyState({ sponsorship: "off" });

  async function sendCalls(calls: Call[]): Promise<Hex> {
    const req = { calls: calls.map((c) => ({ to: c.to, data: c.data ?? "0x", value: c.value ?? 0n })) };
    if (sponsored && !sponsorshipOff) {
      try {
        const hash = await sponsored.sendTransaction(req);
        setPasskeyState({ sponsorship: "on", deployed: true });
        return hash;
      } catch (err) {
        if (!isPaymasterRefusal(err)) throw err;
        // no gas policy (or its limit is reached): the account pays for itself from now on
        sponsorshipOff = true;
        setPasskeyState({ sponsorship: "off" });
      }
    }
    try {
      const hash = await selfPaid.sendTransaction(req);
      setPasskeyState({ deployed: true });
      return hash;
    } catch (err) {
      if (isPrefundError(err)) throw new PasskeyGasError();
      throw err;
    }
  }

  // EIP-1271 needs code at the address: the backend checks isValidSignature on the deployed account, so a brand-new
  // account deploys itself (an empty call to itself) before its first signature.
  async function ensureDeployed() {
    if (await account.isDeployed()) {
      setPasskeyState({ deployed: true });
      return;
    }
    await sendCalls([{ to: account.address, data: "0x", value: 0n }]);
  }

  const deps: KernelDeps = {
    address: account.address,
    chainId: PASSKEY_CHAIN_ID,
    sendCalls,
    signMessage: async (message) => {
      await ensureDeployed();
      return account.signMessage({ message });
    },
    signTypedData: async (typed) => {
      await ensureDeployed();
      return account.signTypedData(typed as Parameters<typeof account.signTypedData>[0]);
    },
    rpc: (method, params) => publicClient.request({ method, params } as never),
  };

  /** Asks the paymaster to sponsor a no-op user operation (stub signature, so no passkey prompt). */
  async function checkSponsorship() {
    void account.isDeployed().then((d) => setPasskeyState({ deployed: d }), () => {});
    if (!sponsored) return;
    setPasskeyState({ sponsorship: "checking" });
    try {
      await sponsored.prepareUserOperation({ calls: [{ to: account.address, data: "0x", value: 0n }] });
      setPasskeyState({ sponsorship: "on" });
    } catch (err) {
      if (isPaymasterRefusal(err)) {
        sponsorshipOff = true;
        setPasskeyState({ sponsorship: "off" });
      } else setPasskeyState({ sponsorship: "unknown" });
    }
  }

  return { address: account.address, deps, checkSponsorship };
}
