# USDG and Robinhood Chain Integration

## 1. Verified current testnet values

### Robinhood Chain Testnet

- Chain ID: `46630`
- RPC: `https://rpc.testnet.chain.robinhood.com`
- Explorer: `https://explorer.testnet.chain.robinhood.com`
- Native gas asset: ETH

### USDG on Robinhood Chain Testnet

- USDG contract: `0x7E955252E15c84f5768B83c41a71F9eba181802F`
- Paxos testnet docs explicitly state testnet tokens have no value.
- Paxos also lists the Arbitrum Sepolia USDG token as `0xFFC95faa3d63Cde504a05B567C600B78C0b41892`.

### Robinhood Chain Mainnet reference

- Chain ID: `4663`
- USDG: `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168`

Do not use mainnet in the hackathon demo.

## 2. Faucet / setup references

Robinhood Chain Testnet faucet:

`https://faucet.testnet.chain.robinhood.com/`

Paxos USDG faucet:

`https://faucet.paxos.com/?network=robinhood`

Network helper:

`https://docs.robinhood.com/chain/add-network-to-wallet/`

Contract deployment guide:

`https://docs.robinhood.com/chain/deploy-smart-contracts/`

## 3. Why USDG is central

Use a single stable settlement asset in the demo to make the financial state easy to reason about.

```text
Facility denomination       USDG
Escrow balance              USDG
Milestone advance           USDG
Invoice payment             USDG
Financier repayment         USDG
Exporter residual            USDG
```

## 4. USDG precision

ERC-20 tokens can have different decimals. The exact token metadata should be read from the deployed address rather than hard-coded from memory.

The source design assumes USDG uses six-decimal accounting. The implementation must query and test the actual testnet token contract before finalizing arithmetic.

## 5. Transaction flow

### Deposit

```text
Financier wallet
  ↓ approve(ReceivableVault, 40_000 USDG)
ReceivableVault.depositCapital(...)
```

### Advance

```text
FinancingController
  ↓ releaseAdvance(...)
ReceivableVault
  ↓ transfer
Exporter
```

### Settlement

```text
Buyer
  ↓ transferFrom 100,000 USDG
ReceivableVault
  ├─ 40,000 principal → financier
  ├─ 1,200 fee → financier  (demo parameter)
  └─ 58,800 residual → exporter
```

## 6. Paxos claims to use carefully

Current Paxos documentation describes USDG as a single-currency US-dollar stablecoin issued by Paxos Digital Singapore, designed for payments, settlements and treasury, with 1:1 redeemability. Use those documented properties rather than adding unsupported economics to the pitch.

## 7. Robinhood Chain role

Robinhood Chain is the best place in this architecture for the user-visible financial contracts because it lets the buildathon entry visibly use a target Arbitrum ecosystem chain and directly integrate USDG.

## 8. Stylus boundary

Arbitrum's official docs support Stylus/Rust/WASM for Arbitrum chains. Because direct Stylus support on Robinhood Chain is not established in the current public docs used for this plan, the safe implementation plan is:

```text
Robinhood Chain:
  Solidity financial layer

Arbitrum Sepolia:
  optional Stylus EvidenceEngine
```

If a current official Robinhood source confirms Stylus support during implementation, revisit the split.

## 9. Interoperability (future)

Paxos documents USDG deployments on multiple networks and lists OFT contracts for supported mainnets. CargoFlow can later coordinate cross-chain finance, but this should not be part of the critical hackathon path.
