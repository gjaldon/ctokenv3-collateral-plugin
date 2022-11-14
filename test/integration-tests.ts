import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import hre, { ethers } from 'hardhat'
import { ContractFactory, Contract } from 'ethers'
import {
  Asset,
  CTokenV3Collateral,
  ERC20Mock,
  OracleLib,
  IAssetRegistry,
  IBasketHandler,
  TestIRToken,
  RTokenAsset,
  FacadeRead,
  FacadeTest,
  MockV3Aggregator,
  ICusdcV3,
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
  whileImpersonating,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  RSR,
  FIX_ONE,
} from './helpers'
import { deployReserveProtocol } from './fixtures'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'

const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199'

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
  let basketHandler: IBasketHandler
  let facadeTest: FacadeTest
  let cusdcV3: ICusdcV3
  let owner: SignerWithAddress
  let addr1: SignerWithAddress
  let addr2: SignerWithAddress

  beforeEach(async () => {
    ;({
      compAsset,
      basketHandler,
      rsrAsset,
      rsr,
      compToken,
      collateral,
      chainlinkFeed,
      rTokenAsset,
      assetRegistry,
      rToken,
      facade,
      facadeTest,
      cusdcV3,
    } = await loadFixture(deployReserveProtocol))
    ;[owner, addr1, addr2] = await ethers.getSigners()
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
    expect(await collateral.isCollateral()).to.equal(true)
    expect(await collateral.erc20()).to.equal(cusdcV3.address)
    expect(await collateral.erc20()).to.equal(CUSDC_V3)
    expect(await cusdcV3.decimals()).to.equal(6)
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

    // Assets
    expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(compAsset.address)
    expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(collateral.address)
    // Collaterals
    expect(await assetRegistry.toColl(ERC20s[3])).to.equal(collateral.address)
  })

  it('Should register simple Basket correctly', async () => {
    // Basket
    expect(await basketHandler.fullyCollateralized()).to.equal(true)
    const backing = await facade.basketTokens(rToken.address)
    expect(backing[0]).to.equal(CUSDC_V3)
    expect(backing.length).to.equal(1)

    // Check other values
    expect(await basketHandler.nonce()).to.be.gt(0n)
    expect(await basketHandler.timestamp()).to.be.gt(0n)
    expect(await basketHandler.status()).to.equal(CollateralStatus.SOUND)
    expect(await facadeTest.callStatic.totalAssetValue(rToken.address)).to.equal(0)
    const [isFallback, price] = await basketHandler.price(true)
    expect(isFallback).to.equal(false)
    expect(price).to.be.closeTo(FIX_ONE, 15n * 10n ** 15n)

    // Check RToken price
    const issueAmount: bigint = 10000n * 10n ** 18n // 1000
    const usdc = await ethers.getContractAt('ERC20Mock', USDC)
    const initialBal = 20000n * 10n ** 6n
    await whileImpersonating(USDC_HOLDER, async (signer) => {
      await usdc.connect(signer).transfer(addr1.address, initialBal)
    })
    await usdc.connect(addr1).approve(CUSDC_V3, ethers.constants.MaxUint256)
    await cusdcV3.connect(addr1).supply(USDC, 20000n * 10n ** 6n)
    await cusdcV3.connect(addr1).approve(rToken.address, ethers.constants.MaxUint256)
    expect(await rToken.connect(addr1).issue(issueAmount)).to.emit(rToken, 'Issuance')

    // Manually mine so that issuance that was started completes
    await ethers.provider.send('evm_mine', [])

    // Price of collateral maps 1:1 with rTokenAsset because it is the only Collateral in the Prime Basket
    expect(await rTokenAsset.strictPrice()).to.equal(await collateral.strictPrice())
  })
})
