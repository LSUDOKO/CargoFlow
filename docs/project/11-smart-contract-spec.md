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
CoverPool.sol         (v2: default cover; reads the controller and vault, holds no role)
libraries/GeoDistance.sol (v2: integer distance for place-based milestones)
DeviceRegistry.sol    (v3: evidence device keys and their trust class)
EBLRegistry.sol       (v3: ERC-721 electronic bills of lading)
```

Optional later:

```text
EvidenceReputation.sol
ChallengeMarket.sol
ReceivableShareVault.sol
ArbitrationManager.sol
```

Contracts v2 (design: `docs/superpowers/plans/2026-10-03-contracts-v2.md`) adds place-based milestones,
humidity and shock limits, and default cover. Sections 3, 4, 5 and 6a below give the implemented v2 shapes;
field order is the ABI order.

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

Stores the revealed policy. The registry holds `policyCommitment = keccak256(abi.encode(policy))` (all ten
fields, in order) and `setPolicy` accepts only a policy that hashes to it, once.

```solidity
struct Policy {
    int32 minTempX100;         // °C × 100, signed
    int32 maxTempX100;
    uint32 maxEvidenceAgeSec;
    uint32 maxRouteDeviationM;
    uint16 minEvidenceScore;   // 0..100
    uint16 maxConflictBps;     // 0..10_000
    uint16 maxRiskBps;         // 0..10_000
    bool requiresZK;
    uint16 maxHumidityX100;    // v2: % × 100, 0 = no limit, else <= 10_000
    uint16 maxShockX100;       // v2: g × 100, 0 = no limit
}
```

A humidity or shock maximum above a non-zero limit is a policy failure like a low score: release reverts
`EvidenceBelowPolicy()`, and the off-chain decision pauses with reason `HUMIDITY_LIMIT` / `SHOCK_LIMIT`. The
circuit proves only the temperature band, so such a pause is recovered by the arbiter (`resumeByVerifier`) or
fresh evidence; `resumeWithProof` also requires the recovery epoch's maxima to be within the limits.

## 4. EvidenceRegistry.sol

Stores compact evidence state:

```solidity
struct EvidenceEpoch {
    bytes32 shipmentId;
    bytes32 merkleRoot;
    uint64 startTime;
    uint64 endTime;
    uint64 committedAt;
    uint32 score;            // 0..100
    uint32 conflictBps;      // 0..10_000
    uint32 riskBps;          // 0..10_000
    uint8 milestoneIndex;
    bool compliant;
    bool proofVerified;
    int32 latE6;             // v2: centroid (mean reading position), degrees × 1e6
    int32 lonE6;
    uint16 maxHumidityX100;  // v2: epoch maximum, % × 100
    uint16 maxShockX100;     // v2: epoch maximum, g × 100
}

struct EpochTelemetry { int32 latE6; int32 lonE6; uint16 maxHumidityX100; uint16 maxShockX100; }

function commitEpoch(
    bytes32 shipmentId, uint8 milestoneIndex, uint32 seq, bytes32 merkleRoot,
    uint64 startTime, uint64 endTime, uint32 score, uint32 conflictBps, uint32 riskBps,
    bool compliant, EpochTelemetry calldata telemetry
) external returns (bytes32 epochId);
```

The four aggregates travel as one `EpochTelemetry` tuple (fourteen flat arguments do not fit the legacy
code generator's stack). Latitude must be within ±90e6, longitude within ±180e6 and humidity at most 10,000,
else `InvalidEpoch`. `EvidenceEpochCommitted` is unchanged from v1; the aggregates are emitted in a second
event, `EvidenceTelemetryCommitted(shipmentId, epochId, latE6, lonE6, maxHumidityX100, maxShockX100)`, in
the same transaction.

The contract does not store raw telemetry arrays: only aggregates, never a track.

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
placeCheck(shipmentId, milestoneIndex, seq) -> (bool required, bool inside, uint256 distanceM)  // v2 view
```

### Milestones (v2: place-based)

