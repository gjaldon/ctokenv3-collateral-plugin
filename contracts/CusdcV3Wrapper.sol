// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract CusdcV3Wrapper is ERC20 {
  IERC20 public immutable underlying;

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
      SafeERC20.safeTransferFrom(underlying, _msgSender(), address(this), amount);
      _mint(account, amount);
      return true;
  }

  /**
   * @dev Allow a user to burn a number of wrapped tokens and withdraw the corresponding number of underlying tokens.
   */
  function withdrawTo(address account, uint256 amount) public virtual returns (bool) {
      uint256 underlyingBalance = underlyingBalanceOf(account);

      if (amount > underlyingBalance) {
        SafeERC20.safeTransfer(underlying, account, underlyingBalance);
      } else {
        SafeERC20.safeTransfer(underlying, account, amount);
      }

      uint256 burnAmount = amount / underlyingExchangeRate();
      _burn(_msgSender(), burnAmount);

      return true;
  }

  function underlyingBalanceOf(address account) public view returns (uint256) {
    uint256 wrappedTokenAmount = balanceOf(account);
    return wrappedTokenAmount * underlyingExchangeRate();
  }

  function underlyingExchangeRate() public view returns (uint256) {
    return underlying.balanceOf(address(this)) / totalSupply();
  }
}
