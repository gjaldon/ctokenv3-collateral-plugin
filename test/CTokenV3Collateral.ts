import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory } from 'ethers'
import { CTokenV3Collateral, InvalidMockV3Aggregator, MockV3Aggregator } from '../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import {
  USDC_USD_PRICE_FEED,
  CUSDC_V3,
  COMP,
  RTOKEN_MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  REWARDS,
  USDC_DECIMALS,
  ZERO_ADDRESS,
  deployCollateral,
  makeCollateralFactory,
  CollateralStatus,
  MAX_UINT256,
  getLatestBlockTimestamp,
  setNextBlockTimestamp,
  advanceTime,
} from './helpers'

describe('CTokenV3Collateral', () => {
  describe('Constructor validation', () => {
    let CTokenV3CollateralFactory: ContractFactory

    beforeEach(async () => {
      CTokenV3CollateralFactory = await makeCollateralFactory()
    })

    it('Should validate targetName correctly', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDC_USD_PRICE_FEED,
          CUSDC_V3,
          COMP,
          RTOKEN_MAX_TRADE_VOL,
          ORACLE_TIMEOUT,
          ethers.constants.HashZero,
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          REWARDS,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('targetName missing')
    })

    it('Should not allow missing defaultThreshold', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDC_USD_PRICE_FEED,
          CUSDC_V3,
          COMP,
          RTOKEN_MAX_TRADE_VOL,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          0,
          DELAY_UNTIL_DEFAULT,
          REWARDS,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })

    it('Should not allow missing delayUntilDefault', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDC_USD_PRICE_FEED,
          CUSDC_V3,
          COMP,
          RTOKEN_MAX_TRADE_VOL,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          0,
          REWARDS,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('delayUntilDefault zero')
    })

    it('Should not allow missing rewardERC20', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDC_USD_PRICE_FEED,
          CUSDC_V3,
          ZERO_ADDRESS,
          RTOKEN_MAX_TRADE_VOL,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          REWARDS,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('rewardERC20 missing')
    })

    it('Should not allow missing referenceERC20Decimals', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDC_USD_PRICE_FEED,
          CUSDC_V3,
          COMP,
          RTOKEN_MAX_TRADE_VOL,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          REWARDS,
          0
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })

    it('Should not allow missing rewardsAddr', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDC_USD_PRICE_FEED,
          CUSDC_V3,
          COMP,
          RTOKEN_MAX_TRADE_VOL,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          ZERO_ADDRESS,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('rewardsAddr missing')
    })
  })
})

describe('Prices #fast', () => {
  it('Should calculate prices correctly', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)
    const { answer } = await chainlinkFeed.latestRoundData()
    const decimals = await chainlinkFeed.decimals()
    const expectedPrice = answer.toBigInt() * 10n ** BigInt(18 - decimals)

    // Check initial prices
    expect(await collateral.strictPrice()).to.equal(expectedPrice)

    // Check refPerTok initial values
    const expectedRefPerTok = 1n * 10n ** 18n
    expect(await collateral.refPerTok()).to.equal(expectedRefPerTok) // should equal 1e18

    // Update values in Oracles increase by 10-20%
    const newPrice = 11n * 10n ** 7n
    const updateAnswerTx = await chainlinkFeed.updateAnswer(newPrice)
    await updateAnswerTx.wait()

    // Check new prices
    expect(await collateral.strictPrice()).to.equal(newPrice * 10n ** BigInt(18 - decimals))

    // Check refPerTok remains the same
    expect(await collateral.refPerTok()).to.equal(expectedRefPerTok)
  })

  it('Should revert if price is zero', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)

    // Set price of USDC to 0
    const updateAnswerTx = await chainlinkFeed.updateAnswer(0)
    await updateAnswerTx.wait()

    // Check price of token
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(
      collateral,
      'PriceOutsideRange'
    )

    // Fallback price is returned
    const [isFallback, price] = await collateral.price(true)
    expect(isFallback).to.equal(true)
    expect(price).to.equal(await collateral.fallbackPrice())

    // When refreshed, sets status to Unpriced
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
  })

  it('Should revert in case of invalid timestamp', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)
    await chainlinkFeed.setInvalidTimestamp()

    // Check price of token
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')

    // When refreshed, sets status to Unpriced
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
  })
})

