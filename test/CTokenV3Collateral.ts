import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { ContractFactory, BigNumber } from 'ethers'
import { OracleLib, MockV3Aggregator } from '../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

const USDCtoUSDPriceFeedAddr = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
const cUSDCv3Addr = '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
const compAddr = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
const rewardsAddr = '0x1B0e765F6224C21223AeA2af16c1C46E38885a40'
const ORACLE_TIMEOUT = 281474976710655n / 2n // type(uint48).max / 2
const DEFAULT_THRESHOLD = 5n * 10n ** 16n // 0.05
const DELAY_UNTIL_DEFAULT = 86400n
const rTokenMaxTradeVolume = 1000000n
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const USDC_DECIMALS = 6

enum CollateralStatus {
  SOUND,
  IFFY,
  DISABLED,
}

const MAX_UINT256 = BigNumber.from(2).pow(256).sub(1)

export const getLatestBlockTimestamp = async (): Promise<number> => {
  const latestBlock = await ethers.provider.getBlock('latest')
  return latestBlock.timestamp
}

export const setNextBlockTimestamp = async (timestamp: number | string) => {
  await network.provider.send('evm_setNextBlockTimestamp', [timestamp])
}

export const advanceTime = async (seconds: number | string) => {
  await ethers.provider.send('evm_increaseTime', [parseInt(seconds.toString())])
  await ethers.provider.send('evm_mine', [])
}

async function deployCollateral() {
  const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
  const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()
  const CTokenV3CollateralFactory = await ethers.getContractFactory('CTokenV3Collateral', {
    libraries: { OracleLib: oracleLib.address },
  })
  const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
    'MockV3Aggregator'
  )
  const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(6, 1n * 10n ** 6n)
  )

  const collateral = await CTokenV3CollateralFactory.deploy(
    1,
    chainlinkFeed.address,
    cUSDCv3Addr,
    compAddr,
    rTokenMaxTradeVolume,
    ORACLE_TIMEOUT,
    ethers.utils.formatBytes32String('USD'),
    DEFAULT_THRESHOLD,
    DELAY_UNTIL_DEFAULT,
    rewardsAddr,
    USDC_DECIMALS
  )
  await collateral.deployed()
  return { collateral, chainlinkFeed }
}