```solidity
struct MilestoneSpec {
    uint256 allocation;
    uint16 evidenceThreshold;
    bytes32 checkpointCommitment;
    int32 latE6;      // v2: centre of the place, degrees × 1e6
    int32 lonE6;
    uint32 radiusM;   // v2: 0 = no place condition (v1 behaviour), else 1,000..1,000,000 m
}
```

`createFacility` range-checks every milestone's coordinates and a non-zero radius (`InvalidMilestonePlace`).
`evaluateAndReleaseMilestone` checks, in order: the policy (score, compliance, conflict, risk, age, then
humidity / shock), the ZK requirement, then the place. Evidence that passes the policy but whose centroid is
farther than `radiusM` from the place reverts `OutsideMilestonePlace()`: it is neither a failure nor a pause,
the milestone waits for later evidence (the backend records `HELD_NOT_AT_PLACE`). `resumeWithProof` applies
the same policy and place checks to the recovery epoch. The proof context and public signals are unchanged.

Distance is `GeoDistance.distanceM`: an equirectangular projection at the mid latitude on a sphere of radius
6,371,008.8 m, integer only, with a 1-degree cosine table and linear interpolation, the antimeridian taken the
short way. Against a float64 haversine on the same sphere, `|d − h| <= e·h + 1 m` with e = 0.1% / 0.2% /
0.8% for separations up to 500 km and both points within ±60° / ±70° / ±80°, and 0.3% / 0.75% / 3.2% up to
1,000 km. `placeCheck` exposes the exact on-chain value so off-chain code never has to re-derive it.

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

## 6a. CoverPool.sol (v2)

Default cover, immutable, no admin, no role. Constructed with `(access, controller)`; it reads `VAULT` from the
controller and `USDG` from the vault.

```solidity
enum CoverStatus { NONE, ACTIVE, RELEASED, CLAIMED }
struct Offer { uint256 amount; uint16 premiumBps; }
struct Cover {
    address insurer; address financier; uint256 amount; uint256 premium;
    CoverStatus status; uint256 financierPayout; uint256 insurerReturn;
}

offerCover(shipmentId, coverAmount, premiumBps)  // insurer; CREATED|FINANCED; 0 < cover <= committed; premium <= 20%
withdrawOffer(shipmentId)                         // insurer; any time while unaccepted
acceptCover(shipmentId, insurer)                  // financier; CREATED|FINANCED; premium paid straight to the insurer
release(shipmentId)                               // anyone, once SETTLED: whole cover credited to the insurer
claim(shipmentId)                                 // anyone, once DEFAULTED: min(cover, drawn) to the financier, rest to the insurer
withdraw()                                        // pull the caller's credited payouts
```

Invariants (handler-based fuzz campaign in `test/invariant/CoverPool.invariants.t.sol`): the pool's USDG balance
equals open offers + active covers + credited-but-unwithdrawn payouts; a cover pays out at most once; payout +
return equals the cover and the financier's share never exceeds its loss (`drawn`). USDG is assumed to be a plain
ERC-20; an offer that does not arrive in full reverts `UnsupportedToken`.

## 6b. Contracts v3 (additive)

Design: `docs/superpowers/plans/2026-10-03-platform.md` (Phase 3 and "Contracts v3"). Every v2 external
function, struct, event and error keeps its exact signature. Changes visible to v2 callers: `IFinancingController.Status`
gains `CANCELLED` (= 9) and `ICoverPool.CoverStatus` gains `TRIGGERED` (= 4), both appended; the
`FinancingController` constructor gains a 7th argument `ebl` (address(0) disables title binding);
`CoverPool.release` also accepts a CANCELLED facility; `createFacility`, `depositCapital`, `offerCover` and
`acceptCover` revert `EnforcedPause()` while the guardian has paused that contract. New interfaces:
`IFinancingControllerV3`, `ICoverPoolV3`, `IEvidenceRegistryV3`, `IDeviceRegistry`, `IEBLRegistry`.

### FinancingController (v3 additions)

