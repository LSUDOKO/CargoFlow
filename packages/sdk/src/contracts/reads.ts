// A few on-chain reads the SDK and the MCP server use; anything else is a plain viem readContract with the ABIs.
import type { Hex, PublicClient } from "viem";
import { financingControllerAbi, shipmentRegistryAbi } from "./abis/index.js";
import type { CargoFlowAddresses } from "./addresses.js";

/** ShipmentRegistry.getShipment: parties, invoice hash and value, and the route and policy commitments. */
export async function readOnChainShipment(client: PublicClient, addrs: Pick<CargoFlowAddresses, "shipmentRegistry">, shipmentId: Hex) {
  return client.readContract({ address: addrs.shipmentRegistry, abi: shipmentRegistryAbi, functionName: "getShipment", args: [shipmentId] });
}

/** FinancingController.getFacility: status, parties, committed amount, fee, milestone cursor and pause state. */
export async function readOnChainFacility(client: PublicClient, addrs: Pick<CargoFlowAddresses, "financingController">, shipmentId: Hex) {
  return client.readContract({ address: addrs.financingController, abi: financingControllerAbi, functionName: "getFacility", args: [shipmentId] });
}
