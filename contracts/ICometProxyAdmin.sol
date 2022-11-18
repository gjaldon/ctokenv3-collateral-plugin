// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.15;

import "@openzeppelin/contracts/proxy/transparent/TransparentUpgradeableProxy.sol";

interface Deployable {
    function deploy(address cometProxy) external returns (address);
}

interface ICometProxyAdmin {
    /**
     * @dev Deploy a new Comet and upgrade the implementation of the Comet proxy
     *  Requirements:
     *   - This contract must be the admin of `CometProxy`
     */
    function deployAndUpgradeTo(
        Deployable configuratorProxy,
        TransparentUpgradeableProxy cometProxy
    ) external;
}