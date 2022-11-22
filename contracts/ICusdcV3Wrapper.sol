// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.9;

interface ICusdcV3Wrapper {
    function underlyingExchangeRate() external view returns (uint256);

    function claim(address account) external;
}
