# Research and Technical References

This file distinguishes **authoritative technical references** from **research/context references**. URLs should be rechecked before final submission because documentation and testnet details can change.

## A. Hackathon

### Arbitrum Open House Singapore — HackQuest

https://www.hackquest.io/hackathons/Arbitrum-Open-House-Singapore-Online-Buildathon

Use for current rules, judging criteria, deadlines, prizes, and required ecosystem resources.

## B. Arbitrum

### Arbitrum developer docs

https://docs.arbitrum.io/

General chain/developer reference.

### Arbitrum bridge quickstart

https://docs.arbitrum.io/arbitrum-bridge/quickstart

Network parameters and bridge guidance.

### Stylus Rust SDK guide

https://docs.arbitrum.io/stylus/reference/rust-sdk-guide

Rust/WASM smart-contract development.

### Stylus gas metering

https://docs.arbitrum.io/stylus/concepts/gas-metering

Use when discussing compute/memory pricing. Do not copy a CargoFlow gas-saving claim without benchmarking.

### Stylus SDK GitHub

https://github.com/OffchainLabs/stylus-sdk-rs

Reference implementation / SDK source.

## C. Robinhood Chain

### Add Robinhood Chain to wallet

https://docs.robinhood.com/chain/add-network-to-wallet/

### Deploy a smart contract

https://docs.robinhood.com/chain/deploy-smart-contracts/

### Robinhood Chain overview / consumer support

https://robinhood.com/us/en/support/articles/robinhood-chain-mainnet/

### Robinhood Chain Testnet faucet

https://faucet.testnet.chain.robinhood.com/

### Add testnet to wallet

https://faucet.testnet.chain.robinhood.com/add-chain

## D. Paxos USDG

### USDG overview

https://docs.paxos.com/guides/stablecoin/usdg

Use for documented product properties and intended payment/settlement use.

### USDG on test networks

https://docs.paxos.com/guides/stablecoin/usdg/testnet

Current testnet addresses.

### USDG on main networks

https://docs.paxos.com/guides/stablecoin/usdg/mainnet

Mainnet addresses and OFT information.

### USDG quickstart

https://docs.paxos.com/guides/stablecoin/usdg/quickstart

Integration/access overview.

### USDG support guide

https://support.paxos.com/articles/9941304152-getting-started-with-usdg-global-dollar

Current general usage information.

### USDG testnet faucet

https://faucet.paxos.com/?network=robinhood

## E. Ethereum standards

### ERC-4626

https://eips.ethereum.org/EIPS/eip-4626

Standard tokenized-vault interface.

### ERC-7540

https://eips.ethereum.org/EIPS/eip-7540

Asynchronous extension to ERC-4626, useful for RWA-style pending request flows.

## F. Electronic trade documents

### UNCITRAL MLETR

https://uncitral.un.org/en/texts/ecommerce/modellaw/electronic_transferable_records

Technology-neutral legal model for electronic transferable records such as bills of lading and warehouse receipts.

## G. Cross-chain USDG / OFT

### LayerZero OFT docs

https://docs.layerzero.network/v2/developers/evm/oft/quickstart

Use only if the current USDG network deployment and CargoFlow use case justify cross-chain settlement.

## H. Research papers

### AgentReputation — arXiv:2605.00073

https://arxiv.org/abs/2605.00073

Key idea: context-conditioned reputation and verification strength.

### TessPay — arXiv:2602.00213

https://arxiv.org/abs/2602.00213

Key idea: verify-then-pay, escrow, cryptographic execution evidence, auditability.

### Secure Autonomous Agent Payments — arXiv:2511.15712

https://arxiv.org/abs/2511.15712

Key idea: agent identity, intent, ZK compliance, TEE-backed execution integrity.

### Privacy-Preserving Compliance / SDAS — arXiv:2606.20760

https://arxiv.org/abs/2606.20760

Key idea: context-aware sender binding and proof-reuse resistance.

### Accelerated carrier invoice factoring — arXiv:2203.02799

https://arxiv.org/abs/2203.02799

Key idea: transport milestones can support earlier factoring decisions.

### Stablecoin adoption in agriculture finance — arXiv:2507.14970

https://arxiv.org/abs/2507.14970

Key idea: stablecoins can reduce some transaction/credit frictions for agricultural supply chains; also highlights constraints.

### RWA-PoB — arXiv:2608.25269

https://arxiv.org/abs/2608.25269

Key idea: distinguish integrity of backing claims from independent proof of real-world asset existence/condition.

### Agentic Settlement Protocol — arXiv:2609.02208

https://arxiv.org/abs/2609.02208

Key idea: delayed-fulfilment escrow for agent commerce is an active design/research space.

### OreProof — arXiv:2609.00340

https://arxiv.org/abs/2609.00340

Key idea: ZK + Merkle batching + selective disclosure for physical provenance is already an active pattern; CargoFlow should differentiate on financing state transitions.

## I. Dempster-Shafer / sensor fusion references from the source document

### Sensor Data Fusion for Detection of Faults using Dempster-Shafer

https://arxiv.org/pdf/1906.09769

### Decision Fusion using Dempster-Shafer Theory

https://udrc.eng.ed.ac.uk/sites/udrc.eng.ed.ac.uk/files/publications/Decision%20Fusion%20using%20Dempster_Schaffer%20Theory.pdf

## J. Additional source-document context references

These were present in the supplied source document. They are useful for background, but should not automatically be treated as authoritative for protocol claims:

- 1kx trade-finance thesis: https://1kx.capital/writing/the-rewiring-of-trade-finance
- Integrating simulation and decision trees through blockchain: https://shura.shu.ac.uk/36281/1/s10479-025-06858-4.pdf
- SCMDOJO financial supply chain management: https://www.scmdojo.com/financial-supply-chain-management-explained/
- NNRV Structured Trade Finance: https://nnrvtradepartners.com/structured-trade-finance-stf/
- VLR supply-chain finance article: https://vlr.vn/supply-chain-finance-when-cash-flow-becomes-the-invisible-logistics-of-vietnamese-businesses-26340.html
- PaySprint supply-chain escrow article: https://www.paysprint.in/blog-details.html?slug=supply-chain
- CoinDesk USDG reference: https://www.coindesk.com/price/global-dollar
- RedStone Stylus article: https://www.redstone.finance/blog/arbitrum-stylus-wasm-superior-performance-beyond-evm-limitations/
- QuickNode Arbitrum Nitro explainer: https://www.quicknode.com/blog/arbitrum-nitro-explained
- Offchain Labs Stylus nanoGPT example: https://github.com/OffchainLabs/stylus-nanoGPT
- Global Dollar Network announcement: https://www.paxos.com/newsroom/introducing-global-dollar-network-an-open-network-to-accelerate-and-reward-global-stablecoin-adoption-driven-by-anchorage-digital-bullish-galaxy-digital-kraken-nuvei-paxos-and-robinhood

## Citation discipline

For the final hackathon submission:

- Prefer official Arbitrum, Robinhood, Paxos, Ethereum EIP, and UNCITRAL sources for platform claims.
- Prefer arXiv records for research-paper claims.
- Label secondary web articles as background.
- Never cite the supplied source document as proof that the underlying external fact is true; it is evidence of the project's design history.