describe('CTokenV3Collateral', () => {
  let CTokenV3CollateralFactory: ContractFactory

  beforeEach(async () => {
    const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
    const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()
    CTokenV3CollateralFactory = await ethers.getContractFactory('CTokenV3Collateral', {
      libraries: { OracleLib: oracleLib.address },
    })
  })

  describe('Constructor validation', () => {
    it('Should validate targetName correctly', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDCtoUSDPriceFeedAddr,
          cUSDCv3Addr,
          compAddr,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.constants.HashZero,
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          rewardsAddr,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('targetName missing')
    })

    it('Should not allow missing defaultThreshold', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDCtoUSDPriceFeedAddr,
          cUSDCv3Addr,
          compAddr,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          0,
          DELAY_UNTIL_DEFAULT,
          rewardsAddr,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('defaultThreshold zero')
    })

    it('Should not allow missing delayUntilDefault', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDCtoUSDPriceFeedAddr,
          cUSDCv3Addr,
          compAddr,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          0,
          rewardsAddr,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('delayUntilDefault zero')
    })

    it('Should not allow missing rewardERC20', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDCtoUSDPriceFeedAddr,
          cUSDCv3Addr,
          ZERO_ADDRESS,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          rewardsAddr,
          USDC_DECIMALS
        )
      ).to.be.revertedWith('rewardERC20 missing')
    })

    it('Should not allow missing referenceERC20Decimals', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDCtoUSDPriceFeedAddr,
          cUSDCv3Addr,
          compAddr,
          rTokenMaxTradeVolume,
          ORACLE_TIMEOUT,
          ethers.utils.formatBytes32String('USD'),
          DEFAULT_THRESHOLD,
          DELAY_UNTIL_DEFAULT,
          rewardsAddr,
          0
        )
      ).to.be.revertedWith('referenceERC20Decimals missing')
    })

    it('Should not allow missing rewardsAddr', async () => {
      await expect(
        CTokenV3CollateralFactory.deploy(
          1,
          USDCtoUSDPriceFeedAddr,
          cUSDCv3Addr,
          compAddr,
          rTokenMaxTradeVolume,
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

    // Nothing changes if attempt to refresh after default for ATokens/CTokens
    // AToken
    let prevWhenDefault: bigint = (await collateral.whenDefault()).toBigInt()
    await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.whenDefault()).to.equal(prevWhenDefault)

    // CToken
    prevWhenDefault = (await collateral.whenDefault()).toBigInt()
    await expect(collateral.refresh()).to.not.emit(collateral, 'DefaultStatusChanged')
    expect(await collateral.status()).to.equal(CollateralStatus.DISABLED)
    expect(await collateral.whenDefault()).to.equal(prevWhenDefault)
  })

  // it('Updates status in case of hard default', async () => {
  //   // Check initial state
  //   expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
  //   expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
  //   expect(await aTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
  //   expect(await cTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

  //   expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)
  //   expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)
  //   expect(await aTokenCollateral.whenDefault()).to.equal(MAX_UINT256)
  //   expect(await cTokenCollateral.whenDefault()).to.equal(MAX_UINT256)

  //   // Decrease rate for AToken and CToken, will disable collateral immediately
  //   await aToken.setExchangeRate(fp('0.99'))
  //   await cToken.setExchangeRate(fp('0.95'))

  //   // Force updates - Should update whenDefault and status for Atokens/CTokens
  //   await expect(tokenCollateral.refresh()).to.not.emit(tokenCollateral, 'DefaultStatusChanged')
  //   expect(await tokenCollateral.status()).to.equal(CollateralStatus.SOUND)
  //   expect(await tokenCollateral.whenDefault()).to.equal(MAX_UINT256)

  //   await expect(usdcCollateral.refresh()).to.not.emit(usdcCollateral, 'DefaultStatusChanged')
  //   expect(await usdcCollateral.status()).to.equal(CollateralStatus.SOUND)
  //   expect(await usdcCollateral.whenDefault()).to.equal(MAX_UINT256)

  //   const hardDefaultCollaterals = [aTokenCollateral, cTokenCollateral]
  //   for (const coll of hardDefaultCollaterals) {
  //     // Set next block timestamp - for deterministic result
  //     await setNextBlockTimestamp((await getLatestBlockTimestamp()) + 1)

  //     const expectedDefaultTimestamp: BigNumber = bn(await getLatestBlockTimestamp()).add(1)
  //     await expect(coll.refresh())
  //       .to.emit(coll, 'DefaultStatusChanged')
  //       .withArgs(CollateralStatus.SOUND, CollateralStatus.DISABLED)
  //     expect(await coll.status()).to.equal(CollateralStatus.DISABLED)
  //     expect(await coll.whenDefault()).to.equal(expectedDefaultTimestamp)
  //   }
  // })

  // it('Reverts if price is stale', async () => {
  //   await advanceTime(ORACLE_TIMEOUT.toString())

  //   // Check new prices
  //   await expect(usdcCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
  //   await expect(tokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
  //   await expect(cTokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
  //   await expect(aTokenCollateral.strictPrice()).to.be.revertedWith('StalePrice()')
  // })

  // it('Enters IFFY state when price becomes stale', async () => {
  //   await advanceTime(ORACLE_TIMEOUT.toString())
  //   await usdcCollateral.refresh()
  //   await tokenCollateral.refresh()
  //   await cTokenCollateral.refresh()
  //   await aTokenCollateral.refresh()
  //   expect(await usdcCollateral.status()).to.equal(CollateralStatus.IFFY)
  //   expect(await tokenCollateral.status()).to.equal(CollateralStatus.IFFY)
  //   expect(await cTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
  //   expect(await aTokenCollateral.status()).to.equal(CollateralStatus.IFFY)
  // })

  // it('Reverts if Chainlink feed reverts or runs out of gas, maintains status - Fiat', async () => {
  //   const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
  //     await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
  //   )

  //   const invalidTokenCollateral: FiatCollateral = <FiatCollateral>(
  //     await FiatCollateralFactory.deploy(
  //       1,
  //       invalidChainlinkFeed.address,
  //       await tokenCollateral.erc20(),
  //       ZERO_ADDRESS,
  //       await tokenCollateral.maxTradeVolume(),
  //       await tokenCollateral.oracleTimeout(),
  //       await tokenCollateral.targetName(),
  //       await tokenCollateral.defaultThreshold(),
  //       await tokenCollateral.delayUntilDefault()
  //     )
  //   )

  //   // Reverting with no reason
  //   await invalidChainlinkFeed.setSimplyRevert(true)
  //   await expect(invalidTokenCollateral.refresh()).to.be.revertedWith('')
  //   expect(await invalidTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

  //   // Runnning out of gas (same error)
  //   await invalidChainlinkFeed.setSimplyRevert(false)
  //   await expect(invalidTokenCollateral.refresh()).to.be.revertedWith('')
  //   expect(await invalidTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
  // })

  // it('Reverts if Chainlink feed reverts or runs out of gas, maintains status - ATokens Fiat', async () => {
  //   const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
  //     await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
  //   )

  //   const invalidATokenCollateral: ATokenFiatCollateral = <ATokenFiatCollateral>(
  //     await ATokenFiatCollateralFactory.deploy(
  //       1,
  //       invalidChainlinkFeed.address,
  //       await aTokenCollateral.erc20(),
  //       await aTokenCollateral.rewardERC20(),
  //       await aTokenCollateral.maxTradeVolume(),
  //       await aTokenCollateral.oracleTimeout(),
  //       await aTokenCollateral.targetName(),
  //       await aTokenCollateral.defaultThreshold(),
  //       await aTokenCollateral.delayUntilDefault()
  //     )
  //   )

  //   // Reverting with no reason
  //   await invalidChainlinkFeed.setSimplyRevert(true)
  //   await expect(invalidATokenCollateral.refresh()).to.be.revertedWith('')
  //   expect(await invalidATokenCollateral.status()).to.equal(CollateralStatus.SOUND)

  //   // Runnning out of gas (same error)
  //   await invalidChainlinkFeed.setSimplyRevert(false)
  //   await expect(invalidATokenCollateral.refresh()).to.be.revertedWith('')
  //   expect(await invalidATokenCollateral.status()).to.equal(CollateralStatus.SOUND)
  // })

  // it('Reverts if Chainlink feed reverts or runs out of gas, maintains status - CTokens Fiat', async () => {
  //   const invalidChainlinkFeed: InvalidMockV3Aggregator = <InvalidMockV3Aggregator>(
  //     await InvalidMockV3AggregatorFactory.deploy(8, bn('1e8'))
  //   )

  //   const invalidCTokenCollateral: CTokenFiatCollateral = <CTokenFiatCollateral>(
  //     await CTokenFiatCollateralFactory.deploy(
  //       1,
  //       invalidChainlinkFeed.address,
  //       await cTokenCollateral.erc20(),
  //       await cTokenCollateral.rewardERC20(),
  //       await cTokenCollateral.maxTradeVolume(),
  //       await cTokenCollateral.oracleTimeout(),
  //       await cTokenCollateral.targetName(),
  //       await cTokenCollateral.defaultThreshold(),
  //       await cTokenCollateral.delayUntilDefault(),
  //       18,
  //       compoundMock.address
  //     )
  //   )

  //   // Reverting with no reason
  //   await invalidChainlinkFeed.setSimplyRevert(true)
  //   await expect(invalidCTokenCollateral.refresh()).to.be.revertedWith('')
  //   expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)

  //   // Runnning out of gas (same error)
  //   await invalidChainlinkFeed.setSimplyRevert(false)
  //   await expect(invalidCTokenCollateral.refresh()).to.be.revertedWith('')
  //   expect(await invalidCTokenCollateral.status()).to.equal(CollateralStatus.SOUND)
  // })
})
