<p align="center"><img src="../assets/v3/cast.png" alt="The CargoFlow cast: Meera the exporter, Daniel the financier, Wei Lin the buyer, the carrier, the insurer and the arbiter, each with a one-line role." width="100%"></p>

# Role guides

One guide per party, told by the character who plays that role in the demo film. Each step shows the live website or
the film's animation and names the exact contract call, with transaction links from the real testnet runs of
3 October 2026 (`CF-SG-VAX-0202` end to end, `CF-SG-VAX-0401` for the passkey payment).

| Guide | Told by | What you do | Your transactions |
|---|---|---|---|
| [Exporter](exporter.md) | Meera | register the shipment, policy and facility; bind the bill of lading; send signed readings; resume with a proof | `registerShipment`, `setPolicy`, `createFacility`, `bindTitle`, `startTransit`, `resumeWithProof` |
| [Financier](financier.md) | Daniel | find or offer on a facility; approve and deposit; watch the evidence (or ask Claude); optional cover | `approve`, `depositCapital`, `acceptCover`, `openDispute` |
| [Buyer](buyer.md) | Wei Lin | sign in with a passkey; confirm delivery; pay; receive the title and the certificate | `markDelivered`, `approve`, `settle` (as ERC-4337 user operations with a passkey) |
| [Carrier](carrier.md) | the ship's officer | issue the electronic bill of lading; it then follows the money | `issue`, `voidBill` |
| [Arbiter](arbiter.md) | the referee | pause, resume on a verified basis, resolve disputes, declare a default; never release | `pauseFinancing`, `resumeByVerifier`, `resolveDispute`, `markDefaulted` |

The insurer (default and parametric cover) appears in the [financier guide](financier.md#4--optional-cover). The
characters are illustrative; the transactions are real. Back to the [README](../../README.md) or the
[docs index](../README.md).
