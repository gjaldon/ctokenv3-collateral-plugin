import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory } from 'ethers'
import {
  Asset,
  CTokenV3Collateral,
  ERC20Mock,
  OracleLib,
  IAssetRegistry,
  TestIRToken,
  RTokenAsset,
  FacadeRead,
  MockV3Aggregator,
} from '../typechain-types'
import {
  COMP,
  CUSDC_V3,
  ZERO_ADDRESS,
  RTOKEN_MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  REWARDS,
  CollateralStatus,
  advanceTime,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  RSR,
  FIX_ONE,
} from './helpers'
import { deployReserveProtocol } from './fixtures'

describe('Integration tests', () => {
  let compAsset: Asset
  let rsrAsset: Asset
  let rsr: ERC20Mock
  let compToken: ERC20Mock
  let collateral: CTokenV3Collateral
  let assetRegistry: IAssetRegistry
  let rTokenAsset: RTokenAsset
  let rToken: TestIRToken
  let facade: FacadeRead
  let chainlinkFeed: MockV3Aggregator

  beforeEach(async () => {
    ;({
      compAsset,
      rsrAsset,
      rsr,
      compToken,
      collateral,
      chainlinkFeed,
      rTokenAsset,
      assetRegistry,
      rToken,
      facade,
    } = await loadFixture(deployReserveProtocol))
  })

  it('Should setup assets correctly', async () => {
    // COMP Token
    expect(await compAsset.isCollateral()).to.equal(false)
    expect(await compAsset.erc20()).to.equal(COMP)
    expect(compToken.address).to.equal(COMP)
    expect(await compToken.decimals()).to.equal(18)
    expect(await compAsset.strictPrice()).to.be.closeTo(51n * 10n ** 18n, 5n * 10n ** 17n) // Close to $51 USD - Nov 2022
    expect(await compAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
    expect(await compAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    expect(await compAsset.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VOL)

    // RSR Token
    expect(await rsrAsset.isCollateral()).to.equal(false)
    expect(await rsrAsset.erc20()).to.equal(ethers.utils.getAddress(RSR))
    expect(rsr.address).to.equal(RSR)
    expect(await rsr.decimals()).to.equal(18)
    expect(await rsrAsset.strictPrice()).to.be.closeTo(645n * 10n ** 13n, 5n * 10n ** 12n) // Close to $0.00645
    expect(await rsrAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
    expect(await rsrAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    expect(await rsrAsset.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VOL)
  })

  it('Should setup collateral correctly', async () => {
    const token = await ethers.getContractAt('ERC20Mock', CUSDC_V3)

    expect(await collateral.isCollateral()).to.equal(true)
    expect(await collateral.erc20()).to.equal(token.address)
    expect(await collateral.erc20()).to.equal(CUSDC_V3)
    expect(await token.decimals()).to.equal(6)
    expect(await collateral.targetName()).to.equal(ethers.utils.formatBytes32String('USD'))
    expect(await collateral.refPerTok()).to.equal(FIX_ONE)
    expect(await collateral.targetPerRef()).to.equal(FIX_ONE)
    expect(await collateral.pricePerTarget()).to.equal(FIX_ONE)
    expect(await collateral.strictPrice()).to.be.closeTo(FIX_ONE, 5n * 10n ** 16n) // Should always be close to $1

    const claimCallData: string[] = await collateral.getClaimCalldata()
    expect(claimCallData[0]).to.eql(REWARDS)
    expect(claimCallData[1]).to.not.be.empty
    expect(await collateral.rewardERC20()).to.equal(COMP)
    expect(await collateral.rewardsAddr()).to.equal(REWARDS)
    expect(await collateral.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VOL)
  })

  const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

  it('Should handle invalid/stale Price - Collateral', async () => {
    // Reverts with stale price
    await advanceTime(ORACLE_TIMEOUT.toString())
    await expect(collateral.strictPrice()).to.be.revertedWithCustomError(collateral, 'StalePrice')

    // Refresh should mark status IFFY
    await collateral.refresh()
    expect(await collateral.status()).to.equal(CollateralStatus.IFFY)

    // CTokens Collateral with no price
    const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
    const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()
    const nonpriceCtokenCollateral: CTokenV3Collateral = <CTokenV3Collateral>await (
      await ethers.getContractFactory('CTokenV3Collateral', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      FIX_ONE,
      NO_PRICE_DATA_FEED,
      CUSDC_V3,
      compToken.address,
      RTOKEN_MAX_TRADE_VOL,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT,
      REWARDS,
      6
    )

    // Collateral with no price info should revert
    await expect(nonpriceCtokenCollateral.strictPrice()).to.be.reverted

    // Refresh should also revert - status is not modified
    await expect(nonpriceCtokenCollateral.refresh()).to.be.reverted
    expect(await nonpriceCtokenCollateral.status()).to.equal(CollateralStatus.SOUND)

    // Reverts with a feed with zero price
    const invalidpriceCtokenCollateral: CTokenV3Collateral = <CTokenV3Collateral>await (
      await ethers.getContractFactory('CTokenV3Collateral', {
        libraries: { OracleLib: oracleLib.address },
      })
    ).deploy(
      FIX_ONE,
      chainlinkFeed.address,
      CUSDC_V3,
      compToken.address,
      RTOKEN_MAX_TRADE_VOL,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT,
      REWARDS,
      6
    )

    const updateAnswerTx = await chainlinkFeed.updateAnswer(0n)
    await updateAnswerTx.wait()

    // Reverts with zero price
    await expect(invalidpriceCtokenCollateral.strictPrice()).to.be.revertedWithCustomError(
      invalidpriceCtokenCollateral,
      'PriceOutsideRange'
    )

    // Refresh should mark status IFFY
    await invalidpriceCtokenCollateral.refresh()
    expect(await invalidpriceCtokenCollateral.status()).to.equal(CollateralStatus.IFFY)
  })

  it('Should register ERC20s and Assets/Collateral correctly', async () => {
    // Check assets/collateral
    const ERC20s = await assetRegistry.erc20s()

    expect(ERC20s[0]).to.equal(await rTokenAsset.erc20())
    expect(ERC20s[1]).to.equal(await rsrAsset.erc20())
    expect(ERC20s[2]).to.equal(await compAsset.erc20())
    expect(ERC20s[3]).to.equal(await collateral.erc20())

    // No ERC20s backing the RToken yet
    expect(ERC20s.length).to.eql((await facade.basketTokens(rToken.address)).length + 4)

    // Assets
    expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(collateral.address)
    // Collaterals
    expect(await assetRegistry.toColl(ERC20s[3])).to.equal(collateral.address)
  })
})
