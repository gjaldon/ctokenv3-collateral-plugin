// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract CusdcV3Wrapper is ERC20 {
    IERC20 public immutable underlying;
    uint256 constant expScale = 1e18;

    constructor(IERC20 cusdcv3) ERC20("Wrapped CUSDCV3", "wCUSDCv3") {
        underlying = cusdcv3;
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    /**
     * @dev Allow a user to deposit underlying tokens and mint the corresponding number of wrapped tokens.
     */
    function depositFor(address account, uint256 amount) public virtual returns (bool) {
        uint256 underlyingBalance = underlying.balanceOf(account);
        SafeERC20.safeTransferFrom(underlying, _msgSender(), address(this), amount);
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
            burnAmount = (underlyingBalance * expScale) / _underlyingExchangeRate;
            _burn(_msgSender(), burnAmount);
            SafeERC20.safeTransfer(underlying, account, underlyingBalance);
        } else {
            burnAmount = (amount * expScale) / _underlyingExchangeRate;
            _burn(_msgSender(), burnAmount);
            SafeERC20.safeTransfer(underlying, account, amount);
        }

        return true;
    }

    function underlyingBalanceOf(address account) public view returns (uint256) {
        uint256 wrappedTokenAmount = balanceOf(account);
        if (wrappedTokenAmount == 0) {
            return 0;
        }
        return (wrappedTokenAmount * underlyingExchangeRate()) / expScale;
    }

    function underlyingExchangeRate() public view returns (uint256) {
        uint256 totalSupply = totalSupply();
        if (totalSupply == 0) {
            return expScale;
        }
        return (underlying.balanceOf(address(this)) * expScale) / totalSupply;
    }
}
