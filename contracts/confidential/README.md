# Confidential invoice terms (Fhenix CoFHE, Arbitrum Sepolia)

CargoFlow's facility on Robinhood Chain is public by design: commitment, fee, milestones and every evidence epoch
can be checked by anyone. What a trade desk will not publish is the commercial side of the deal: the exporter's
invoice margin and the cold-chain penalty schedule agreed with the buyer. `ConfidentialInvoiceTerms` keeps those as
fully homomorphic ciphertexts on Fhenix CoFHE, keyed by the CargoFlow shipment id, and computes the penalty owed for
a public number of excursion hours without decrypting anything.

This is a separate Foundry project. CoFHE runs on Ethereum Sepolia, Arbitrum Sepolia and Base Sepolia, not on
Robinhood Chain. The target is **Arbitrum Sepolia (421614)**, where the CoFHE TaskManager is live at
`0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9` (the fixed address in `FHE.sol`; code and `acl()` checked on chain on
2026-10-03). The library is Fhenix's `@fhenixprotocol/cofhe-contracts` (not Zama's `fhevm`, a different product).

## What it does

| Function | Who | What |
|---|---|---|
| `setTerms(shipmentId, financier, buyer, margin, marginProof, penaltyPerHour, rateProof, penaltyCap, capProof)` | exporter, once per shipment | stores three `euint64` ciphertexts from encrypted inputs, sets the ACL, publishes `termsCommitment` |
| `acknowledge(shipmentId)` | financier or buyer | records that it decrypted and accepts the terms behind the current commitment |
| `computePenalty(shipmentId, excursionHours)` | exporter, financier, buyer or the reporter | `min(penaltyPerHour * excursionHours, penaltyCap)` under encryption; stores the encrypted result |
| `termsCommitment(shipmentId)` | anyone | `keccak256(chainid, contract, shipmentId, parties, margin/rate/cap handles)`, shown on the CargoFlow dashboard |
| `handles`, `parties`, `status` | anyone | ciphertext handles (useless without ACL permission), parties, timestamps and acknowledgements |

Who can decrypt (CoFHE ACL through `FHE.allow`; decryption itself is off-chain with an ACP signed in the CoFHE
SDK, `decryptForView`):

| Value | Exporter | Financier | Buyer | Reporter / anyone else |
|---|---|---|---|---|
| invoice margin (bps) | yes | yes | **no** (the buyer has no business seeing supplier margin) | no |
| penalty per excursion hour (USDG base units, 6 decimals) | yes | yes | yes | no |
| penalty cap | yes | yes | yes | no |
| computed penalty | yes | yes | yes | no |

Details that matter:

- The multiplication runs in 128 bits (`euint128`), so a 64-bit rate times up to 8,760 hours cannot wrap; the
  result is at most the cap and is cast back to `euint64`. A fuzz test checks the result equals
  `min(rate * hours, cap)` for arbitrary 64-bit rates and caps.
- Terms are write-once: the exporter cannot swap them after the financier and buyer have acknowledged.
- Encrypted inputs are bound to this contract and to the sender by the CoFHE verifier, so an outsider cannot
  replay the exporter's ciphertexts (tested).
- `REPORTER` (constructor argument, can be zero) is the address CargoFlow would use to post excursion hours. It can
  trigger a computation but is never on the ACL.

## What it does not do

- **No bridge.** The Robinhood facility stores nothing new. The link is the shipment id plus the public
  commitment; the CargoFlow dashboard reads both chains and says so.
- **Excursion hours are a public input.** They come from CargoFlow's public evidence epochs on Robinhood Chain. Each
  computation records who supplied the value (`PenaltyComputed`), so any party can check it against the chain and
  recompute; nothing on Arbitrum verifies Robinhood state.
- **No payment.** The penalty is computed and readable by the parties; settling it is outside this contract (a
  confidential token transfer, FHERC20, would be the next step).
- **Not deployed yet.** Built and tested against the official CoFHE mocks; deploying needs Arbitrum Sepolia ETH.

## API version

Written against the current CoFHE stack (compatibility table at
<https://cofhe-docs.fhenix.zone/get-started/introduction/compatibility>): `@fhenixprotocol/cofhe-contracts` 0.2.0,
`@cofhe/mock-contracts` 0.7.1, `@cofhe/foundry-plugin` 0.7.1, solc 0.8.25. In 0.7 the old `InEuint64` input
struct was removed; encrypted inputs are `externalEuint64` handles plus a `bytes` proof, converted with
`FHE.asEuint64(handle, proof)`. Clients encrypt with `@cofhe/sdk` 0.7.x and must target this contract address.

## Build and test

```bash
npm install     # CoFHE contracts, mocks, foundry plugin, OpenZeppelin, forge-std into node_modules
forge build
forge test      # 19 tests: ACL, decryption by ACP, deny path, write-once, replay, penalty maths, fuzz
```

Tests inherit `CofheTest` from `@cofhe/foundry-plugin`, which deploys the CoFHE mock stack (MockTaskManager,
MockACL, MockZkVerifier, MockThresholdNetwork) at the production addresses; `CofheClient` produces encrypted inputs
and ACPs per party in Solidity. `foundry.toml` sets `code_size_limit = 100000` because the mocks exceed EIP-170;
the production contract is well under it.

## Deploy (not run)

```bash
PRIVATE_KEY=0x... REPORTER=0x<cargoflow monitor on Arbitrum Sepolia, optional> \
  forge script script/Deploy.s.sol --rpc-url arbitrum_sepolia --broadcast
```

`arbitrum_sepolia` reads `$ARBITRUM_SEPOLIA_RPC_URL` (`foundry.toml`).
