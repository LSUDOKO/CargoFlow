// The EIP-1193 face of a passkey smart account. wagmi talks to this provider exactly as it talks to a browser wallet;
// each request is routed to the Kernel account (transactions become user operations, signatures become EIP-1271
// signatures) or, for plain reads, to the chain's RPC. It holds no SDK code so the routing can be unit-tested.
import { BaseError, isHex, numberToHex, type Address, type Hex } from "viem";

export type Call = { to: Address; data?: Hex; value?: bigint };

export type KernelDeps = {
  address: Address;
  chainId: number;
  /** Sends one or more calls as a single user operation and resolves to the bundled transaction's hash. */
  sendCalls: (calls: Call[]) => Promise<Hex>;
  /** An EIP-1271 signature over the EIP-191 hash of `message` (the account is deployed first when needed). */
  signMessage: (message: { raw: Hex } | string) => Promise<Hex>;
  signTypedData: (typedData: Record<string, unknown>) => Promise<Hex>;
  /** Any other method, answered by the chain's RPC. */
  rpc: (method: string, params?: unknown) => Promise<unknown>;
};

/** An EIP-1193 error with a standard code (4001 user rejected, 4100 unauthorized, 4200 unsupported, 4902 unknown chain). */
export class ProviderRpcError extends Error {
  constructor(
    public code: number,
    message: string,
  ) {
    super(message);
    this.name = "ProviderRpcError";
  }
}

/**
 * A transaction a passkey account cannot pay for: the paymaster declined and the account has no ETH. It extends
 * viem's BaseError so viem passes it through unchanged and the app can show this exact sentence.
 */
export class PasskeyGasError extends BaseError {
  override name = "PasskeyGasError";
  constructor() {
    super("Gas sponsorship isn't on; this account needs a little testnet ETH.");
  }
}

/** True when the error comes from the paymaster declining to sponsor (no gas policy, policy limit, paymaster down). */
export function isPaymasterRefusal(err: unknown): boolean {
  const text = errorText(err);
  return /paymaster|sponsor|gas policy|no policy|policy (not|limit)|zd_|pm_/i.test(text) && !/user (rejected|denied)|notallowed/i.test(text);
}

/** True when a self-paid user operation failed because the account cannot cover its gas. */
export function isPrefundError(err: unknown): boolean {
  return /AA21|didn't pay prefund|insufficient (funds|balance)|prefund/i.test(errorText(err));
}

/** True when the person dismissed the passkey prompt (WebAuthn NotAllowedError / AbortError). */
export function isPasskeyCancel(err: unknown): boolean {
  const e = err as { name?: string } | null;
  return e?.name === "NotAllowedError" || e?.name === "AbortError" || /NotAllowedError|operation either timed out or was not allowed|cancel/i.test(errorText(err));
}

function errorText(err: unknown): string {
  const parts: string[] = [];
  let e: unknown = err;
  for (let i = 0; e && i < 6; i++) {
    const x = e as { name?: string; message?: string; shortMessage?: string; details?: string; cause?: unknown };
    parts.push(x.name ?? "", x.shortMessage ?? "", x.message ?? "", x.details ?? "");
    e = x.cause;
  }
  return parts.join(" ");
}

type TxParams = { to?: Address; data?: Hex; input?: Hex; value?: Hex | bigint | number | string; from?: Address };

const toValue = (v: TxParams["value"]): bigint => (v === undefined || v === null || v === "" ? 0n : BigInt(v as string | number | bigint));

function toCall(tx: TxParams): Call {
  if (!tx?.to) throw new ProviderRpcError(-32602, "A passkey account cannot deploy contracts: the transaction needs a `to` address.");
  return { to: tx.to, data: tx.data ?? tx.input ?? "0x", value: toValue(tx.value) };
}

/** Wraps a dependency call: a dismissed passkey prompt becomes EIP-1193 4001 (viem: UserRejectedRequestError). */
async function guard<T>(f: () => Promise<T>): Promise<T> {
  try {
    return await f();
  } catch (err) {
    if (err instanceof ProviderRpcError || err instanceof PasskeyGasError) throw err;
    if (isPasskeyCancel(err)) throw new ProviderRpcError(4001, "User rejected the request.");
    throw err;
  }
}

