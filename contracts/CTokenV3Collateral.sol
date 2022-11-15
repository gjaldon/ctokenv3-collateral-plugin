// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./ICollateral.sol";
import "./ICusdcV3Wrapper.sol";
import "@openzeppelin/contracts/utils/math/Math.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "reserve/contracts/plugins/assets/OracleLib.sol";
import "reserve/contracts/libraries/Fixed.sol";


contract CTokenV3Collateral is ICollateral {
    using OracleLib for AggregatorV3Interface;
    using FixLib for uint192;

    AggregatorV3Interface public immutable chainlinkFeed;
    IERC20Metadata public immutable erc20;
    IERC20 public immutable rewardERC20;
    int8 public immutable referenceERC20Decimals;
    uint8 public immutable erc20Decimals;
    uint192 public immutable maxTradeVolume; // {UoA}
    uint192 public immutable fallbackPrice; // {UoA}
    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid
    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    address public immutable rewardsAddr;
    uint256 public immutable delayUntilDefault; // {s} e.g 86400
    // targetName: The canonical name of this collateral's target unit.
    bytes32 public immutable targetName;

    uint256 private constant NEVER = type(uint256).max;
    uint256 private _whenDefault = NEVER;

    constructor(
        uint192 fallbackPrice_,
        AggregatorV3Interface chainlinkFeed_,
        IERC20Metadata erc20_,
        IERC20Metadata rewardERC20_,
        uint192 maxTradeVolume_,
        uint48 oracleTimeout_,
        bytes32 targetName_,
        uint192 defaultThreshold_,
        uint256 delayUntilDefault_,
        address rewardsAddr_,
        int8 referenceERC20Decimals_
    ) {
        require(fallbackPrice_ > 0, "fallback price zero");
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        require(address(rewardERC20_) != address(0), "rewardERC20 missing");
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(address(rewardsAddr_) != address(0), "rewardsAddr missing");
        require(targetName_ != bytes32(0), "targetName missing");
        require(delayUntilDefault_ > 0, "delayUntilDefault zero");
        require(referenceERC20Decimals_ > 0, "referenceERC20Decimals missing");

        targetName = targetName_;
        delayUntilDefault = delayUntilDefault_;
        fallbackPrice = fallbackPrice_;
        chainlinkFeed = chainlinkFeed_;
        erc20 = erc20_;
        erc20Decimals = erc20.decimals();
        rewardERC20 = rewardERC20_;
        maxTradeVolume = maxTradeVolume_;
        oracleTimeout = oracleTimeout_;
        defaultThreshold = defaultThreshold_;
        rewardsAddr = rewardsAddr_;
        referenceERC20Decimals = referenceERC20Decimals_;
    }

    /// Refresh exchange rates and update default status.
    /// @custom:interaction RCEI
    function refresh() external {
        // == Refresh ==
        if (alreadyDefaulted()) return;
        CollateralStatus oldStatus = status();

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

        CollateralStatus newStatus = status();
        if (oldStatus != newStatus) {
            emit DefaultStatusChanged(oldStatus, newStatus);
        }

        // No interactions beyond the initial refresher
    }

    /// @dev Since cUSDCv3 has an exchange rate of 1:1 with USDC, then {UoA/tok} = {UoA/ref}.
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

    /// @dev {UoA} is USD and {target} is USD so this is 1:1.
    /// @return {UoA/target} The price of a target unit in UoA
    function pricePerTarget() public pure returns (uint192) {
        return FIX_ONE;
    }

    /// @return {target/ref} Quantity of whole target units per whole reference unit in the peg
    function targetPerRef() public pure returns (uint192) {
        return FIX_ONE;
    }

    /// @dev Returns the exchange rate between the underlying balance of CUSDC and the balance
    ///   of the wCUSDC.
    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view returns (uint192) {
        uint256 exchangeRate = ICusdcV3Wrapper(address(erc20)).underlyingExchangeRate();
        return _safeWrap(exchangeRate);
    }

    function isCollateral() external pure returns (bool) {
        return true;
    }

    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    /// Get the message needed to call in order to claim rewards for holding this asset.
    /// @dev Rewards are COMP tokens that will be claimed from the rewards address.
    ///  This automatically accrues account so no need to accrue from `refresh()`.
    /// @return _to The address to send the call to
    /// @return _cd The calldata to send
    function getClaimCalldata() external view returns (address _to, bytes memory _cd) {
        _to = rewardsAddr;
        _cd = abi.encodeWithSignature(
            "function claim(address, address, bool)",
            address(erc20),
            msg.sender,
            true
        );
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
