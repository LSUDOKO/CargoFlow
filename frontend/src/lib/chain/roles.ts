import { keccak256, toBytes } from "viem";

/** `Roles.DISPUTE_ROLE` in the contracts: the wallet that may resolve disputes, lift pauses and declare defaults. */
export const DISPUTE_ROLE = keccak256(toBytes("DISPUTE_ROLE"));

/** `Roles.CARRIER_ROLE` (contracts v3): the wallet that may issue electronic bills of lading. */
export const CARRIER_ROLE = keccak256(toBytes("CARRIER_ROLE"));
