// Contract ABIs by deployment version. v2's signatures are frozen in ./v2.ts. v3 (./v3.ts) only adds to v2
// (cancelFacility, bindTitle, parametric cover, Pausable, DeviceRegistry, EBLRegistry); every v2 function, event
// and error keeps its signature, so the flat exports below are the v3 set and work against a v2 deployment for
// everything v2 has.
import * as v2 from "./v2.js";
import * as v3 from "./v3.js";

export { v2, v3 };

export const {
  financingControllerAbi,
  shipmentRegistryAbi,
  policyEngineAbi,
  evidenceRegistryAbi,
  receivableVaultAbi,
  coverPoolAbi,
  accessAbi,
  usdgAbi,
  deviceRegistryAbi,
  eblRegistryAbi,
} = v3;

/** The ERC-20 surface CargoFlow uses on USDG (approve, allowance, balanceOf, transfer). */
export { erc20Abi } from "viem";
