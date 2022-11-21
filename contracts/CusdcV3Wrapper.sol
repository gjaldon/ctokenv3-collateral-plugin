// SPDX-License-Identifier: UNLICENSED
pragma solidity 0.8.15;

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

    uint256 constant TRACKING_INDEX_SCALE = 1e15;
    uint64 constant RESCALE_FACTOR = 1e12;

    address public immutable underlying;
    IERC20 public immutable underlyingERC20;
    IERC20 public immutable rewardERC20;
    CometInterface public immutable underlyingComet;
    ICometRewards public immutable rewardsAddr;

    mapping(address => UserBasic) public userBasic;
    mapping(address => uint256) public rewardsClaimed;

    constructor(
        address cusdcv3,
        address rewardsAddr_,
        address rewardERC20_
    ) ERC20("Wrapped cUSDCv3", "wcUSDCv3") {
        underlying = cusdcv3;
        rewardsAddr = ICometRewards(rewardsAddr_);
        rewardERC20 = IERC20(rewardERC20_);
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
        underlyingComet.accrueAccount(address(this));
        uint256 mintAmount;

        UserBasic memory basic = userBasic[account];
        uint256 underlyingBalance = underlyingERC20.balanceOf(account);
        if (amount > underlyingBalance) {
            mintAmount = underlyingBalance;
            CometInterface.UserBasic memory cometBasic = underlyingComet.userBasic(account);
            basic.principal += uint104(cometBasic.principal);
        } else {
            mintAmount = amount;
            uint104 principal = basic.principal;
            (uint64 baseSupplyIndex, ) = getSupplyIndices();
            uint256 balance = presentValueSupply(baseSupplyIndex, principal) + amount;
            basic.principal = principalValueSupply(baseSupplyIndex, balance);
        }

        SafeERC20.safeTransferFrom(underlyingERC20, _msgSender(), address(this), mintAmount);

        // We use the this contract's baseTrackingIndex from Comet so we do not over-accrue user's rewards.
        CometInterface.UserBasic memory wrappedBasic = underlyingComet.userBasic(address(this));
        basic.baseTrackingIndex = wrappedBasic.baseTrackingIndex;

        userBasic[account] = basic;
        _mint(account, mintAmount);

        return true;
    }

    /**
     * @dev Allow a user to burn a number of wrapped tokens and withdraw the corresponding number of underlying tokens.
     * @param amount The amount of Wrapped cUSDC being withdrawn.
     */
    function withdrawTo(address account, uint256 amount) public virtual returns (bool) {
        underlyingComet.accrueAccount(address(this));
        uint256 balance = balanceOf(account);
        uint256 _underlyingExchangeRate = underlyingExchangeRate();
        uint256 burnAmount = (amount > balance) ? balance : amount;
        uint256 transferAmount = (burnAmount * _underlyingExchangeRate) / EXP_SCALE;

        UserBasic memory basic = userBasic[account];
        userBasic[account] = updatedAccountIndices(basic, -signed256(transferAmount));

        _burn(_msgSender(), burnAmount);
        SafeERC20.safeTransfer(underlyingERC20, account, transferAmount);

        return true;
    }

    function underlyingBalanceOf(address account) public view returns (uint256) {
        if (balanceOf(account) == 0) {
            return 0;
        }
        TotalsBasic memory totals = underlyingComet.totalsBasic();
        uint64 baseSupplyIndex = totals.baseSupplyIndex;
        uint256 lastAccrualTime = totals.lastAccrualTime;
        baseSupplyIndex = accruedSupplyIndex(baseSupplyIndex, block.timestamp - lastAccrualTime);
        UserBasic memory basic = userBasic[account];
        return presentValueSupply(baseSupplyIndex, basic.principal);
    }

    function accruedSupplyIndex(uint64 baseSupplyIndex, uint256 timeElapsed)
        internal
        view
        returns (uint64)
    {
        if (timeElapsed > 0) {
            uint256 utilization = underlyingComet.getUtilization();
            uint256 supplyRate = underlyingComet.getSupplyRate(utilization);
            baseSupplyIndex += safe64(mulFactor(baseSupplyIndex, supplyRate * timeElapsed));
        }
        return baseSupplyIndex;
    }

    function underlyingExchangeRate() public view returns (uint256) {
        uint256 totalSupply = totalSupply();
        if (totalSupply == 0) {
            return EXP_SCALE;
        }
        return (underlyingERC20.balanceOf(address(this)) * EXP_SCALE) / totalSupply;
    }

    function claim(address to) external {
        accrueAccount(to);
        uint256 claimed = rewardsClaimed[to];
        uint256 accrued = userBasic[to].baseTrackingAccrued * RESCALE_FACTOR;

        if (accrued > claimed) {
            uint256 owed = accrued - claimed;
            rewardsClaimed[to] = accrued;

            rewardsAddr.claimTo(underlying, address(this), address(this), true);
            SafeERC20.safeTransfer(rewardERC20, to, owed);
        }
    }

    function getRewardOwed(address account) external returns (uint256) {
        accrueAccount(account);

        uint256 claimed = rewardsClaimed[account];
        uint256 accrued = userBasic[account].baseTrackingAccrued * RESCALE_FACTOR;
        uint256 owed = accrued > claimed ? accrued - claimed : 0;

        return owed;
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
        underlyingComet.accrueAccount(address(this));
        userBasic[account] = updatedAccountIndices(basic, 0);
    }

    function updatedAccountIndices(UserBasic memory basic, int256 changeToPrincipal)
        internal
        view
        returns (UserBasic memory)
    {
        uint104 principal = basic.principal;
        (uint64 baseSupplyIndex, uint64 trackingSupplyIndex) = getSupplyIndices();

        uint256 indexDelta = uint256(trackingSupplyIndex - basic.baseTrackingIndex);
        basic.baseTrackingAccrued += safe64(
            (uint104(principal) * indexDelta) / TRACKING_INDEX_SCALE
        );
        basic.baseTrackingIndex = trackingSupplyIndex;

        if (changeToPrincipal != 0) {
            uint256 balance = unsigned256(
                signed256(presentValueSupply(baseSupplyIndex, basic.principal)) + changeToPrincipal
            );
            basic.principal = principalValueSupply(baseSupplyIndex, balance);
        }

        return basic;
    }
}
