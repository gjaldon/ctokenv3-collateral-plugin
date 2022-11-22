import { loadFixture, time } from '@nomicfoundation/hardhat-network-helpers'
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
  enableRewardsAccrual,
  mintWcUSDC,
} from './helpers'
import { makeReserveProtocol, deployCollateral } from './fixtures'
import { ICometRewards } from '../typechain-types'

describe('integration tests', () => {
  before(resetFork)

  it('sets up assets', async () => {
    const { compAsset, compToken, rsrAsset, rsr } = await loadFixture(makeReserveProtocol)
    // COMP Token
    expect(await compAsset.isCollateral()).to.equal(false)
    expect(await compAsset.erc20()).to.equal(COMP)
    expect(compToken.address).to.equal(COMP)
    expect(await compToken.decimals()).to.equal(18)
    expect(await compAsset.strictPrice()).to.be.closeTo(exp(51, 18), exp(5, 17)) // Close to $51 USD - Nov 2022
    expect(await compAsset.maxTradeVolume()).to.equal(MAX_TRADE_VOL)

    // RSR Token
    expect(await rsrAsset.isCollateral()).to.equal(false)
    expect(await rsrAsset.erc20()).to.equal(ethers.utils.getAddress(RSR))
    expect(rsr.address).to.equal(RSR)
    expect(await rsr.decimals()).to.equal(18)
    expect(await rsrAsset.strictPrice()).to.be.closeTo(exp(645, 13), exp(5, 12)) // Close to $0.00645
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
    expect(await collateral.strictPrice()).to.be.closeTo(FIX_ONE, exp(5, 16)) // Should always be close to $1

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
    // Check RToken price
    expect(await rTokenAsset.strictPrice()).to.be.closeTo(
      collateralPrice,
      collateralPrice.div(1000)
    )
  })

  it('issues/reedems with simple basket', async function () {
    const { cusdcV3, usdc, rToken, facadeTest, backingManager, wcusdcV3 } = await loadFixture(
      makeReserveProtocol
    )
    const [_, bob] = await ethers.getSigners()

    // Check balances before
    expect(await wcusdcV3.balanceOf(backingManager.address)).to.equal(0)

    const issueAmount = exp(10000, 18)
    const initialBal = exp(20000, 6)
    const usdcAsB = usdc.connect(bob)
    const cusdcV3AsB = cusdcV3.connect(bob)
    const wcusdcV3AsB = wcusdcV3.connect(bob)

    allocateUSDC(bob.address, initialBal)
    await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
    expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
    await cusdcV3AsB.supply(usdc.address, initialBal)
    expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(initialBal, 100e6)
    await cusdcV3AsB.allow(wcusdcV3.address, true)
    await wcusdcV3AsB.depositFor(bob.address, ethers.constants.MaxUint256)
    await wcusdcV3AsB.approve(rToken.address, ethers.constants.MaxUint256)

    // Check rToken balance
    expect(await rToken.balanceOf(bob.address)).to.equal(0)
    expect(await rToken.connect(bob).issue(issueAmount)).to.emit(rToken, 'Issuance')

    // Check Balances after - Only 1 Collateral in our Prime Basket
    // RToken issued is multiplied by refPerTok() and shifted to the left by 18 - 6 decimals
    expect(await wcusdcV3.balanceOf(backingManager.address)).to.be.closeTo(
      issueAmount / exp(1, 12), // Need to downscale by 12. 18 - 6
      exp(5, 6)
    )

    // Balances for user
    const remainingBalance = initialBal - issueAmount / exp(1, 12)
    expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(remainingBalance, exp(5, 6))

    // Check RTokens issued to user
    expect(await rToken.balanceOf(bob.address)).to.equal(issueAmount)
    expect(await rToken.totalSupply()).to.equal(issueAmount)

    // Check asset value
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      issueAmount,
      exp(150, 18)
    ) // approx 10K in value

    // Redeem Rtokens
    // Need to ensure we redeem within the limits of the redemption battery
    const redeemAmount = issueAmount / 20n
    await expect(rToken.connect(bob).redeem(redeemAmount)).to.emit(rToken, 'Redemption')

    // Check funds were transferred
    expect(await rToken.balanceOf(bob.address)).to.equal(issueAmount - redeemAmount)
    expect(await rToken.totalSupply()).to.equal(issueAmount - redeemAmount)

    // Check balances after - Backing Manager is empty
    expect(await wcusdcV3.balanceOf(backingManager.address)).to.be.closeTo(
      (issueAmount - redeemAmount) / exp(1, 12),
      exp(5, 6)
    )

    // Check funds returned to user
    expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(exp(10500, 6), 100)

    // Check asset value left
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.be.closeTo(
      exp(9500, 18),
      exp(10, 18)
    ) // Near 9,500
  })

  it('claims rewards - COMP', async () => {
    const { cusdcV3, usdc, rToken, backingManager, wcusdcV3, compToken } = await loadFixture(
      makeReserveProtocol
    )
    const [_, bob] = await ethers.getSigners()

    // Try to claim rewards at this point - Nothing for Backing Manager
    expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
    await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

    // No rewards so far
    expect(await compToken.balanceOf(backingManager.address)).to.equal(0)

    await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
    const wcusdcV3AsB = wcusdcV3.connect(bob)
    await wcusdcV3AsB.approve(rToken.address, ethers.constants.MaxUint256)

    // Issue RTokens
    const issueAmount = exp(10_000, 18)
    await expect(rToken.connect(bob).issue(issueAmount)).to.emit(rToken, 'Issuance')
    expect(await wcusdcV3.balanceOf(backingManager.address)).to.be.gt(0)

    // Check RTokens issued to user
    expect(await rToken.balanceOf(bob.address)).to.equal(issueAmount)

    // Now we can claim rewards - check initial balance still 0
    expect(await compToken.balanceOf(backingManager.address)).to.equal(0)
    await time.increase(1000)
    await enableRewardsAccrual(cusdcV3)

    // Claim rewards
    // await backingManager.claimAndSweepRewards()
    await expect(await backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

    // Check rewards both in COMP
    const rewardsCOMP1 = await compToken.balanceOf(backingManager.address)
    expect(rewardsCOMP1).to.be.gt(0)

    await time.increase(3600)
    // Get additional rewards
    await expect(backingManager.claimRewards()).to.emit(backingManager, 'RewardsClaimed')

    const rewardsCOMP2 = await compToken.balanceOf(backingManager.address)
    expect(rewardsCOMP2).to.be.gt(rewardsCOMP1)
  })
})
