import { decodeRevert } from "@/lib/chain/errors";

type ErrLike = { name?: string; code?: number; message?: string; shortMessage?: string; cause?: unknown };

/** Walks an error and its causes (viem and wagmi wrap provider errors several levels deep). */
function chain(err: unknown): ErrLike[] {
  const out: ErrLike[] = [];
  let e: unknown = err;
  for (let i = 0; e && typeof e === "object" && i < 6; i++) {
    out.push(e as ErrLike);
    e = (e as ErrLike).cause;
  }
  return out;
}

export type ConnectFailure = { message: string; rejected: boolean };

/** One plain sentence for a failed wallet connection, naming the wallet the person picked. */
export function connectError(err: unknown, wallet: string): ConnectFailure {
  const errs = chain(err);
  const has = (test: (e: ErrLike) => boolean) => errs.some(test);
  const text = errs.map((e) => `${e.name ?? ""} ${e.shortMessage ?? ""} ${e.message ?? ""}`).join(" ");
  if (has((e) => e.code === 4001 || e.name === "UserRejectedRequestError") || /user rejected|user denied|rejected the request/i.test(text)) {
    return { message: `You declined the request in ${wallet}.`, rejected: true };
  }
  if (has((e) => e.code === -32002 || e.name === "ResourceUnavailableRpcError") || /already pending/i.test(text)) {
    return { message: `${wallet} already has a request open. Open ${wallet} to finish or cancel it.`, rejected: false };
  }
  if (has((e) => /ChainNotConfigured|ChainMismatch|SwitchChain|UnsupportedChain/.test(e.name ?? "") || e.code === 4902)) {
    return { message: `${wallet} is on a network CargoFlow does not use. Switch it to Robinhood Chain Testnet, then try again.`, rejected: false };
  }
  if (has((e) => e.name === "ProviderNotFoundError")) {
    return { message: `${wallet} did not respond. Unlock it (or reload the page) and try again.`, rejected: false };
  }
  return { message: decodeRevert(err), rejected: false };
}

/** Plain-language messages for the email (Privy) login. */
export function emailError(err: unknown, stage: "send" | "verify" | "wallet"): string {
  const text = chain(err)
    .map((e) => `${e.name ?? ""} ${e.message ?? ""} ${(e as { privyErrorCode?: string }).privyErrorCode ?? ""}`)
    .join(" ");
  if (/too_many_requests|rate limit|429/i.test(text)) return "Too many attempts. Wait a minute, then try again.";
  if (stage === "verify" && /invalid|incorrect|expired|credentials/i.test(text)) return "That code did not match or has expired. Check the latest email, or send a new code.";
  if (stage === "send" && /invalid.*email|invalid_data/i.test(text)) return "That email address does not look right.";
  if (/network|fetch|failed to fetch|timeout/i.test(text)) return "Could not reach the sign-in service. Check your connection and try again.";
  if (stage === "wallet") return "Your email wallet could not be set up. Try again.";
  return stage === "send" ? "The code could not be sent. Try again." : "The code could not be checked. Try again.";
}
