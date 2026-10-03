// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Minimal stand-in for an ERC-4337 contract account (e.g. a ZeroDev Kernel): an owner (in
///         production the EntryPoint after validating a passkey signature) makes it call any target.
///         Calls arrive at CargoFlow with msg.sender = this contract and tx.origin = whoever submitted
///         the transaction (the bundler), so they prove no EOA-only assumption exists.
contract MockSmartAccount {
    error NotOwner();

    address public immutable OWNER;

    constructor(address owner) {
        OWNER = owner;
    }

    function execute(address target, uint256 value, bytes calldata data)
        external
        payable
        returns (bytes memory result)
    {
        if (msg.sender != OWNER) revert NotOwner();
        bool ok;
        (ok, result) = target.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(result, 0x20), mload(result))
            }
        }
    }
}
