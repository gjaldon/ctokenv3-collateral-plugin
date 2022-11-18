// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "./vendor/CometInterface.sol";
import "./ICometRewards.sol";
import "./CometHelpers.sol";
import "hardhat/console.sol";

contract CusdcV3Wrapper is ERC20, CometHelpers {
    struct UserBasic {
        uint104 principal;
        uint64 baseTrackingAccrued;
        uint64 baseTrackingIndex;
    }

    uint256 constant EXP_SCALE = 1e18;
    uint256 constant TRACKING_INDEX_SCALE = 1e15;

    address public immutable underlying;
    IERC20 public immutable underlyingERC20;
    CometInterface public immutable underlyingComet;
    address public immutable rewardsAddr;
    mapping(address => UserBasic) public userBasic;

    constructor(address cusdcv3, address rewardsAddr_) ERC20("Wrapped cUSDCv3", "wcUSDCv3") {
        underlying = cusdcv3;
        rewardsAddr = rewardsAddr_;
        underlyingERC20 = IERC20(cusdcv3);
        underlyingComet = CometInterface(cusdcv3);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @dev Allow a user to deposit underlying tokens and mint the corresponding number of wrapped tokens.
     */
    function depositFor(address account, uint256 amount) public virtual returns (bool) {
        uint256 underlyingBalance = underlyingERC20.balanceOf(account);
        SafeERC20.safeTransferFrom(underlyingERC20, _msgSender(), address(this), amount);

        accrueAccount(account);

        CometInterface.UserBasic memory cometBasic = underlyingComet.userBasic(account);
        UserBasic memory basic = userBasic[account];
        (uint64 baseSupplyIndex, ) = getSupplyIndices();
        uint256 balance = presentValueSupply(baseSupplyIndex, basic.principal) + uint104(amount);
        uint104 principalNew = principalValueSupply(baseSupplyIndex, balance);
        basic.principal = principalNew;
        basic.baseTrackingIndex = cometBasic.baseTrackingIndex;
        userBasic[account] = basic;

        if (amount > underlyingBalance) {
            _mint(account, underlyingBalance);
        } else {
            _mint(account, amount);
        }

        return true;
    }

    /**
     * @dev Allow a user to burn a number of wrapped tokens and withdraw the corresponding number of underlying tokens.
     */
    function withdrawTo(address account, uint256 amount) public virtual returns (bool) {
        uint256 underlyingBalance = underlyingBalanceOf(account);
        uint256 _underlyingExchangeRate = underlyingExchangeRate();
        uint256 burnAmount;

        if (amount > underlyingBalance) {
            burnAmount = (underlyingBalance * EXP_SCALE) / _underlyingExchangeRate;
            _burn(_msgSender(), burnAmount);
            SafeERC20.safeTransfer(underlyingERC20, account, underlyingBalance);
        } else {
            burnAmount = (amount * EXP_SCALE) / _underlyingExchangeRate;
            _burn(_msgSender(), burnAmount);
            SafeERC20.safeTransfer(underlyingERC20, account, amount);
        }

        return true;
    }

    function underlyingBalanceOf(address account) public view returns (uint256) {
        uint256 wrappedTokenAmount = balanceOf(account);
        if (wrappedTokenAmount == 0) {
            return 0;
        }
        return (wrappedTokenAmount * underlyingExchangeRate()) / EXP_SCALE;
    }

    function underlyingExchangeRate() public view returns (uint256) {
        uint256 totalSupply = totalSupply();
        if (totalSupply == 0) {
            return EXP_SCALE;
        }
        return (underlyingERC20.balanceOf(address(this)) * EXP_SCALE) / totalSupply;
    }

    function claim(address to) external {
        ICometRewards(rewardsAddr).claimTo(address(underlying), address(this), to, true);
    }

    function baseTrackingAccrued(address account) external view returns (uint64) {
        return userBasic[account].baseTrackingAccrued;
    }

    function baseTrackingIndex(address account) external view returns (uint64) {
        return userBasic[account].baseTrackingIndex;
    }

    function getSupplyIndices()
        internal
        view
        returns (uint64 baseSupplyIndex_, uint64 trackingSupplyIndex_)
    {
        TotalsBasic memory totals = underlyingComet.totalsBasic();
        baseSupplyIndex_ = totals.baseSupplyIndex;
        trackingSupplyIndex_ = totals.trackingSupplyIndex;
    }

    function accrueAccount(address account) public {
        UserBasic memory basic = userBasic[account];
        uint104 principal = basic.principal;

        (, uint64 trackingSupplyIndex) = getSupplyIndices();
        uint256 indexDelta = uint256(trackingSupplyIndex - basic.baseTrackingIndex);
        basic.baseTrackingAccrued += safe64(
            (uint104(principal) * indexDelta) / TRACKING_INDEX_SCALE
        );
        basic.baseTrackingIndex = trackingSupplyIndex;
        userBasic[account] = basic;
    }
}