```solidity
uint64 constant CANCEL_TIMEOUT = 14 days;
IEBLRegistry immutable EBL;
function cancelFacility(bytes32 shipmentId);        // exporter|financier; CREATED any time, FINANCED after CANCEL_TIMEOUT
function bindTitle(bytes32 shipmentId, uint256 eblTokenId); // exporter; CREATED|FINANCED; live bill held by the exporter,
                                                    // consignee == buyer or 0; escrowed in the controller (approve first)
function titleOf(bytes32 shipmentId) view returns (bool bound, uint256 tokenId);
function financedAt(bytes32 shipmentId) view returns (uint64);
function pause(); function unpause();               // PAUSER_ROLE
event FacilityCancelled(bytes32 indexed shipmentId, address indexed cancelledBy, uint256 refund);
event TitleBound(bytes32 indexed shipmentId, uint256 indexed tokenId, address indexed exporter);
event TitleReleased(bytes32 indexed shipmentId, uint256 indexed tokenId, address indexed to);
error CancelNotAllowed(); error TitleBindingDisabled(); error TitleAlreadyBound(); error InvalidTitle();
```

Title rule (documents against payment): `settle` -> buyer, `markDefaulted` / `resolveDispute(false)` ->
financier, `cancelFacility` -> exporter. All by `transferFrom` (no receiver callback).

### ReceivableVault (v3 addition)

```solidity
function closeCancelled(bytes32 shipmentId);        // controller only; reverts CannotCancel if anything was drawn
event CapitalReturned(bytes32 indexed shipmentId, address indexed financier, uint256 amount);
error CannotCancel();
```

### EvidenceRegistry (v3 additions)

```solidity
function recordEpochSources(bytes32 epochId, bytes32[] deviceKeyHashes); // worker; once; 1..32 distinct non-zero
function getEpochSources(bytes32 epochId) view returns (bytes32[]);
function epochOrdinal(bytes32 epochId) view returns (uint32);  // 1-based commit order within the shipment
function epochCount(bytes32 shipmentId) view returns (uint32);
event EpochSourcesRecorded(bytes32 indexed epochId, bytes32 indexed shipmentId, bytes32[] deviceKeyHashes);
error SourcesAlreadyRecorded(); error InvalidSources();
```

### DeviceRegistry (new)

```solidity
struct Device { address owner; uint8 deviceClass; bool revoked; uint64 registeredAt; uint64 revokedAt;
                address registeredBy; bytes32 attestationHash; }
function registerDevice(bytes32 deviceKeyHash, uint8 deviceClass, bytes32 attestationHash, address owner);
    // ATTESTOR_ROLE: any class (1, 2 need attestationHash != 0); anyone: class 0 with owner == msg.sender; write-once
function revokeDevice(bytes32 deviceKeyHash, bytes32 reason); // owner or ATTESTOR_ROLE
function getDevice(bytes32) view returns (Device); function isActive(bytes32) view returns (bool);
function deviceClassOf(bytes32) view returns (uint8 deviceClass, bool active); function deviceCount() view returns (uint256);
function pause(); function unpause();               // PAUSER_ROLE (registration only)
event DeviceRegistered(bytes32 indexed deviceKeyHash, address indexed owner, uint8 indexed deviceClass,
                       bytes32 attestationHash, address registeredBy);
event DeviceRevoked(bytes32 indexed deviceKeyHash, address indexed revokedBy, bytes32 reason);
error InvalidDevice(); error DeviceAlreadyRegistered(); error DeviceNotFound(); error DeviceAlreadyRevoked();
error NotDeviceOwnerOrAttestor(); error AttestationRequired();
```

### EBLRegistry (new, OpenZeppelin ERC721 "CargoFlow Electronic Bill of Lading" / CFEBL)

