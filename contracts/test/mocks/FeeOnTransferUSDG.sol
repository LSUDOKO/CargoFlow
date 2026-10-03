// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice A hostile stand-in for USDG that burns 1% of every transfer. Same storage layout as
///         MockUSDG, so tests can etch it over a deployed MockUSDG and keep the balances. USDG itself is
///         a plain ERC-20; this exists only to prove the CoverPool never assumes otherwise silently.
contract FeeOnTransferUSDG is ERC20("Global Dollar", "USDG") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from == address(0) || to == address(0)) return super._update(from, to, value);
        uint256 fee = value / 100;
        super._update(from, address(0), fee);
        super._update(from, to, value - fee);
    }
}
