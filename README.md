# Sample Hardhat Project

This project demonstrates a basic Hardhat use case. It comes with a sample contract, a test for that contract, and a script that deploys that contract.

Try running some of the following tasks:

```shell
npx hardhat help
npx hardhat test
REPORT_GAS=true npx hardhat test
npx hardhat node
npx hardhat run scripts/deploy.ts
```

### Slither Hidden Warnings

`ICollateral is re-used - (contracts/ICollateral.sol)`
`IRewardable is re-used - (contracts/ICollateral.sol)`
`IAsset is re-used - (contracts/ICollateral.sol)`

- This gets triggered since we are compiling contracts from the Reserve protocol repo. Instead of changing the name, I am silencing the warning since these contracts in the Reserve dependency and in this repo are identical. I am keeping the interfaces needed for the Collateral contract in this repo for easy reference.

`CusdcV3Wrapper.underlyingBalanceOf(address) (contracts/CusdcV3Wrapper.sol) uses a dangerous strict equality:`
`CusdcV3Wrapper.underlyingExchangeRate() (contracts/CusdcV3Wrapper.sol) uses a dangerous strict equality`

- The strict equalities are only used to check if user has a balance of the Wrapped Tokens or if there is any supply of the Wrapped Tokens. No balance or supply should return 0.

`Reentrancy in CusdcV3Wrapper.accrueAccount(address) (contracts/CusdcV3Wrapper.sol)`
`Reentrancy in CusdcV3Wrapper.claimTo(address,address) (contracts/CusdcV3Wrapper.sol)`
`Reentrancy in CusdcV3Wrapper._withdraw(address,address,address,uint256) (contracts/CusdcV3Wrapper.sol)`
`Reentrancy in CusdcV3Wrapper._deposit(address,address,address,uint256) (contracts/CusdcV3Wrapper.sol)`

- `Comet.accrueAccount()` needs to be called prior to updating user data stored in state variables so we get the updated supply indices from Comet. Without calling `accrueAccount` we may get outdated supply indices and the records we have of user's `principal` and `baseTrackingAccrued` will be inaccurate. This will mean inaccurate balances and accrued rewards. Also, we are calling a known contract and `Comet.accrueAccount` does not do any re-entrancy.

`CusdcV3Wrapper.accruedSupplyIndex(uint64,uint256) (contracts/CusdcV3Wrapper.sol) uses timestamp for comparisons`
`CusdcV3Wrapper.claimTo(address,address) (contracts/CusdcV3Wrapper.sol) uses timestamp for comparisons`
`CusdcV3Wrapper.getRewardOwed(address) (contracts/CusdcV3Wrapper.sol) uses timestamp for comparisons`
`CusdcV3Wrapper.updatedAccountIndices(CusdcV3Wrapper.UserBasic,int256) (contracts/CusdcV3Wrapper.sol) uses timestamp for comparisons`

- We need to use `block.timestamp` for computing interest and rewards accruals. This is the same logic as is used by Comet/cUSDCv3. Since timestamp can not be manipulated to be too far into the future, there is little incentive to manipulate because interest and rewards accruals per second is a very small fraction. Also, the risk is taken on by Comet because they will be the one paying for the accruals in USDC.

`Different versions of Solidity are used`

- The contracts related to the `Wrapped cUSDCv3` use `0.8.17` since it is the latest version of Solidity. The Collateral contracts use `0.8.9` since Reserve's contracts use `0.8.9` and they are used as dependencies.

`CusdcV3Wrapper (contracts/CusdcV3Wrapper.sol) should inherit from ICusdcV3Wrapper (contracts/ICusdcV3Wrapper.sol)`

- `ICusdcV3Wrapper` is only used by `CTokenV3Collateral` to interface with `CusdcV3Wrapper`.
