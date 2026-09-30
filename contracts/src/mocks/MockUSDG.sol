// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Test/local stand-in for Paxos USDG (6 decimals). Never deployed to a public network:
///         the real testnet token at the address in `.env.example` is used there.
contract MockUSDG is ERC20("Global Dollar", "USDG") {
    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
