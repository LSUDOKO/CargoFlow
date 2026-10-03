"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useRef, useState } from "react";
import { useAccount } from "wagmi";
import { signMessage } from "wagmi/actions";
import { nowSec, writeError } from "@/lib/api/market";
import { wagmiConfig } from "@/lib/chain/config";
import { signatureError } from "@/lib/chain/errors";

/**
 * One wallet-signed API write: build the message for a fresh `issuedAt`, ask the wallet to sign it (no gas), send
 * it, then refresh the marketplace. Signatures are single-use on the backend, so every attempt signs anew.
 */
export function useSigned() {
  const { address } = useAccount();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<"sign" | "send" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const guard = useRef(false);

  const run = useCallback(
    async <T>(message: (issuedAt: number) => string, post: (issuedAt: number, signature: string) => Promise<T>, fallback: string): Promise<T | undefined> => {
      if (!address || guard.current) return undefined;
      guard.current = true;
      setError(null);
      const issuedAt = nowSec();
      try {
        let signature: string;
        try {
          setBusy("sign");
          signature = await signMessage(wagmiConfig, { account: address, message: message(issuedAt) });
        } catch (err) {
          setError(signatureError(err));
          return undefined;
        }
        try {
          setBusy("send");
          const out = await post(issuedAt, signature);
          await qc.invalidateQueries({ queryKey: ["requests"] });
          return out;
        } catch (err) {
          setError(writeError(err, fallback));
          return undefined;
        }
      } finally {
        guard.current = false;
        setBusy(null);
      }
    },
    [address, qc],
  );

  return { run, busy, error, setError, address };
}
