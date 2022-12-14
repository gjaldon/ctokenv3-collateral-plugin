// SPDX-License-Identifier: ISC
pragma solidity 0.8.9;

import "./ICollateral.sol";
import "./ICusdcV3Wrapper.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "reserve/contracts/plugins/assets/OracleLib.sol";
import "reserve/contracts/libraries/Fixed.sol";

contract CTokenV3Collateral is ICollateral {
    struct Configuration {
        AggregatorV3Interface chainlinkFeed;
        IERC20Metadata erc20;
        IERC20 rewardERC20;
        bytes32 targetName;
        uint48 oracleTimeout;
        uint192 fallbackPrice;
        uint192 maxTradeVolume;
        uint192 defaultThreshold;
        uint256 delayUntilDefault;
        uint256 reservesThresholdIffy;
        uint256 reservesThresholdDisabled;
    }

    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable chainlinkFeed;
    IERC20Metadata public immutable erc20;
    IERC20 public immutable rewardERC20;
    IComet public immutable comet;

    uint8 public immutable erc20Decimals;
    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    uint192 public immutable maxTradeVolume; // {UoA}
    uint192 public immutable fallbackPrice; // {UoA}
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}

    uint256 public immutable delayUntilDefault; // {s} e.g 86400
    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;
    uint256 public immutable reservesThresholdIffy;
    uint256 public immutable reservesThresholdDisabled;

    bytes32 public immutable targetName;

    constructor(Configuration memory config) {
        require(config.fallbackPrice > 0, "fallback price zero");
        require(address(config.chainlinkFeed) != address(0), "missing chainlink feed");
        require(address(config.erc20) != address(0), "missing erc20");
        require(config.maxTradeVolume > 0, "invalid max trade volume");
        require(config.oracleTimeout > 0, "oracleTimeout zero");
        require(address(config.rewardERC20) != address(0), "rewardERC20 missing");
        require(config.defaultThreshold > 0, "defaultThreshold zero");
        require(config.targetName != bytes32(0), "targetName missing");
        require(config.delayUntilDefault > 0, "delayUntilDefault zero");
        require(config.reservesThresholdIffy > 0, "reservesThresholdIffy zero");
        require(config.reservesThresholdDisabled > 0, "reservesThresholdDisabled zero");

        targetName = config.targetName;
        delayUntilDefault = config.delayUntilDefault;
        fallbackPrice = config.fallbackPrice;
        chainlinkFeed = config.chainlinkFeed;
        erc20 = config.erc20;
        erc20Decimals = erc20.decimals();
        rewardERC20 = config.rewardERC20;
        maxTradeVolume = config.maxTradeVolume;
        oracleTimeout = config.oracleTimeout;
        defaultThreshold = config.defaultThreshold;
        prevReferencePrice = refPerTok();
        reservesThresholdIffy = config.reservesThresholdIffy;
        reservesThresholdDisabled = config.reservesThresholdDisabled;
        comet = IComet(ICusdcV3Wrapper(address(erc20)).underlyingComet());
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

        // Check for hard default
        uint192 referencePrice = refPerTok();
        int256 cometReserves = comet.getReserves();

        if (
            referencePrice < prevReferencePrice ||
            cometReserves < 0 ||
            uint256(cometReserves) < reservesThresholdDisabled
        ) {
            markStatus(CollateralStatus.DISABLED);
        } else if (uint256(cometReserves) < reservesThresholdIffy) {
            markStatus(CollateralStatus.IFFY);
        } else {
            try chainlinkFeed.price_(oracleTimeout) returns (uint192 p) {
                // Check for soft default of underlying reference token
                uint192 peg = targetPerRef();

                // D18{UoA/ref}= D18{UoA/ref} * D18{1} / D18
                uint192 delta = (peg * defaultThreshold) / FIX_ONE; // D18{UoA/ref}

                // If the price is below the default-threshold price, default eventually
                // uint192(+/-) is the same as Fix.plus/minus
                if (p < peg - delta || p > peg + delta) markStatus(CollateralStatus.IFFY);
                else markStatus(CollateralStatus.SOUND);
            } catch (bytes memory errData) {
                // see: docs/solidity-style.md#Catching-Empty-Data
                if (errData.length == 0) revert(); // solhint-disable-line reason-string
                markStatus(CollateralStatus.IFFY);
            }
        }
        prevReferencePrice = referencePrice;

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    function strictPrice() public view returns (uint192) {
        return chainlinkFeed.price(oracleTimeout).mul(refPerTok());
    }

    /// Can return 0
    /// Cannot revert if `allowFallback` is true. Can revert if false.
    /// @param allowFallback Whether to try the fallback price in case precise price reverts
    /// @return isFallback If the price is a allowFallback price
    /// @return {UoA/tok} The current price, or if it's reverting, a fallback price
    function price(bool allowFallback) public view returns (bool isFallback, uint192) {
        try this.strictPrice() returns (uint192 p) {
            return (false, p);
        } catch {
            require(allowFallback, "price reverted without failover enabled");
            return (true, fallbackPrice);
        }
    }

    /// @return The collateral's status
    function status() public view returns (CollateralStatus) {
        if (_whenDefault == NEVER) {
            return CollateralStatus.SOUND;
        } else if (_whenDefault > block.timestamp) {
            return CollateralStatus.IFFY;
        } else {
            return CollateralStatus.DISABLED;
        }
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public pure returns (uint192) {
        return FIX_ONE;
    }

    /// @dev Returns the exchange rate between the underlying balance of CUSDC and the balance
    ///   of the wCUSDC.
    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view returns (uint192) {
        uint256 exchangeRate = ICusdcV3Wrapper(address(erc20)).exchangeRate();
        return _safeWrap(exchangeRate);
    }

    function isCollateral() external pure returns (bool) {
        return true;
    }

    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    function claimRewards() external {
        IERC20 comp = rewardERC20;
        uint256 oldBal = comp.balanceOf(address(this));
        ICusdcV3Wrapper(address(erc20)).claimTo(address(this), address(this));
        emit RewardsClaimed(comp, comp.balanceOf(address(this)) - oldBal);
    }

    // === Helpers ===

    function markStatus(CollateralStatus status_) internal {
        if (_whenDefault <= block.timestamp) return; // prevent DISABLED -> SOUND/IFFY

        if (status_ == CollateralStatus.SOUND) {
            _whenDefault = NEVER;
        } else if (status_ == CollateralStatus.IFFY) {
            _whenDefault = Math.min(block.timestamp + delayUntilDefault, _whenDefault);
        } else if (status_ == CollateralStatus.DISABLED) {
            _whenDefault = block.timestamp;
        }
    }

    function alreadyDefaulted() internal view returns (bool) {
        return _whenDefault <= block.timestamp;
    }

    function whenDefault() public view returns (uint256) {
        return _whenDefault;
    }
}