describe('Status', () => {
  it('Should maintain status in normal situations', async () => {
    const { collateral } = await loadFixture(deployCollateral)

    // Check initial state
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT256)

    // Force updates (with no changes)
    await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')

    // State remains the same
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT256)
  })

  it('Updates status in case of soft default', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)
    const delayUntilDefault = (await collateral.delayUntilDefault()).toBigInt()

    // Check initial state
    expect(await collateral.status()).to.equal(CollateralStatus.SOUND)
    expect(await collateral.whenDefault()).to.equal(MAX_UINT256)

    // Depeg USDC:USD - Reducing price by 20% from 1 to 0.8
    const updateAnswerTx = await chainlinkFeed.updateAnswer(8n * 10n ** 5n)
    await updateAnswerTx.wait()

    // Force updates - Should update whenDefault and status
    let expectedDefaultTimestamp: bigint

    // Set next block timestamp - for deterministic result
    const nextBlockTimestamp = (await getLatestBlockTimestamp()) + 1
    await setNextBlockTimestamp(nextBlockTimestamp)
    expectedDefaultTimestamp = BigInt(nextBlockTimestamp) + delayUntilDefault

    await expect(collateral.refresh())
      .to.emit(collateral, 'DefaultStatusChanged')
      .withArgs(CollateralStatus.SOUND, CollateralStatus.IFFY)
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
    expect(await collateral.whenDefault()).to.equal(expectedDefaultTimestamp)

    // Move time forward past delayUntilDefault
    await advanceTime(Number(delayUntilDefault))
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)

    // Nothing changes if attempt to refresh after default for CTokenV3
    let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
    await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
  })

  it('Updates status in case of hard default', async () => {
    // It is not possible for CTokenV3Colllateral to hard default because {ref/tok} is
    // always 1 since USDC (ref) is always 1:1 with cUSDCV3 (tok).
  })

  it('Reverts if price is stale', async () => {
    const { collateral } = await loadFixture(deployCollateral)
    await advanceTime(ORACLE_TIMEOUT.toString())
    // Check new prices
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')
  })

  it('Enters IFFY state when price becomes stale', async () => {
    const { collateral } = await loadFixture(deployCollateral)
    await advanceTime(ORACLE_TIMEOUT.toString())
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)
  })

  it('Reverts if Chainlink feed reverts or runs out of gas, maintains status', async () => {
    const { collateral } = await loadFixture(deployCollateral)
    const InvalidMockV3AggregatorFactory = await ethers.getContractFactory(
      'InvalidMockV3Aggregator'
    )
    const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
      await InvalidMockV3AggregatorFactory.deploy(6, 1n * 10n ** 6n)
    )

    const CTokenV3CollateralFactory = await makeCollateralFactory()
    const invalidCollateral = await CTokenV3CollateralFactory.deploy(
      1,
      invalidChainlinkFeed.address,
      await collateral.erc20(),
      await collateral.rewardERC20(),
      await collateral.maxTradeVolume(),
      await collateral.oracleTimeout(),
      await collateral.targetName(),
      await collateral.defaultThreshold(),
      await collateral.delayUntilDefault(),
      await collateral.rewardsAddr(),
      await collateral.referenceERC20Decimals()
    )

    // Reverting with no reason
    await invalidChainlinkFeed.setSimplyRevert(true)
    await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
    expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)

    // Runnning out of gas (same error)
    await invalidChainlinkFeed.setSimplyRevert(false)
    await expect(invalidCollateral.refresh()).to.be.revertedWithoutReason()
    expect(await invalidCollateral.status()).to.equal(CollateralStatus.SOUND)
  })
})
