"use client";

import type { Address } from "viem";
import { useConfig as useApiConfig } from "@/lib/api/hooks";

export type Contracts = {
  controller: Address;
  registry: Address;
  policies: Address;
  vault: Address;
  evidence: Address;
  usdg: Address;
  access: Address;
};

/** Deployed contract addresses from the backend's /v1/config, so one build serves every network. */
export function useContracts(): { contracts: Contracts | undefined; chainId: number | undefined; demoMode: boolean } {
  const { data } = useApiConfig();
  if (!data) return { contracts: undefined, chainId: undefined, demoMode: false };
  const c = data.contracts;
  return {
    chainId: data.chainId,
    demoMode: data.demoMode,
    contracts: {
      controller: c.financingController as Address,
      registry: c.shipmentRegistry as Address,
      policies: c.policyEngine as Address,
      vault: c.receivableVault as Address,
      evidence: c.evidenceRegistry as Address,
      usdg: c.usdg as Address,
      access: c.access as Address,
    },
  };
}
