import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { expect } from 'chai'
import hre, { ethers, network } from 'hardhat'
import { ContractFactory, Event } from 'ethers'
import {
  Asset,
  CTokenV3Collateral,
  ERC20Mock,
  OracleLib,
  GnosisMock,
  EasyAuction,
  MainP1,
  RewardableLibP1,
  AssetRegistryP1,
  BackingManagerP1,
  BasketHandlerP1,
  DistributorP1,
  RevenueTraderP1,
  FurnaceP1,
  GnosisTrade,
  BrokerP1,
  RTokenP1,
  StRSRP1Votes,
  DeployerP1,
  RecollateralizationLibP1,
  PermitLib,
  TestIMain,
  IAssetRegistry,
  TestIBackingManager,
  IBasketHandler,
  TestIDistributor,
  TestIRToken,
} from '../typechain-types'
import {
  CUSDC_V3,
  ZERO_ADDRESS,
  RTOKEN_MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  COMP_V3,
  REWARDS_ADDR,
  CollateralStatus,
  deployCollateralWithFeed,
  deployCollateral,
  advanceTime,
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
} from './helpers'

const COMP_ADDRESS = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
const RSR_ADDRESS = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
const RSR_PRICE_FEED = '0x759bBC1be8F90eE6457C44abc7d443842a976d02'
const FIX_ONE = 1n * 10n ** 18n
const GNOSIS_EASY_AUCTION = '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101'

