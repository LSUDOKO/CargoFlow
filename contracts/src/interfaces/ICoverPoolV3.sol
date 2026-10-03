// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ICoverPool} from "./ICoverPool.sol";

/// @notice v3 additions to the CoverPool: parametric triggers, release on cancellation (through the
///         unchanged `release`) and recovery of tokens sent to the pool by mistake. Every v2 function,
///         struct, event and error is unchanged; CoverStatus only gains TRIGGERED at the end.
interface ICoverPoolV3 is ICoverPool {
    /// @dev The trigger an offer carries. consecutiveFailedEpochs == 0 means a plain (v2) offer.
    struct ParametricTrigger {
        uint8 consecutiveFailedEpochs; // N: 1..MAX_TRIGGER_EPOCHS
        uint256 salvageToExporter; // paid to the exporter from what is left after the financier
    }

    /// @dev The trigger of an accepted cover, fixed at acceptance.
    struct ParametricCover {
        uint8 consecutiveFailedEpochs;
        uint256 salvageToExporter;
        uint32 epochFloor; // the shipment's epoch count at acceptance: only later epochs count
        address exporter; // set when triggered
        uint256 exporterSalvage; // set when triggered
    }

    event ParametricTermsOffered(
        bytes32 indexed shipmentId,
        address indexed insurer,
        uint8 consecutiveFailedEpochs,
        uint256 salvageToExporter
    );
    event ParametricTriggered(
        bytes32 indexed shipmentId,
        address indexed triggeredBy,
        bytes32 lastEpochId,
        uint256 financierPayout,
        uint256 exporterSalvage,
        uint256 insurerReturn
    );
    event Rescued(address indexed token, address indexed to, uint256 amount);

    error InvalidTrigger();
    error NotParametric();
    error TriggerNotMet();
    error NothingToRescue();

    /// @notice Like offerCover, plus a parametric trigger: if `consecutiveFailedEpochs` evidence
    ///         epochs committed for the shipment after acceptance are consecutive in the shipment's
    ///         commit order and all non-compliant, anyone can trigger the cover while the facility is
    ///         ACTIVE, PAUSED or DISPUTED. 1 <= consecutiveFailedEpochs <= MAX_TRIGGER_EPOCHS;
    ///         salvageToExporter <= coverAmount.
    function offerParametricCover(
        bytes32 shipmentId,
        uint256 coverAmount,
        uint16 premiumBps,
        uint8 consecutiveFailedEpochs,
        uint256 salvageToExporter
    ) external;

    /// @notice Proves the trigger with exactly N epoch ids in commit order and pays out once:
    ///         the financier min(cover, outstanding principal = drawn, nothing is repaid before
    ///         settlement), then the exporter min(salvage, what is left), then the insurer the rest.
    ///         All three are credited and pulled with withdraw(). Final: a later settle or default does
    ///         not reopen the cover.
    function triggerParametric(bytes32 shipmentId, bytes32[] calldata epochIds) external;

    /// @notice Admin (DEFAULT_ADMIN_ROLE of the access contract) sweeps tokens sent to the pool
    ///         directly: for USDG only the excess over open offers + active covers + credited payouts,
    ///         for any other token the whole balance. Tracked funds can never be rescued.
    function rescue(address token, address to) external;

    /// @notice The trigger attached to `insurer`'s open offer (zeroes for a plain offer).
    function getOfferTrigger(bytes32 shipmentId, address insurer)
        external
        view
        returns (ParametricTrigger memory);

    /// @notice The trigger of the facility's accepted cover (zeroes when not parametric).
    function getParametricCover(bytes32 shipmentId) external view returns (ParametricCover memory);

    /// @notice USDG held by the pool beyond what it tracks (what rescue(USDG, to) would sweep).
    function untrackedUsdg() external view returns (uint256);
}
