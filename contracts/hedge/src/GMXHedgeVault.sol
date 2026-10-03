// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Ownable, Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IBaseOrderUtils, IExchangeRouter, GmxOrderType} from "./interfaces/IGmxV2.sol";

/// @title GMXHedgeVault
/// @notice A financier's own hedge account on GMX v2 (Arbitrum Sepolia), tagged with CargoFlow shipment ids.
///
///         Scope, stated plainly:
///           - The collateral here is the financier's own money, deposited into this vault. CargoFlow escrow
///             (the ReceivableVault on Robinhood Chain) is never touched, referenced or bridged: escrow must
///             be available the moment evidence releases it, and a leveraged position can be liquidated.
///           - GMX v2 does not run on Robinhood Chain, so this vault lives on Arbitrum Sepolia. The only link
///             to CargoFlow is the shipment id the financier tags each hedge with.
///           - Pharma has no GMX market. The hedge fits exposure that has one: commodity-linked cargo or the
///             crypto/FX leg of a deal. Choosing the market and the size is the financier's decision.
///
///         One vault per financier (the owner). Orders go through ExchangeRouter.multicall exactly like the
///         GMX interface does: sendWnt(executionFee) + sendTokens(collateral) + createOrder. GMX keepers
///         execute orders asynchronously, so the sizes recorded here are what was requested; the live
///         position is read from GMX's Reader with `positionKey`. GMX nets every order on the same
///         (account, market, collateral token, direction), so two shipments hedged on the same market share
///         one GMX position; the per-shipment figures here are the financier's own allocation of it.
contract GMXHedgeVault is Ownable2Step, ReentrancyGuard {
    using SafeERC20 for IERC20;

    struct Hedge {
        address market; // GMX market token
        bool isLong;
        uint256 requestedSizeUsd; // USD x 1e30, sum of increases minus decreases requested
        uint256 collateralSent; // collateral token units sent with increase orders
        uint32 orderCount;
    }

    struct OrderRef {
        bytes32 shipmentId;
        bool isIncrease;
        bool voided; // cancelled by the owner or cleared after GMX cancelled it
        uint256 sizeDeltaUsd;
        uint256 collateralAmount; // sent (increase) or requested back (decrease)
    }

    IExchangeRouter public immutable EXCHANGE_ROUTER;
    /// @notice GMX Router: the spender sendTokens pulls collateral through (Router.pluginTransfer).
    address public immutable ROUTER;
    address public immutable ORDER_VAULT;
    /// @notice The single collateral token of this vault (USDC on Arbitrum Sepolia).
    IERC20 public immutable COLLATERAL;

    mapping(bytes32 shipmentId => Hedge) internal _hedges;
    mapping(bytes32 orderKey => OrderRef) internal _orders;
    mapping(bytes32 shipmentId => bytes32[]) internal _shipmentOrders;
    bytes32[] internal _shipments;

    event Deposited(address indexed token, uint256 amount);
    event Withdrawn(address indexed token, address indexed to, uint256 amount);
    event HedgeOrderCreated(
        bytes32 indexed shipmentId,
        bytes32 indexed orderKey,
        address indexed market,
        bool isIncrease,
        bool isLong,
        uint256 sizeDeltaUsd,
        uint256 collateralAmount,
        uint256 acceptablePrice,
        uint256 executionFee
    );
    event HedgeOrderCancelled(bytes32 indexed shipmentId, bytes32 indexed orderKey);
    event HedgeOrderCleared(bytes32 indexed shipmentId, bytes32 indexed orderKey);

    error ZeroAddress();
    error ZeroAmount();
    error InvalidShipment();
    error MarketMismatch();
    error UnknownHedge();
    error UnknownOrder();
    error OrderAlreadyVoided();
    error SizeExceedsHedge();
    error InsufficientExecutionFee();
    error NativeTransferFailed();

    constructor(
        address owner_,
        IExchangeRouter exchangeRouter,
        address router,
        address orderVault,
        IERC20 collateral
    ) Ownable(owner_) {
        if (
            address(exchangeRouter) == address(0) || router == address(0)
                || orderVault == address(0) || address(collateral) == address(0)
        ) revert ZeroAddress();
        EXCHANGE_ROUTER = exchangeRouter;
        ROUTER = router;
        ORDER_VAULT = orderVault;
        COLLATERAL = collateral;
    }

    /// @notice GMX refunds unused execution fee (and cancelled-order WNT unwrapped) to the account.
    receive() external payable {}

    // ------------------------------------------------------------------ funds

    /// @notice Pulls `amount` of the collateral token from the owner (approve this vault first).
    function deposit(uint256 amount) external onlyOwner nonReentrant {
        if (amount == 0) revert ZeroAmount();
        COLLATERAL.safeTransferFrom(msg.sender, address(this), amount);
        emit Deposited(address(COLLATERAL), amount);
    }

    /// @notice Sends any ERC-20 held by the vault (collateral, refunds, PnL, WNT) to `to`. The money is the
    ///         owner's: nothing here is escrow, so there is no lock.
    function withdraw(address token, uint256 amount, address to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        IERC20(token).safeTransfer(to, amount);
        emit Withdrawn(token, to, amount);
    }

    function withdrawNative(uint256 amount, address payable to) external onlyOwner nonReentrant {
        if (to == address(0)) revert ZeroAddress();
        if (amount == 0) revert ZeroAmount();
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert NativeTransferFailed();
        emit Withdrawn(address(0), to, amount);
    }

    // ----------------------------------------------------------------- hedges

    /// @notice Opens or increases the hedge for `shipmentId` with a GMX market-increase order. The
    ///         execution fee comes from msg.value plus any native balance the vault holds.
    /// @param market GMX market token (e.g. ETH/USD [WETH-USDC]); fixed per shipment once chosen
    /// @param sizeDeltaUsd position size to add, USD x 1e30
    /// @param collateralAmount collateral token units sent with the order (0 to add size only)
    /// @param acceptablePrice worst price, USD x 1e30 per token unit (max for long, min for short)
    function openHedge(
        bytes32 shipmentId,
        address market,
        bool isLong,
        uint256 sizeDeltaUsd,
        uint256 collateralAmount,
        uint256 acceptablePrice,
        uint256 executionFee
    ) external payable onlyOwner nonReentrant returns (bytes32 orderKey) {
        if (shipmentId == bytes32(0)) revert InvalidShipment();
        if (market == address(0)) revert ZeroAddress();
        if (sizeDeltaUsd == 0 && collateralAmount == 0) revert ZeroAmount();
        Hedge storage h = _hedges[shipmentId];
        if (h.market == address(0)) {
            h.market = market;
            h.isLong = isLong;
            _shipments.push(shipmentId);
        } else if (h.market != market || h.isLong != isLong) {
            revert MarketMismatch();
        }
        _requireFee(executionFee);

        bool sendCollateral = collateralAmount > 0;
        bytes[] memory calls = new bytes[](sendCollateral ? 3 : 2);
        calls[0] = abi.encodeCall(IExchangeRouter.sendWnt, (ORDER_VAULT, executionFee));
        if (sendCollateral) {
            COLLATERAL.forceApprove(ROUTER, collateralAmount);
            calls[1] = abi.encodeCall(
                IExchangeRouter.sendTokens, (address(COLLATERAL), ORDER_VAULT, collateralAmount)
            );
        }
        calls[calls.length - 1] = abi.encodeCall(
            IExchangeRouter.createOrder,
            (_params(
                    market,
                    isLong,
                    GmxOrderType.MARKET_INCREASE,
                    sizeDeltaUsd,
                    collateralAmount,
                    acceptablePrice,
                    executionFee
                ))
        );
        bytes[] memory results = EXCHANGE_ROUTER.multicall{value: executionFee}(calls);
        orderKey = abi.decode(results[results.length - 1], (bytes32));

        h.requestedSizeUsd += sizeDeltaUsd;
        h.collateralSent += collateralAmount;
        h.orderCount += 1;
        _orders[orderKey] = OrderRef(shipmentId, true, false, sizeDeltaUsd, collateralAmount);
        _shipmentOrders[shipmentId].push(orderKey);
        emit HedgeOrderCreated(
            shipmentId,
            orderKey,
            market,
            true,
            isLong,
            sizeDeltaUsd,
            collateralAmount,
            acceptablePrice,
            executionFee
        );
    }

    /// @notice Reduces or closes the hedge with a GMX market-decrease order. Proceeds (collateral plus or
    ///         minus PnL) are paid by GMX to this vault on execution; withdraw them with `withdraw`.
    /// @param sizeDeltaUsd size to close, USD x 1e30 (the whole requested size closes the hedge)
    /// @param collateralDeltaAmount collateral to take out, collateral token units
    /// @param acceptablePrice worst price, USD x 1e30 per token unit (min for long, max for short)
    function closeHedge(
        bytes32 shipmentId,
        uint256 sizeDeltaUsd,
        uint256 collateralDeltaAmount,
        uint256 acceptablePrice,
        uint256 executionFee
    ) external payable onlyOwner nonReentrant returns (bytes32 orderKey) {
        Hedge storage h = _hedges[shipmentId];
        if (h.market == address(0)) revert UnknownHedge();
        if (sizeDeltaUsd == 0 && collateralDeltaAmount == 0) revert ZeroAmount();
        if (sizeDeltaUsd > h.requestedSizeUsd) revert SizeExceedsHedge();
        _requireFee(executionFee);

        bytes[] memory calls = new bytes[](2);
        calls[0] = abi.encodeCall(IExchangeRouter.sendWnt, (ORDER_VAULT, executionFee));
        calls[1] = abi.encodeCall(
            IExchangeRouter.createOrder,
            (_params(
                    h.market,
                    h.isLong,
                    GmxOrderType.MARKET_DECREASE,
                    sizeDeltaUsd,
                    collateralDeltaAmount,
                    acceptablePrice,
                    executionFee
                ))
        );
        bytes[] memory results = EXCHANGE_ROUTER.multicall{value: executionFee}(calls);
        orderKey = abi.decode(results[1], (bytes32));

        h.requestedSizeUsd -= sizeDeltaUsd;
        h.orderCount += 1;
        _orders[orderKey] = OrderRef(shipmentId, false, false, sizeDeltaUsd, collateralDeltaAmount);
        _shipmentOrders[shipmentId].push(orderKey);
        emit HedgeOrderCreated(
            shipmentId,
            orderKey,
            h.market,
            false,
            h.isLong,
            sizeDeltaUsd,
            collateralDeltaAmount,
            acceptablePrice,
            executionFee
        );
    }

    /// @notice Cancels a pending GMX order of this vault; GMX returns its collateral and the unused
    ///         execution fee to the vault. The requested-size bookkeeping is rolled back.
    function cancelOrder(bytes32 orderKey) external onlyOwner nonReentrant {
        OrderRef storage o = _voidOrder(orderKey);
        EXCHANGE_ROUTER.cancelOrder(orderKey);
        emit HedgeOrderCancelled(o.shipmentId, orderKey);
    }

    /// @notice Rolls back the bookkeeping of an order that GMX's keepers cancelled (for example the price
    ///         moved past `acceptablePrice`). Bookkeeping only: it moves no funds and changes nothing on GMX.
    function clearCancelledOrder(bytes32 orderKey) external onlyOwner {
        OrderRef storage o = _voidOrder(orderKey);
        emit HedgeOrderCleared(o.shipmentId, orderKey);
    }

    // ------------------------------------------------------------------ views

    function hedgeOf(bytes32 shipmentId) external view returns (Hedge memory) {
        return _hedges[shipmentId];
    }

    function orderOf(bytes32 orderKey) external view returns (OrderRef memory) {
        return _orders[orderKey];
    }

    function ordersOf(bytes32 shipmentId) external view returns (bytes32[] memory) {
        return _shipmentOrders[shipmentId];
    }

    function shipments() external view returns (bytes32[] memory) {
        return _shipments;
    }

    /// @notice The GMX position key of this vault's position on (market, collateral, isLong):
    ///         keccak256(abi.encode(account, market, collateralToken, isLong)) as in Position.getPositionKey.
    ///         Pass it to Reader.getPosition(dataStore, key) for the live size, collateral and PnL.
    function positionKey(address market, bool isLong) public view returns (bytes32) {
        return keccak256(abi.encode(address(this), market, address(COLLATERAL), isLong));
    }

    function hedgePositionKey(bytes32 shipmentId) external view returns (bytes32) {
        Hedge storage h = _hedges[shipmentId];
        if (h.market == address(0)) revert UnknownHedge();
        return positionKey(h.market, h.isLong);
    }

    // --------------------------------------------------------------- internal

    function _requireFee(uint256 executionFee) private view {
        // msg.value is already part of the balance
        if (executionFee == 0 || address(this).balance < executionFee) {
            revert InsufficientExecutionFee();
        }
    }

    function _voidOrder(bytes32 orderKey) private returns (OrderRef storage o) {
        o = _orders[orderKey];
        if (o.shipmentId == bytes32(0)) revert UnknownOrder();
        if (o.voided) revert OrderAlreadyVoided();
        o.voided = true;
        Hedge storage h = _hedges[o.shipmentId];
        if (o.isIncrease) {
            h.requestedSizeUsd -= o.sizeDeltaUsd;
            h.collateralSent -= o.collateralAmount;
        } else {
            h.requestedSizeUsd += o.sizeDeltaUsd;
        }
    }

    function _params(
        address market,
        bool isLong,
        uint8 orderType,
        uint256 sizeDeltaUsd,
        uint256 collateralAmount,
        uint256 acceptablePrice,
        uint256 executionFee
    ) private view returns (IBaseOrderUtils.CreateOrderParams memory p) {
        p.addresses = IBaseOrderUtils.CreateOrderParamsAddresses({
                receiver: address(this),
                cancellationReceiver: address(this),
                callbackContract: address(0),
                uiFeeReceiver: address(0),
                market: market,
                initialCollateralToken: address(COLLATERAL),
                swapPath: new address[](0)
            });
        p.numbers = IBaseOrderUtils.CreateOrderParamsNumbers({
            sizeDeltaUsd: sizeDeltaUsd,
            initialCollateralDeltaAmount: collateralAmount,
            triggerPrice: 0,
            acceptablePrice: acceptablePrice,
            executionFee: executionFee,
            callbackGasLimit: 0,
            minOutputAmount: 0,
            validFromTime: 0
        });
        p.orderType = orderType;
        p.decreasePositionSwapType = 0; // NoSwap
        p.isLong = isLong;
        p.shouldUnwrapNativeToken = false;
        p.autoCancel = false;
        p.referralCode = bytes32(0);
        p.dataList = new bytes32[](0);
    }
}
