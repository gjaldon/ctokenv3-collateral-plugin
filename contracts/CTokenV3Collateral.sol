// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "./ICollateral.sol";
import "@chainlink/contracts/src/v0.8/interfaces/AggregatorV3Interface.sol";
import "./vendor/reserve/OracleLib.sol";

contract CTokenV3Collateral is ICollateral {
    using OracleLib for AggregatorV3Interface;

    AggregatorV3Interface public immutable chainlinkFeed;
    IERC20Metadata public immutable erc20;
    IERC20 public immutable override rewardERC20;
    uint8 public immutable erc20Decimals;
    uint192 public immutable override maxTradeVolume; // {UoA}
    uint192 public immutable fallbackPrice; // {UoA}
    uint48 public immutable oracleTimeout; // {s} Seconds that an oracle value is considered valid

    uint192 public immutable defaultThreshold; // {%} e.g. 0.05
    uint192 public prevReferencePrice; // previous rate, {collateral/reference}
    address public immutable rewardsAddr;
    
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
        address rewardsAddr_
    ) {
        require(fallbackPrice_ > 0, "fallback price zero");
        require(address(chainlinkFeed_) != address(0), "missing chainlink feed");
        require(address(erc20_) != address(0), "missing erc20");
        require(maxTradeVolume_ > 0, "invalid max trade volume");
        require(oracleTimeout_ > 0, "oracleTimeout zero");
        require(address(rewardERC20_) != address(0), "rewardERC20 missing");
        require(defaultThreshold_ > 0, "defaultThreshold zero");
        require(address(rewardsAddr_) != address(0), "rewardsAddr missing");

        fallbackPrice = fallbackPrice_;
        chainlinkFeed = chainlinkFeed_;
        erc20 = erc20_;
        erc20Decimals = erc20.decimals();
        rewardERC20 = rewardERC20_;
        maxTradeVolume = maxTradeVolume_;
        oracleTimeout = oracleTimeout_;
        defaultThreshold = defaultThreshold_;
        prevReferencePrice = refPerTok();
        rewardsAddr = rewardsAddr_;
    }

    /// @dev Since cUSDCv3 has an exchange rate of 1:1 with USDC, then {UoA/tok} = {UoA/ref}.
    function strictPrice() public view virtual override returns (uint192) {
        return chainlinkFeed.price(oracleTimeout);
    }

    /// @dev In CompoundV3, cUSDCv3 has an exchange rate of 1:1 with USDC.
    /// @return {ref/tok} Quantity of whole reference units per whole collateral tokens
    function refPerTok() public view override returns (uint192) {
        return 1;
    }

    function bal(address account) external view returns (uint192) {
        return shiftl_toFix(erc20.balanceOf(account), -int8(erc20Decimals));
    }

    function getClaimCalldata()
        external
        view
        virtual
        override
        returns (address _to, bytes memory _cd)
    {
        _to = rewardsAddr;
        _cd = abi.encodeWithSignature(
            "function claim(address, address, bool)",
            address(erc20),
            msg.sender,
            true
        );
    }
}