```solidity
enum TitleStatus { NONE, ISSUED, SURRENDERED, VOID }
struct BillOfLading { bytes32 documentHash; address issuer; address shipper; address consignee;
                      TitleStatus status; uint64 issuedAt; uint64 closedAt; uint32 transfers; }
function issue(bytes32 documentHash, address shipper, address consignee) returns (uint256 tokenId); // CARRIER_ROLE
function surrender(uint256 tokenId);                // holder -> issuer, frozen SURRENDERED
function voidBill(uint256 tokenId, bytes32 reason); // issuer, while it holds a live bill
function getBill(uint256) view returns (BillOfLading); function tokenIdForDocument(bytes32) view returns (uint256);
event BillIssued(uint256 indexed tokenId, address indexed issuer, address indexed shipper, address consignee, bytes32 documentHash);
event BillSurrendered(uint256 indexed tokenId, address indexed holder, address indexed issuer);
event BillVoided(uint256 indexed tokenId, address indexed issuer, bytes32 reason);
error InvalidBill(); error DocumentAlreadyIssued(); error BillNotFound(); error NotHolder(); error NotIssuer();
error TitleNotTransferable(TitleStatus status);
```

Only an ISSUED bill moves; titles are never burnt. Designed around MLETR concepts; not a legal compliance claim.

### CoverPool (v3 additions)

```solidity
struct ParametricTrigger { uint8 consecutiveFailedEpochs; uint256 salvageToExporter; }
struct ParametricCover { uint8 consecutiveFailedEpochs; uint256 salvageToExporter; uint32 epochFloor;
                         address exporter; uint256 exporterSalvage; }
uint8 constant MAX_TRIGGER_EPOCHS = 32;
function offerParametricCover(bytes32 shipmentId, uint256 coverAmount, uint16 premiumBps,
                              uint8 consecutiveFailedEpochs, uint256 salvageToExporter);
function triggerParametric(bytes32 shipmentId, bytes32[] epochIds); // anyone; ACTIVE|PAUSED|DISPUTED; once
function rescue(address token, address to);         // DEFAULT_ADMIN_ROLE; untracked excess only
function getOfferTrigger(bytes32, address) view returns (ParametricTrigger);
function getParametricCover(bytes32) view returns (ParametricCover);
function untrackedUsdg() view returns (uint256);
function pause(); function unpause();               // PAUSER_ROLE (offers and acceptance only)
event ParametricTermsOffered(bytes32 indexed shipmentId, address indexed insurer, uint8 consecutiveFailedEpochs, uint256 salvageToExporter);
event ParametricTriggered(bytes32 indexed shipmentId, address indexed triggeredBy, bytes32 lastEpochId,
                          uint256 financierPayout, uint256 exporterSalvage, uint256 insurerReturn);
event Rescued(address indexed token, address indexed to, uint256 amount);
error InvalidTrigger(); error NotParametric(); error TriggerNotMet(); error NothingToRescue();
```

Trigger proof: exactly N epoch ids, all of this shipment, all `compliant == false`, ordinals consecutive and
greater than the shipment's epoch count at acceptance. Split: financier `min(cover, drawn)`, exporter
`min(salvage, rest)`, insurer the remainder. Invariants extended: balance = offers + active + credits +
untracked stray; a TRIGGERED cover splits exactly into the three shares; payout <= drawn; rescue never takes
tracked funds.

## 7. Roles

Recommended:

```text
DEFAULT_ADMIN_ROLE
FACILITY_MANAGER_ROLE
CONTROLLER_ROLE
EVIDENCE_VERIFIER_ROLE
MONITOR_ROLE
DISPUTE_ROLE
PROOF_VERIFIER_ROLE
ATTESTOR_ROLE   (v3: records attested devices)
CARRIER_ROLE    (v3: issues bills of lading)
PAUSER_ROLE     (v3: circuit breaker for new risk only)
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
event EvidenceTelemetryCommitted(...);   // v2
event DisputeOpened(...);
event DisputeResolved(...);
event DeliveryConfirmed(...);
event FacilitySettled(...);
// v2 CoverPool
event CoverOffered(...); event OfferWithdrawn(...); event CoverAccepted(...);
event CoverReleased(...); event CoverClaimed(...); event Withdrawn(...);
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
// v2
error InvalidMilestonePlace();
error OutsideMilestonePlace();
error EvidenceBelowPolicy();
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
