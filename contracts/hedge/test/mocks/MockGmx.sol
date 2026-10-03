// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IBaseOrderUtils} from "../../src/interfaces/IGmxV2.sol";

contract MockUSDC is ERC20 {
    constructor() ERC20("USD Coin", "USDC") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// @dev GMX Router: moves tokens that the account approved to it, only for the exchange router plugin.
contract MockRouter {
    address public plugin;

    function setPlugin(address p) external {
        plugin = p;
    }

    function pluginTransfer(address token, address account, address receiver, uint256 amount)
        external
    {
        require(msg.sender == plugin, "not plugin");
        require(IERC20(token).transferFrom(account, receiver, amount), "transfer");
    }
}

/// @dev ExchangeRouter with GMX's multicall semantics (delegatecall to itself, shared msg.value). The
///      order vault is this contract, so a cancel can return collateral and the execution fee.
contract MockExchangeRouter {
    struct StoredOrder {
        address account;
        IBaseOrderUtils.CreateOrderParams params;
        uint256 wnt;
        uint256 tokens;
        bool cancelled;
    }

    MockRouter public immutable ROUTER_;
    uint256 public nonce;
    mapping(bytes32 => StoredOrder) internal _orders;
    // escrow received in the current multicall, attributed to the order created in it
    uint256 internal _pendingWnt;
    uint256 internal _pendingTokens;
    address internal _pendingToken;

    constructor(MockRouter r) {
        ROUTER_ = r;
    }

    function router() external view returns (address) {
        return address(ROUTER_);
    }

    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results) {
        results = new bytes[](data.length);
        for (uint256 i; i < data.length; ++i) {
            (bool ok, bytes memory out) = address(this).delegatecall(data[i]);
            if (!ok) {
                assembly {
                    revert(add(out, 32), mload(out))
                }
            }
            results[i] = out;
        }
    }

    function sendWnt(address receiver, uint256 amount) external payable {
        require(receiver == address(this), "receiver");
        require(address(this).balance >= amount, "wnt");
        _pendingWnt += amount;
    }

    function sendTokens(address token, address receiver, uint256 amount) external payable {
        ROUTER_.pluginTransfer(token, msg.sender, receiver, amount);
        _pendingToken = token;
        _pendingTokens += amount;
    }

    function createOrder(IBaseOrderUtils.CreateOrderParams calldata params)
        external
        payable
        returns (bytes32 key)
    {
        require(_pendingWnt >= params.numbers.executionFee, "execution fee");
        key = keccak256(abi.encode(msg.sender, nonce++));
        StoredOrder storage o = _orders[key];
        o.account = msg.sender;
        o.params = params;
        o.wnt = _pendingWnt;
        o.tokens = _pendingTokens;
        _pendingWnt = 0;
        _pendingTokens = 0;
    }

    function cancelOrder(bytes32 key) external payable {
        StoredOrder storage o = _orders[key];
        require(o.account == msg.sender, "account for cancelOrder");
        require(!o.cancelled, "cancelled");
        o.cancelled = true;
        if (o.tokens > 0) {
            require(
                IERC20(o.params.addresses.initialCollateralToken)
                    .transfer(o.params.addresses.cancellationReceiver, o.tokens),
                "refund tokens"
            );
        }
        (bool ok,) = o.params.addresses.cancellationReceiver.call{value: o.wnt}("");
        require(ok, "refund");
    }

    function getOrder(bytes32 key)
        external
        view
        returns (
            address account,
            IBaseOrderUtils.CreateOrderParams memory params,
            uint256 wnt,
            uint256 tokens,
            bool cancelled
        )
    {
        StoredOrder storage o = _orders[key];
        return (o.account, o.params, o.wnt, o.tokens, o.cancelled);
    }
}
