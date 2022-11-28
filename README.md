# Compound III Collateral Plugin

This is a [Compound III](https://docs.compound.finance/) Collateral Plugin for the [Reserve](https://reserve.org/en/) Protocol.

This plugin enables the use of `cUSDCv3` (Compound III's cUSDC) as collateral within the Reserve Protocol. Some important notes about Compound III:

- Unlike Compound v2, where you can borrow multiple different assets, Compound III only allows you to borrow the _base asset_. Its _base asset_ is `USDC`.
- The only way to earn interest is to supply the _base asset_. Supplying any other asset other than the _base asset_ just gives you better borrow rates.
- There is only one `CToken` in Compound III, unlike in Compound v2. This token is `cUSDCv3` and it is given to users that supply USDC to the protocol.
- Compound III is also known as Comet. In this document, we will be using Compound III, Comet and cUSDCv3 interchangeably.
- `cUSDCv3` is a rebasing token unlike `CToken`s in Compound v2.
- Compound v2 users are being encouraged to move to Compound III.

## Implementation

|  `tok`  | `ref` | `target` | `UoA` |
| :-----: | :---: | :------: | :---: |
| cUSDCv3 | USDC  |   USD    |  USD  |

Since `cUSDCv3` is a rebasing token, we use a Wrapper Token that converts it into an exchange-rate token so we can use it within Reserve. Technically, our collateral token is `WcUSDCv3` (Wrapped cUSDCv3) but to keep things simple, we will treat `cUSDCv3` as our collateral token.

The `WcUSDCv3` contract keeps track of user participation so they get interest accruals on USDC and the reward accruals as if they had kept ownership of their `cUSDCv3`.

### refPerTok

We use the exchange rate of `WcUSDCv3`:`cUSDCv3` as refPerTok. This value mostly increases but can decrease if a large majority of the supply of `WcUSDCv3` has been burned. Basing on my own tests, this happens when ~90-100% of the supply is burned in one go. Apart from this exceptional circumstance, it will be increasing.

### refresh

The collateral becomes disabled in the following scenarios:

1. refPerTok() decreases. This happens when the exchange rate of `WcUSDCv3`:`cUSDCv3` decreases. This has been described above.
2. Compound III's reserves have become less than the configured `reservesThresholdDisabled`. Unhealthy levels of reserves may mean the protocol may soon become insolvent.

The collateral becomes iffy in the following scenarios:

1. The reference unit has not been able to maintain peg with the target unit within a configured threshold.
2. Compound III's reserves have become less than the configured `reservesThresholdIffy`.

Unlike other Collateral Plugins, we do not need to call an update transaction for this to get an updated balance. Compound III is able to compute for latest balances even when state variables for tracking accruals have not been called. This leads to a cheaper refresh() in terms of gas costs relative to other plugins.

### Testing

When possible or practical, we do mainnet forking in our tests. Tests that involve interacting with USDC and Compound III rely on the mainnet versions of those protocols. When testing interactions with the Reserve protocol, we deploy our own version of Reserve.

### Deployment

This comes with a [deploy script](scripts/deploy.ts) and [configuration](scripts/configuration.ts). It is already fully configured for deployment
to Mainnet and Goerli. You may optionally set `cusdcV3Wrapper` and `oracleLib` if you want to use existing deployments for the Wrapped cUSDCv3 and OracleLib, respectively.

### Slither

Below are Slither warnings that were hidden since they were found to be non-issues.

`ICollateral is re-used - (contracts/ICollateral.sol)`
`IRewardable is re-used - (contracts/ICollateral.sol)`
`IAsset is re-used - (contracts/ICollateral.sol)`

- This gets triggered since we are compiling contracts from the Reserve protocol repo. Instead of changing the name, I am silencing the warning since these contracts in the Reserve dependency and in this repo are identical. I am keeping the interfaces needed for the Collateral contract in this repo for easy reference.

`CusdcV3Wrapper.underlyingBalanceOf(address) (contracts/CusdcV3Wrapper.sol) uses a dangerous strict equality:`
`CusdcV3Wrapper.exchangeRate() (contracts/CusdcV3Wrapper.sol) uses a dangerous strict equality`

- The strict equalities are only used to check if user has a balance of the Wrapped Tokens or if there is any supply of the Wrapped Tokens. No balance or supply should return 0.

`Reentrancy in CusdcV3Wrapper.accrueAccount(address) (contracts/CusdcV3Wrapper.sol)`
`Reentrancy in CusdcV3Wrapper.claimTo(address,address) (contracts/CusdcV3Wrapper.sol)`
`Reentrancy in CusdcV3Wrapper._withdraw(address,address,address,uint256) (contracts/CusdcV3Wrapper.sol)`
`Reentrancy in CusdcV3Wrapper._deposit(address,address,address,uint256) (contracts/CusdcV3Wrapper.sol)`

- `Comet.accrueAccount()` needs to be called prior to updating user data stored in state variables so we get the updated supply indices from Comet. Without calling `accrueAccount` we may get outdated supply indices and the records we have of user's `principal` and `baseTrackingAccrued` will be inaccurate. This will mean inaccurate balances and accrued rewards. Also, we are calling a known contract and `Comet.accrueAccount` does not do any re-entrancy.

`CusdcV3Wrapper.claimTo(address,address) (contracts/CusdcV3Wrapper.sol) uses timestamp for comparisons`
`CusdcV3Wrapper.getRewardOwed(address) (contracts/CusdcV3Wrapper.sol) uses timestamp for comparisons`
`CusdcV3Wrapper.updatedAccountIndices(CusdcV3Wrapper.UserBasic,int256) (contracts/CusdcV3Wrapper.sol) uses timestamp for comparisons`

- We need to use `block.timestamp` for computing interest and rewards accruals. This is the same logic as is used by Comet/cUSDCv3. Since timestamp can not be manipulated to be too far into the future, there is little incentive to manipulate because interest and rewards accruals per second is a very small fraction. Also, the risk is taken on by Comet because they will be the one paying for the accruals in USDC.

`Different versions of Solidity are used`

- The contracts related to the `Wrapped cUSDCv3` use `0.8.17` since it is the latest version of Solidity. The Collateral contracts use `0.8.9` since Reserve's contracts use `0.8.9` and they are used as dependencies.

`CusdcV3Wrapper (contracts/CusdcV3Wrapper.sol) should inherit from ICusdcV3Wrapper (contracts/ICusdcV3Wrapper.sol)`

- `ICusdcV3Wrapper` is only used by `CTokenV3Collateral` to interface with `CusdcV3Wrapper`.

### Social Media

- Twitter - https://twitter.com/gjaldon
- Discord - gjaldon#9165
