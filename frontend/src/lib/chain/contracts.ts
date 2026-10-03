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
  /** the default-cover pool (contracts v2); undefined on a deployment without one, which hides every cover feature */
  coverPool?: Address;
  /** contracts v3: the evidence device registry; undefined hides the on-chain device badges */
  deviceRegistry?: Address;
  /** contracts v3: the electronic bill of lading registry; undefined hides every bill of lading feature */
  eblRegistry?: Address;
};

/** A configured, non-zero address, or undefined. */
export const optionalAddress = (v: string | undefined): Address | undefined =>
  /^0x[0-9a-fA-F]{40}$/.test(v ?? "") && !/^0x0{40}$/.test(v!) ? (v as Address) : undefined;

/** Deployed contract addresses from the backend's /v1/config, so one build serves every network. */
export function useContracts(): { contracts: Contracts | undefined; chainId: number | undefined } {
  const { data } = useApiConfig();
  if (!data) return { contracts: undefined, chainId: undefined };
  const c = data.contracts;
  return {
    chainId: data.chainId,
    contracts: {
      controller: c.financingController as Address,
      registry: c.shipmentRegistry as Address,
      policies: c.policyEngine as Address,
      vault: c.receivableVault as Address,
      evidence: c.evidenceRegistry as Address,
      usdg: c.usdg as Address,
      access: c.access as Address,
      coverPool: optionalAddress(c.coverPool),
      deviceRegistry: optionalAddress(c.deviceRegistry),
      eblRegistry: optionalAddress(c.eblRegistry ?? c.eblregistry),
    },
  };
}
