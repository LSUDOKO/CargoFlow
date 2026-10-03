// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice The slice of GMX v2 (gmx-synthetics) that GMXHedgeVault calls. Struct layouts and function
///         signatures are copied from the deployed ExchangeRouter ABI in
///         https://github.com/gmx-io/gmx-synthetics/blob/main/deployments/arbitrumSepolia/ExchangeRouter.json
///         (contracts/order/IBaseOrderUtils.sol, contracts/order/Order.sol). Field order is load-bearing:
///         it fixes the ABI encoding of createOrder.
interface IBaseOrderUtils {
    struct CreateOrderParamsAddresses {
        address receiver;
        address cancellationReceiver;
        address callbackContract;
        address uiFeeReceiver;
        address market;
        address initialCollateralToken;
        address[] swapPath;
    }

    struct CreateOrderParamsNumbers {
        uint256 sizeDeltaUsd; // USD x 1e30
        uint256 initialCollateralDeltaAmount; // collateral token units
        uint256 triggerPrice;
        uint256 acceptablePrice; // USD x 1e30 per token unit
        uint256 executionFee; // wei of WNT sent to the OrderVault
        uint256 callbackGasLimit;
        uint256 minOutputAmount;
        uint256 validFromTime;
    }

    struct CreateOrderParams {
        CreateOrderParamsAddresses addresses;
        CreateOrderParamsNumbers numbers;
        uint8 orderType; // Order.OrderType
        uint8 decreasePositionSwapType; // Order.DecreasePositionSwapType
        bool isLong;
        bool shouldUnwrapNativeToken;
        bool autoCancel;
        bytes32 referralCode;
        bytes32[] dataList;
    }
}

/// @dev Order.OrderType values used here.
library GmxOrderType {
    uint8 internal constant MARKET_INCREASE = 2;
    uint8 internal constant MARKET_DECREASE = 4;
}

interface IExchangeRouter {
    function multicall(bytes[] calldata data) external payable returns (bytes[] memory results);

    /// @dev Wraps `amount` of the native token sent with the call and sends WNT to `receiver`.
    function sendWnt(address receiver, uint256 amount) external payable;

    /// @dev Router.pluginTransfer(token, msg.sender, receiver, amount): the caller approves the Router.
    function sendTokens(address token, address receiver, uint256 amount) external payable;

    function createOrder(IBaseOrderUtils.CreateOrderParams calldata params)
        external
        payable
        returns (bytes32);

    function cancelOrder(bytes32 key) external payable;

    function router() external view returns (address);

    function dataStore() external view returns (address);
}