export type KernelProvider = {
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
  on: (event: string, listener: (...args: unknown[]) => void) => void;
  removeListener: (event: string, listener: (...args: unknown[]) => void) => void;
};

/** The EIP-1193 provider for one connected passkey account. */
export function createKernelProvider(deps: KernelDeps): KernelProvider {
  const self = deps.address.toLowerCase();
  const own = (addr: unknown) => {
    if (typeof addr === "string" && isHex(addr) && addr.length === 42 && addr.toLowerCase() !== self) {
      throw new ProviderRpcError(4100, "This passkey account can only sign for its own address.");
    }
  };

  async function request({ method, params }: { method: string; params?: unknown }): Promise<unknown> {
    const p = (Array.isArray(params) ? params : params === undefined ? [] : [params]) as unknown[];
    switch (method) {
      case "eth_accounts":
      case "eth_requestAccounts":
        return [deps.address];
      case "eth_chainId":
        return numberToHex(deps.chainId);
      case "net_version":
        return String(deps.chainId);
      case "wallet_switchEthereumChain": {
        const want = Number((p[0] as { chainId?: Hex } | undefined)?.chainId ?? NaN);
        if (want === deps.chainId) return null;
        throw new ProviderRpcError(4902, "Passkey accounts run on Robinhood Chain Testnet only.");
      }
      case "eth_sendTransaction":
      case "wallet_sendTransaction": {
        const tx = p[0] as TxParams;
        own(tx?.from);
        return guard(() => deps.sendCalls([toCall(tx)]));
      }
      case "wallet_sendCalls": {
        const req = p[0] as { calls?: TxParams[]; from?: Address; chainId?: Hex } | undefined;
        if (!req?.calls?.length) throw new ProviderRpcError(-32602, "wallet_sendCalls needs at least one call.");
        own(req.from);
        if (req.chainId !== undefined && Number(req.chainId) !== deps.chainId) throw new ProviderRpcError(4902, "Passkey accounts run on Robinhood Chain Testnet only.");
        const hash = await guard(() => deps.sendCalls(req.calls!.map(toCall)));
        // the batch id is the transaction hash: the user operation has already been included when it resolves
        return { id: hash };
      }
      case "wallet_getCallsStatus": {
        const id = p[0] as Hex;
        const receipt = (await deps.rpc("eth_getTransactionReceipt", [id])) as { status?: Hex; logs?: unknown[]; blockHash?: Hex; blockNumber?: Hex; gasUsed?: Hex; transactionHash?: Hex } | null;
        return {
          version: "2.0.0",
          id,
          chainId: numberToHex(deps.chainId),
          atomic: true,
          status: !receipt ? 100 : receipt.status === "0x1" ? 200 : 500,
          receipts: receipt ? [{ logs: receipt.logs ?? [], status: receipt.status, blockHash: receipt.blockHash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed, transactionHash: receipt.transactionHash }] : [],
        };
      }
      case "wallet_getCapabilities":
        return { [numberToHex(deps.chainId)]: { atomic: { status: "supported" } } };
      case "personal_sign": {
        const [message, address] = p as [string, string];
        own(address);
        // viem sends the message hex-encoded; a plain string is signed as text
        return guard(() => deps.signMessage(isHex(message) ? { raw: message } : message));
      }
      case "eth_sign": {
        const [address, message] = p as [string, Hex];
        own(address);
        return guard(() => deps.signMessage({ raw: message }));
      }
      case "eth_signTypedData":
      case "eth_signTypedData_v4": {
        const [address, data] = p as [string, string | Record<string, unknown>];
        own(address);
        const typed = typeof data === "string" ? (JSON.parse(data) as Record<string, unknown>) : data;
        return guard(() => deps.signTypedData(typed));
      }
      case "eth_signTransaction":
      case "eth_sendRawTransaction":
      case "wallet_addEthereumChain":
      case "wallet_watchAsset":
        throw new ProviderRpcError(4200, `${method} is not supported by passkey accounts.`);
      default:
        return deps.rpc(method, params);
    }
  }

  return { request, on: () => {}, removeListener: () => {} };
}
