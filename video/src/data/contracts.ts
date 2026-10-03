// Source-verified deployments on Robinhood Chain Testnet (chain 46630).
// Copied from the "Deployed contracts" table in the repo README.
export const CONTRACTS = [
  {
    name: "USDG (Paxos)",
    address: "0x7E955252E15c84f5768B83c41a71F9eba181802F",
  },
  {
    name: "ReceivableVault",
    address: "0x5298dCdBDf6EC799475B09c2Ecd0f089bD4D6902",
  },
  {
    name: "FinancingController",
    address: "0xA2E708376CDDf0eb8fa746c43089611B4d49E210",
  },
  {
    name: "EvidenceRegistry",
    address: "0x4aD47799586B4793b7952BA849013F5D0eC2e66a",
  },
  {
    name: "PolicyEngine",
    address: "0x93f2cd67f404f62Ff34F729aad1118ea9e1582d0",
  },
  {
    name: "ShipmentRegistry",
    address: "0x2f7cAc603654eC106dA242cD0b16044b31f7608d",
  },
  {
    name: "Groth16Verifier",
    address: "0x1BAa24a99A9Fe8Cd53feB30E5dF098D1334E0a8D",
  },
  {
    name: "CargoFlowAccess",
    address: "0x5Ed4f105E3c3C0a67f916c0fc339B261E3De81d7",
  },
] as const;

export const short = (h: string, a = 6, b = 4) =>
  `${h.slice(0, a)}…${h.slice(-b)}`;
