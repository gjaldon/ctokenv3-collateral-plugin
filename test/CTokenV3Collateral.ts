import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory, BigNumber } from 'ethers'
import { OracleLib } from '../typechain-types'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'

export const pow10 = (exponent: number): BigNumber => {
  return BigNumber.from(10).pow(exponent)
}

const USDCtoUSDPriceFeedAddr = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
const cUSDCv3Addr = '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
const compAddr = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
const rewardsAddr = '0x1B0e765F6224C21223AeA2af16c1C46E38885a40'
const ORACLE_TIMEOUT = BigNumber.from('281474976710655').div(2) // type(uint48).max / 2
const DEFAULT_THRESHOLD = BigNumber.from(5).mul(pow10(17))
const DELAY_UNTIL_DEFAULT = BigNumber.from('86400')
const rTokenMaxTradeVolume = BigNumber.from(1000000)
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
const USDC_DECIMALS = 6

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
  async function deployCollateral() {
    const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
    const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()
    const CTokenV3CollateralFactory = await ethers.getContractFactory('CTokenV3Collateral', {
      libraries: { OracleLib: oracleLib.address },
    })

    const collateral = await CTokenV3CollateralFactory.deploy(
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
      USDC_DECIMALS
    )
    await collateral.deployed()
    return collateral
  }

  it('Should calculate prices correctly', async () => {
    const collateral = await loadFixture(deployCollateral)
    const chainlinkFeed = await ethers.getContractAt(
      'AggregatorV3Interface',
      USDCtoUSDPriceFeedAddr
    )
    const { answer } = await chainlinkFeed.latestRoundData()
    const decimals = await chainlinkFeed.decimals()

    // Check initial prices
    expect(await collateral.strictPrice()).to.equal(answer.mul(pow10(18 - decimals)))

    // Check refPerTok initial values
    expect(await collateral.refPerTok()).to.equal(1n * 10n ** 18n) // should equal 1e18

    // Update values in Oracles increase by 10-20%
    const newPrice = answer
      .mul(pow10(18 - decimals))
      .add(BigNumber.from(1000).mul(pow10(18 - decimals)))
    const v3Aggregator = await ethers.getContractAt('MockV3Aggregator', USDCtoUSDPriceFeedAddr)
    await v3Aggregator.updateAnswer(newPrice)
    // await setOraclePrice(collateral.address, bn('1.1e8')) // 10%

    // Check new prices
    // expect(await collateral.strictPrice()).to.equal(fp('0.022'))

    // Check refPerTok remains the same
    // expect(await collateral.refPerTok()).to.equal(fp('0.02'))
  })
})
