import { getAddress, type Address } from "viem";

/**
 * Where the CargoFlow contracts live on one chain. `coverPool` exists on contracts v2 and later; `deviceRegistry` and
 * `eblRegistry` on contracts v3 (each optional there too: absent turns that feature off).
 */
export interface CargoFlowAddresses {
  chainId: number;
  usdg: Address;
  access: Address;
  shipmentRegistry: Address;
  policyEngine: Address;
  evidenceRegistry: Address;
  receivableVault: Address;
  financingController: Address;
  groth16Verifier?: Address;
  coverPool?: Address;
  deviceRegistry?: Address;
  eblRegistry?: Address;
}

const REQUIRED = ["usdg", "access", "shipmentRegistry", "policyEngine", "evidenceRegistry", "receivableVault", "financingController"] as const;

/**
 * Checksummed contract addresses from the API's `/v1/config` response (`client.config()`), or from any object with
 * `chainId` and a `contracts` record using the same names.
 */
export function addresses(config: { chainId: number; contracts: Record<string, unknown> }): CargoFlowAddresses {
  const c = config.contracts as Record<string, string | undefined>;
  for (const k of REQUIRED) if (typeof c[k] !== "string" || !c[k]) throw new Error(`The configuration has no address for ${k}.`);
  const opt = (v: unknown) => (typeof v === "string" && v ? getAddress(v) : undefined);
  return {
    chainId: config.chainId,
    usdg: getAddress(c.usdg!),
    access: getAddress(c.access!),
    shipmentRegistry: getAddress(c.shipmentRegistry!),
    policyEngine: getAddress(c.policyEngine!),
    evidenceRegistry: getAddress(c.evidenceRegistry!),
    receivableVault: getAddress(c.receivableVault!),
    financingController: getAddress(c.financingController!),
    groth16Verifier: opt(c.groth16Verifier),
    coverPool: opt(c.coverPool),
    deviceRegistry: opt(c.deviceRegistry),
    eblRegistry: opt(c.eblRegistry),
  };
}
