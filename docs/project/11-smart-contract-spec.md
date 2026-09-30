# Smart Contract Specification

## 1. Contract map

Recommended contracts:

```text
ShipmentRegistry.sol
PolicyEngine.sol
EvidenceRegistry.sol
FinancingController.sol
ReceivableVault.sol
Groth16Verifier.sol   (generated / audited verifier)
AccessManager.sol     (or OpenZeppelin AccessControl/AccessManager)
```

Optional later:

```text
EvidenceReputation.sol
ChallengeMarket.sol
InsurancePool.sol
ReceivableShareVault.sol
ArbitrationManager.sol
```

## 2. ShipmentRegistry.sol

### Responsibility
Canonical shipment identity and immutable commercial commitments.

### Suggested storage

```solidity
struct Shipment {
    address exporter;
    address buyer;
    bytes32 invoiceHash;
    bytes32 routeCommitment;
    bytes32 policyCommitment;
    uint256 invoiceValue;
    uint64 createdAt;
    bool exists;
}
```

### Functions

```solidity
registerShipment(...)
getShipment(shipmentId)
setPolicyCommitment(...)
```

Prefer making policy commitment immutable after facility funding.

## 3. PolicyEngine.sol

Stores policy parameters or policy hashes.

Possible fields:

```solidity
struct Policy {
    uint32 minTempX100;
    uint32 maxTempX100;
    uint32 maxEvidenceAgeSec;
    uint32 maxRouteDeviationM;
    uint16 minEvidenceScore;
    uint16 maxConflictBps;
    uint16 maxRiskBps;
    bool requiresZK;
}
```

## 4. EvidenceRegistry.sol

Stores compact evidence state:

```solidity
struct EvidenceEpoch {
    bytes32 merkleRoot;
    uint64 startTime;
    uint64 endTime;
    uint32 score;
    uint32 conflictBps;
    uint32 riskBps;
    bool compliant;
}
```

The contract should not store raw telemetry arrays.

## 5. FinancingController.sol

Main state machine.

Recommended states:

```text
CREATED
FINANCED
ACTIVE / IN_TRANSIT
PAUSED
DISPUTED
ARBITRATION
DELIVERED
SETTLED
DEFAULTED
```

### Core functions

```solidity
createFacility(...)
depositCapital(...)
startTransit(...)
evaluateAndReleaseMilestone(...)
pauseFinancing(...)
resumeWithProof(...)
openDispute(...)
resolveDispute(...)
markDelivered(...)
settle(...)
```

## 6. ReceivableVault.sol

The vault is the only contract that custody-transfers USDG for the facility.

### Suggested facility

```solidity
struct Facility {
    address financier;
    address supplier;
    uint256 committed;
    uint256 drawn;
    uint256 financingFeeBps;
    uint256 invoiceValue;
    bool paused;
    bool settled;
}
```

### Core invariants

```text
committed >= drawn
settled => no future release
paused => no future release
supplier recipient == registered supplier
```

## 7. Roles

Recommended:

```text
DEFAULT_ADMIN_ROLE
FACILITY_MANAGER_ROLE
CONTROLLER_ROLE
EVIDENCE_VERIFIER_ROLE
MONITOR_ROLE
DISPUTE_ROLE
```

The AI monitor should not have a generic token-transfer role.

## 8. USDG interaction

The vault should use SafeERC20-style safe token handling and approve/transferFrom carefully.

Expected funding pattern:

```text
financier
  └─ approve(vault, amount)
        ↓
vault.depositCapital(shipmentId, amount)
        ↓
vault receives USDG
```

Expected release:

```text
controller.evaluateAndReleaseMilestone(...)
        ↓
vault.releaseAdvance(...)
        ↓
USDG → supplier
```

## 9. Settlement

Recommended split of responsibility:

- controller confirms facility is deliverable/settleable;
- vault performs accounting and transfers;
- registry records final state.

## 10. Events

At minimum:

```solidity
event ShipmentRegistered(...);
event FacilityCreated(...);
event CapitalDeposited(...);
event MilestoneEvaluated(...);
event MilestoneAdvanceReleased(...);
event FinancingPaused(...);
event FinancingResumed(...);
event EvidenceEpochCommitted(...);
event DisputeOpened(...);
event DisputeResolved(...);
event DeliveryConfirmed(...);
event FacilitySettled(...);
```

## 11. Custom errors

Prefer custom errors over long revert strings in production contracts:

```solidity
error FacilityNotFound();
error FacilityPaused();
error FacilitySettled();
error MilestoneAlreadyReleased();
error EvidenceBelowThreshold();
error UnauthorizedMonitor();
error InvalidProofContext();
error ExceedsCommittedFacility();
```

## 12. Contract review checklist

Before deployment:

- Reentrancy protection where token transfers occur.
- Access-control review.
- Checks-effects-interactions discipline.
- Integer range checks.
- No floating point.
- No user-controlled arbitrary token destination.
- No upgradeability in the core demo unless required.
- Pause semantics explicit.
- Event completeness.
- Fuzz/invariant tests.
- Verify source code on explorer.