describe('Integration tests', () => {
  let compAsset: Asset
  let rsrAsset: Asset
  let rsr: ERC20Mock
  let compToken: ERC20Mock

  beforeEach(async () => {
    console.log(await hre.artifacts.getArtifactPaths())
    compAsset = await (
      await ethers.getContractFactory('Asset')
    ).deploy(
      1n * 10n ** 18n,
      '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5',
      COMP_ADDRESS,
      ZERO_ADDRESS, // also uncertain about this one
      RTOKEN_MAX_TRADE_VOL,
      ORACLE_TIMEOUT
    )

    rsrAsset = await (
      await ethers.getContractFactory('Asset')
    ).deploy(
      7n * 10n ** 15n,
      RSR_PRICE_FEED,
      RSR_ADDRESS,
      ZERO_ADDRESS,
      RTOKEN_MAX_TRADE_VOL,
      ORACLE_TIMEOUT
    )

    rsr = await ethers.getContractAt('ERC20Mock', RSR_ADDRESS)
    compToken = await ethers.getContractAt('ERC20Mock', COMP_ADDRESS)
  })

  it('Should setup assets correctly', async () => {
    // COMP Token
    expect(await compAsset.isCollateral()).to.equal(false)
    expect(await compAsset.erc20()).to.equal(COMP_ADDRESS)
    expect(compToken.address).to.equal(COMP_ADDRESS)
    expect(await compToken.decimals()).to.equal(18)
    expect(await compAsset.strictPrice()).to.be.closeTo(51n * 10n ** 18n, 5n * 10n ** 17n) // Close to $51 USD - Nov 2022
    expect(await compAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
    expect(await compAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    expect(await compAsset.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VOL)

    // RSR Token
    expect(await rsrAsset.isCollateral()).to.equal(false)
    expect(await rsrAsset.erc20()).to.equal(ethers.utils.getAddress(RSR_ADDRESS))
    expect(rsr.address).to.equal(RSR_ADDRESS)
    expect(await rsr.decimals()).to.equal(18)
    expect(await rsrAsset.strictPrice()).to.be.closeTo(645n * 10n ** 13n, 5n * 10n ** 12n) // Close to $0.00645
    expect(await rsrAsset.getClaimCalldata()).to.eql([ZERO_ADDRESS, '0x'])
    expect(await rsrAsset.rewardERC20()).to.equal(ZERO_ADDRESS)
    expect(await rsrAsset.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VOL)
  })

  it('Should setup collateral correctly', async () => {
    const { collateral } = await loadFixture(deployCollateralWithFeed)
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
    expect(claimCallData[0]).to.eql(REWARDS_ADDR)
    expect(claimCallData[1]).to.not.be.empty
    expect(await collateral.rewardERC20()).to.equal(COMP_V3)
    expect(await collateral.rewardsAddr()).to.equal(REWARDS_ADDR)
    expect(await collateral.maxTradeVolume()).to.equal(RTOKEN_MAX_TRADE_VOL)
  })

  const NO_PRICE_DATA_FEED = '0x51597f405303C4377E36123cBc172b13269EA163'

  it('Should handle invalid/stale Price - Collateral', async () => {
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)

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
      REWARDS_ADDR,
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
      REWARDS_ADDR,
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

  interface GnosisFixture {
    gnosis: GnosisMock
    easyAuction: EasyAuction
  }

  async function gnosisFixture(): Promise<GnosisFixture> {
    const GnosisFactory: ContractFactory = await ethers.getContractFactory('GnosisMock')
    const chainId = await network.provider.send('eth_chainId')

    return {
      gnosis: <GnosisMock>await GnosisFactory.deploy(),
      easyAuction: <EasyAuction>await ethers.getContractAt('EasyAuction', GNOSIS_EASY_AUCTION),
    }
  }
  interface IComponents {
    assetRegistry: string
    backingManager: string
    basketHandler: string
    broker: string
    distributor: string
    furnace: string
    rsrTrader: string
    rTokenTrader: string
    rToken: string
    stRSR: string
  }

  interface IImplementations {
    main: string
    trade: string
    components: IComponents
  }

  it('Should register ERC20s and Assets/Collateral correctly', async () => {
    // Deploy implementations
    const MainImplFactory: ContractFactory = await ethers.getContractFactory('MainP1')
    const mainImpl: MainP1 = <MainP1>await MainImplFactory.deploy()

    // Deploy RewardableLib external library
    const RewardableLibFactory: ContractFactory = await ethers.getContractFactory('RewardableLibP1')
    const rewardableLib: RewardableLibP1 = <RewardableLibP1>await RewardableLibFactory.deploy()

    const TradingLibFactory: ContractFactory = await ethers.getContractFactory(
      'RecollateralizationLibP1'
    )
    const tradingLib: RecollateralizationLibP1 = <RecollateralizationLibP1>(
      await TradingLibFactory.deploy()
    )

    const PermitLibFactory: ContractFactory = await ethers.getContractFactory('PermitLib')
    const permitLib: PermitLib = <PermitLib>await PermitLibFactory.deploy()

    const AssetRegImplFactory: ContractFactory = await ethers.getContractFactory('AssetRegistryP1')
    const assetRegImpl: AssetRegistryP1 = <AssetRegistryP1>await AssetRegImplFactory.deploy()

    const BackingMgrImplFactory: ContractFactory = await ethers.getContractFactory(
      'BackingManagerP1',
      {
        libraries: {
          RewardableLibP1: rewardableLib.address,
          RecollateralizationLibP1: tradingLib.address,
        },
      }
    )
    const backingMgrImpl: BackingManagerP1 = <BackingManagerP1>await BackingMgrImplFactory.deploy()

    const BskHandlerImplFactory: ContractFactory = await ethers.getContractFactory(
      'BasketHandlerP1'
    )
    const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

    const DistribImplFactory: ContractFactory = await ethers.getContractFactory('DistributorP1')
    const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

    const RevTraderImplFactory: ContractFactory = await ethers.getContractFactory(
      'RevenueTraderP1',
      { libraries: { RewardableLibP1: rewardableLib.address } }
    )
    const revTraderImpl: RevenueTraderP1 = <RevenueTraderP1>await RevTraderImplFactory.deploy()

    const FurnaceImplFactory: ContractFactory = await ethers.getContractFactory('FurnaceP1')
    const furnaceImpl: FurnaceP1 = <FurnaceP1>await FurnaceImplFactory.deploy()

    const TradeImplFactory: ContractFactory = await ethers.getContractFactory('GnosisTrade')
    const tradeImpl: GnosisTrade = <GnosisTrade>await TradeImplFactory.deploy()

    const BrokerImplFactory: ContractFactory = await ethers.getContractFactory('BrokerP1')
    const brokerImpl: BrokerP1 = <BrokerP1>await BrokerImplFactory.deploy()

    const RTokenImplFactory: ContractFactory = await ethers.getContractFactory('RTokenP1', {
      libraries: { RewardableLibP1: rewardableLib.address, PermitLib: permitLib.address },
    })
    const rTokenImpl: RTokenP1 = <RTokenP1>await RTokenImplFactory.deploy()

    const StRSRImplFactory: ContractFactory = await ethers.getContractFactory('StRSRP1Votes', {
      libraries: { PermitLib: permitLib.address },
    })
    const stRSRImpl: StRSRP1Votes = <StRSRP1Votes>await StRSRImplFactory.deploy()

    // Setup Implementation addresses
    const implementations: IImplementations = {
      main: mainImpl.address,
      trade: tradeImpl.address,
      components: {
        assetRegistry: assetRegImpl.address,
        backingManager: backingMgrImpl.address,
        basketHandler: bskHndlrImpl.address,
        broker: brokerImpl.address,
        distributor: distribImpl.address,
        furnace: furnaceImpl.address,
        rsrTrader: revTraderImpl.address,
        rTokenTrader: revTraderImpl.address,
        rToken: rTokenImpl.address,
        stRSR: stRSRImpl.address,
      },
    }
    const { gnosis } = await gnosisFixture()

    const DeployerFactory: ContractFactory = await ethers.getContractFactory('DeployerP1')
    const deployer = <DeployerP1>(
      await DeployerFactory.deploy(rsr.address, gnosis.address, rsrAsset.address, implementations)
    )

    const config = {
      dist: {
        rTokenDist: 40n, // 2/5 RToken
        rsrDist: 60n, // 3/5 RSR
      },
      minTradeVolume: 1n * 10n ** 22n, // $10k
      rTokenMaxTradeVolume: 1n * 10n ** 24n, // $1M
      shortFreeze: 259200n, // 3 days
      longFreeze: 2592000n, // 30 days
      rewardPeriod: 604800n, // 1 week
      rewardRatio: 2284n * 10n ** 13n, // approx. half life of 30 pay periods
      unstakingDelay: 1209600n, // 2 weeks
      tradingDelay: 0n, // (the delay _after_ default has been confirmed)
      auctionLength: 900n, // 15 minutes
      backingBuffer: 1n * 10n ** 14n, // 0.01%
      maxTradeSlippage: 1n * 10n * 16n, // 1%
      issuanceRate: 25n * 10n ** 13n, // 0.025% per block or ~0.1% per minute
      scalingRedemptionRate: 5n * 10n ** 16n, // 5%
      redemptionRateFloor: 1000000n * 10n * 18n, // 1M RToken
    }
    // Deploy actual contracts
    const [owner] = await ethers.getSigners()
    const receipt = await (
      await deployer.deploy('RTKN RToken', 'RTKN', 'mandate', owner.address, config)
    ).wait()
    const event = receipt.events.find((e: Event) => e.event === 'RTokenCreated')
    const mainAddr = event.args.main
    const main: TestIMain = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)
    const rToken: TestIRToken = <TestIRToken>(
      await ethers.getContractAt('TestIRToken', await main.rToken())
    )

    // Get Core
    const assetRegistry: IAssetRegistry = <IAssetRegistry>(
      await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
    )
    const backingManager: TestIBackingManager = <TestIBackingManager>(
      await ethers.getContractAt('TestIBackingManager', await main.backingManager())
    )
    const basketHandler: IBasketHandler = <IBasketHandler>(
      await ethers.getContractAt('IBasketHandler', await main.basketHandler())
    )
    const distributor: TestIDistributor = <TestIDistributor>(
      await ethers.getContractAt('TestIDistributor', await main.distributor())
    )
    // Check assets/collateral
    const ERC20s = await assetRegistry.erc20s()
    console.log('ERC20s', ERC20s)
    expect(ERC20s[0]).to.equal(rToken.address)
    expect(ERC20s[1]).to.equal(ethers.utils.getAddress(rsr.address))
    // expect(ERC20s[3]).to.equal(compToken.address)
    const { collateral, chainlinkFeed } = await loadFixture(deployCollateral)
    const basket = [rToken, rsr, collateral]

    const initialTokens: string[] = await Promise.all(
      basket.map(async (c): Promise<string> => {
        return await c.erc20()
      })
    )
    expect(ERC20s.slice(4)).to.eql(initialTokens)
    expect(ERC20s.length).to.eql((await facade.basketTokens(rToken.address)).length + 4)
    // // Assets
    // expect(await assetRegistry.toAsset(ERC20s[0])).to.equal(rTokenAsset.address)
    // expect(await assetRegistry.toAsset(ERC20s[1])).to.equal(rsrAsset.address)
    // expect(await assetRegistry.toAsset(ERC20s[2])).to.equal(aaveAsset.address)
    // expect(await assetRegistry.toAsset(ERC20s[3])).to.equal(compAsset.address)
    // expect(await assetRegistry.toAsset(ERC20s[4])).to.equal(daiCollateral.address)
    // expect(await assetRegistry.toAsset(ERC20s[5])).to.equal(aDaiCollateral.address)
    // expect(await assetRegistry.toAsset(ERC20s[6])).to.equal(cDaiCollateral.address)
    // // Collaterals
    // expect(await assetRegistry.toColl(ERC20s[4])).to.equal(daiCollateral.address)
    // expect(await assetRegistry.toColl(ERC20s[5])).to.equal(aDaiCollateral.address)
    // expect(await assetRegistry.toColl(ERC20s[6])).to.equal(cDaiCollateral.address)
  })
})
