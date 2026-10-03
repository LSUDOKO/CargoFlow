// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEvidenceRegistry} from "./IEvidenceRegistry.sol";

/// @notice v3 additions to the EvidenceRegistry. Every v2 function, struct, event and error is
///         unchanged; these only add (a) the device sources behind an epoch and (b) the epoch's
///         commit order within its shipment, which lets anyone prove "N consecutive epochs".
interface IEvidenceRegistryV3 is IEvidenceRegistry {
    event EpochSourcesRecorded(
        bytes32 indexed epochId, bytes32 indexed shipmentId, bytes32[] deviceKeyHashes
    );

    error SourcesAlreadyRecorded();
    error InvalidSources();

    /// @notice Records the device key hashes (see DeviceRegistry) whose readings fed `epochId`.
    ///         Only the evidence worker; once per epoch; 1..32 distinct non-zero hashes; the epoch
    ///         must exist. Purely an audit record: the registry does not judge the devices.
    function recordEpochSources(bytes32 epochId, bytes32[] calldata deviceKeyHashes) external;

    /// @notice The recorded sources of an epoch (empty when none were recorded).
    function getEpochSources(bytes32 epochId) external view returns (bytes32[] memory);

    /// @notice 1-based position of `epochId` in its shipment's commit order (the first epoch committed
    ///         for a shipment is 1, the next 2, regardless of milestone or seq). Reverts EpochNotFound.
    function epochOrdinal(bytes32 epochId) external view returns (uint32);

    /// @notice How many epochs have been committed for `shipmentId`.
    function epochCount(bytes32 shipmentId) external view returns (uint32);
}
