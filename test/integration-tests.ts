import { loadFixture, time, mine } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import {
  COMP,
  MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  REWARDS,
  CollateralStatus,
  RSR,
  FIX_ONE,
  allocateUSDC,
  exp,
  resetFork,
} from './helpers'
import { makeReserveProtocol, deployCollateral } from './fixtures'

describe('Integration tests', () => {
  before(resetFork)

  it('sets up assets', async () => {
    const { compAsset, compToken, rsrAsset, rsr } = await loadFixture(makeReserveProtocol)
    // COMP Token
    expect(await compAsset.isCollateral()).to.equal(false)
    expect(await compAsset.erc20()).to.equal(COMP)
    expect(compToken.address).to.equal(COMP)
    expect(await compToken.decimals()).to.equal(18)
    expect(await compAsset.strictPrice()).to.be.closeTo(exp(51, 18), exp(5, 17)) // Close to $51 USD - Nov 2022
    expect(await compAsset.getClaimCalldata()).to.eql([ethers.constants.AddressZero, '0x'])
    expect(await compAsset.rewardERC20()).to.equal(ethers.constants.AddressZero)
    expect(await compAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOL)

    // RSR Token
    expect(await rsrAsset.isCollateral()).to.equal(false)
    expect(await rsrAsset.erc20()).to.equal(ethers.utils.getAddress(RSR))
    expect(rsr.address).to.equal(RSR)
    expect(await rsr.decimals()).to.equal(18)
    expect(await rsrAsset.strictPrice()).to.be.closeTo(exp(645, 13), exp(5, 12)) // Close to $0.00645
    expect(await rsrAsset.getClaimCalldata()).to.eql([ethers.constants.AddressZero, '0x'])
    expect(await rsrAsset.rewardERC20()).to.equal(ethers.constants.AddressZero)
    expect(await rsrAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOL)
  })

  it('sets up collateral', async () => {
    const { collateral, wcusdcV3 } = await loadFixture(makeReserveProtocol)
    expect(await collateral.isCollateral()).to.equal(true)
    expect(await collateral.erc20()).to.equal(wcusdcV3.address)
    expect(await wcusdcV3.decimals()).to.equal(6)
    expect(await collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
    expect(await collateral.refPerTok()).to.equal(FIX_ONE)
    expect(await collateral.targetPerRef()).to.equal(FIX_ONE)
    expect(await collateral.pricePerTarget()).to.equal(FIX_ONE)
    expect(await collateral.strictPrice()).to.be.closeTo(FIX_ONE, exp(5, 16)) // Should always be close to $1

    const claimCallData: string[] = await collateral.getClaimCalldata()
    expect(claimCallData[0]).to.eql(REWARDS)
    expect(claimCallData[1]).to.not.be.empty
    expect(await collateral.rewardERC20()).to.equal(COMP)
    expect(await collateral.rewardsAddr()).to.equal(REWARDS)
    expect(await collateral.maxTradeVolume()).to.equal(MAX_TRADE_VOL)
  })

  const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

  it('handles invalid/stale price - collateral', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(makeReserveProtocol)
    // Reverts with stale price
    await time.increase(ORACLE_TIMEOUT)
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')

    // Refresh should mark status IFFY
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

    // CTokens Collateral with no price
    const noPriceCtokenCollateral = await deployCollateral({ chainlinkFeed: NO_PRICE_DATA_FEED })

    // Collateral with no price info should revert
    await expect(noPriceCtokenCollateral.strictPrice()).to.be.reverted
    // Refresh should also revert - status is not modified
    await expect(noPriceCtokenCollateral.refresh()).to.be.reverted
    expect(await noPriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

    // Reverts with a feed with zero price
    await chainlinkFeed.updateAnswer(0n)
    // Reverts with zero price
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
      collateral,
      'PriceOutsideRange'
    )
    // Refresh should mark status IFFY
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
  })

  it('registers ERC20s and Assets/Collateral', async () => {
    const { collateral, assetRegistry, rTokenAsset, rsrAsset, compAsset } = await loadFixture(
      makeReserveProtocol
    )
    // Check assets/collateral
    const ERC20s = await assetRegistry.erc20s()

    expect(ERC20s[0]).to.equal(await rTokenAsset.erc20())
    expect(ERC20s[1]).to.equal(await rsrAsset.erc20())
    expect(ERC20s[2]).to.equal(await compAsset.erc20())
    expect(ERC20s[3]).to.equal(await collateral.erc20())

    // Assets
    expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(collateral.address)
    // Collaterals
    expect(await assetRegistry.toColl(ERC20s[3])).to.equal(collateral.address)
  })

  it('registers simple basket', async () => {
    const {
      collateral,
      rToken,
      rTokenAsset,
      basketHandler,
      facade,
      facadeTest,
      cusdcV3,
      usdc,
      wcusdcV3,
    } = await loadFixture(makeReserveProtocol)
    const [_, bob] = await ethers.getSigners()

    // Basket
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    const backing = await facade.basketTokens(rToken.address)
    expect(backing[0]).to.equal(wcusdcV3.address)
    expect(backing.length).to.equal(1)

    // Check other values
    expect(await basketHandler.nonce()).to.be.gt(0n)
    expect(await basketHandler.timestamp()).to.be.gt(0n)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
    const [isFallback, price] = await basketHandler.price(true)
    expect(isFallback).to.equal(false)
    expect(price).to.be.closeTo(FIX_ONE, exp(15, 15))

    // Check RToken price
    const issueAmount = exp(10000, 18)
    const initialBal = exp(20000, 6)
    const usdcAsB = usdc.connect(bob)
    const cusdcV3AsB = cusdcV3.connect(bob)
    const wcusdcV3AsB = wcusdcV3.connect(bob)

    allocateUSDC(bob.address, initialBal)
    await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
    expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
    await cusdcV3AsB.supply(usdc.address, exp(20000, 6))
    expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(20000e6, 100e6)
    await cusdcV3AsB.allow(wcusdcV3.address, true)
    await wcusdcV3AsB.depositFor(bob.address, ethers.constants.MaxUint256)
    await wcusdcV3AsB.approve(rToken.address, ethers.constants.MaxUint256)
    expect(await rToken.connect(bob).issue(issueAmount)).to.emit(rToken, 'Issuance')
    expect(await rToken.balanceOf(bob.address)).to.equal(issueAmount)

    const collateralPrice = await collateral.strictPrice()
    expect(await rTokenAsset.strictPrice()).to.be.closeTo(
      collateralPrice,
      collateralPrice.div(1000)
    )
  })
})
