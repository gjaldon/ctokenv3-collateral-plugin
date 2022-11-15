import { ethers } from 'hardhat'
import { ContractFactory, Event } from 'ethers'
import {
  DEFAULT_THRESHOLD,
  DELAY_UNTIL_DEFAULT,
  REWARDS,
  USDC_DECIMALS,
  USDC_USD_PRICE_FEED,
  CUSDC_V3,
  COMP,
  RSR,
  ZERO_ADDRESS,
  RTOKEN_MAX_TRADE_VOL,
  ORACLE_TIMEOUT,
  FIX_ONE,
  USDC,
  exp,
} from './helpers'
import {
  AggregatorV3Interface,
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
  RTokenAsset,
  FacadeRead,
  FacadeTest,
  ERC20Mock,
  Asset,
  OracleLib,
  CTokenV3Collateral,
  MockV3Aggregator,
  CometInterface,
  CusdcV3Wrapper,
  CusdcV3Wrapper__factory,
} from '../typechain-types'

const RSR_PRICE_FEED = '0x759bBC1be8F90eE6457C44abc7d443842a976d02'
const GNOSIS_EASY_AUCTION = '0x0b7fFc1f4AD541A4Ed16b40D8c37f0929158D101'

interface GnosisFixture {
  gnosis: GnosisMock
  easyAuction: EasyAuction
}

async function gnosisFixture(): Promise<GnosisFixture> {
  const GnosisFactory: ContractFactory = await ethers.getContractFactory('GnosisMock')

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

export const deployReserveProtocol = async () => {
  // Setup Assets
  const compAsset = <Asset>await (
    await ethers.getContractFactory('Asset')
  ).deploy(
    FIX_ONE,
    '0xdbd020CAeF83eFd542f4De03e3cF0C28A4428bd5',
    COMP,
    ZERO_ADDRESS, // also uncertain about this one
    RTOKEN_MAX_TRADE_VOL,
    ORACLE_TIMEOUT
  )

  const rsrAsset = <Asset>await (
    await ethers.getContractFactory('Asset')
  ).deploy(
    7n * 10n ** 15n, // 0.007
    RSR_PRICE_FEED,
    RSR,
    ZERO_ADDRESS,
    RTOKEN_MAX_TRADE_VOL,
    ORACLE_TIMEOUT
  )

  // Setup ERC20 mocks
  const rsr = <ERC20Mock>await ethers.getContractAt('ERC20Mock', RSR)
  const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

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

  const BskHandlerImplFactory: ContractFactory = await ethers.getContractFactory('BasketHandlerP1')
  const bskHndlrImpl: BasketHandlerP1 = <BasketHandlerP1>await BskHandlerImplFactory.deploy()

  const DistribImplFactory: ContractFactory = await ethers.getContractFactory('DistributorP1')
  const distribImpl: DistributorP1 = <DistributorP1>await DistribImplFactory.deploy()

  const RevTraderImplFactory: ContractFactory = await ethers.getContractFactory('RevenueTraderP1', {
    libraries: { RewardableLibP1: rewardableLib.address },
  })
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
  const event = receipt!.events!.find((e: Event) => e.event === 'RTokenCreated')
  const mainAddr = event!.args!.main
  const main: TestIMain = <TestIMain>await ethers.getContractAt('TestIMain', mainAddr)
  const rToken: TestIRToken = <TestIRToken>(
    await ethers.getContractAt('TestIRToken', await main.rToken())
  )

  // Get Core
  const assetRegistry: IAssetRegistry = <IAssetRegistry>(
    await ethers.getContractAt('IAssetRegistry', await main.assetRegistry())
  )

  // Deploy FacadeRead
  const FacadeReadFactory: ContractFactory = await ethers.getContractFactory('FacadeRead')
  const facade = <FacadeRead>await FacadeReadFactory.deploy()

  // Deploy FacadeTest
  const FacadeTestFactory: ContractFactory = await ethers.getContractFactory('FacadeTest')
  const facadeTest = <FacadeTest>await FacadeTestFactory.deploy()

  const backingManager: TestIBackingManager = <TestIBackingManager>(
    await ethers.getContractAt('TestIBackingManager', await main.backingManager())
  )
  const basketHandler: IBasketHandler = <IBasketHandler>(
    await ethers.getContractAt('IBasketHandler', await main.basketHandler())
  )
  const distributor: TestIDistributor = <TestIDistributor>(
    await ethers.getContractAt('TestIDistributor', await main.distributor())
  )

  const rTokenAsset: RTokenAsset = <RTokenAsset>(
    await ethers.getContractAt('RTokenAsset', await assetRegistry.toAsset(rToken.address))
  )

  const { collateral, chainlinkFeed, cusdcV3 } = await deployCollateral()

  // Register an Asset and a Collateral
  await assetRegistry.connect(owner).register(compAsset.address)
  await assetRegistry.connect(owner).register(collateral.address)

  // Set initial Basket
  const collateralERC20 = await collateral.erc20()
  console.log(FIX_ONE)
  await basketHandler.connect(owner).setPrimeBasket([collateralERC20], [FIX_ONE]) // CUSDC_V3 is 100% of Basket
  await basketHandler.connect(owner).refreshBasket()

  // Set up allowances
  await backingManager.grantRTokenAllowance(collateralERC20)

  return {
    assetRegistry,
    basketHandler,
    collateral,
    chainlinkFeed,
    rTokenAsset,
    facade,
    rToken,
    rsrAsset,
    compAsset,
    rsr,
    compToken,
    facadeTest,
    cusdcV3,
    backingManager,
  }
}

export const makeCollateralFactory = async (): Promise<ContractFactory> => {
  const OracleLibFactory: ContractFactory = await ethers.getContractFactory('OracleLib')
  const oracleLib: OracleLib = <OracleLib>await OracleLibFactory.deploy()
  const CTokenV3CollateralFactory: ContractFactory = await ethers.getContractFactory(
    'CTokenV3Collateral',
    {
      libraries: { OracleLib: oracleLib.address },
    }
  )

  return CTokenV3CollateralFactory
}

interface Collateral {
  collateral: CTokenV3Collateral
  chainlinkFeed: AggregatorV3Interface
}

interface CollateralWithMockFeed {
  collateral: CTokenV3Collateral
  chainlinkFeed: MockV3Aggregator
  cusdcV3: CometInterface
  wcusdcV3: CusdcV3Wrapper
  usdc: ERC20Mock
}

export const deployCollateralWithFeed = async (): Promise<Collateral> => {
  const chainlinkFeed = await ethers.getContractAt('AggregatorV3Interface', USDC_USD_PRICE_FEED)
  const CTokenV3CollateralFactory = await makeCollateralFactory()
  const collateral = <CTokenV3Collateral>(
    await CTokenV3CollateralFactory.deploy(
      1,
      chainlinkFeed.address,
      CUSDC_V3,
      COMP,
      RTOKEN_MAX_TRADE_VOL,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT,
      REWARDS,
      USDC_DECIMALS
    )
  )
  await collateral.deployed()
  return { collateral, chainlinkFeed }
}

export const deployCollateral = async (): Promise<CollateralWithMockFeed> => {
  const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
    'MockV3Aggregator'
  )
  const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(6, exp(1, 6))
  )
  const { cusdcV3, wcusdcV3, usdc } = await makewCSUDC()
  const CTokenV3CollateralFactory = await makeCollateralFactory()
  const collateral = <CTokenV3Collateral>(
    await CTokenV3CollateralFactory.deploy(
      1,
      chainlinkFeed.address,
      wcusdcV3.address,
      COMP,
      RTOKEN_MAX_TRADE_VOL,
      ORACLE_TIMEOUT,
      ethers.utils.formatBytes32String('USD'),
      DEFAULT_THRESHOLD,
      DELAY_UNTIL_DEFAULT,
      REWARDS,
      USDC_DECIMALS
    )
  )
  await collateral.deployed()
  return { collateral, chainlinkFeed, cusdcV3, wcusdcV3, usdc }
}

export const makewCSUDC = async () => {
  const cusdcV3 = <CometInterface>await ethers.getContractAt('CometInterface', CUSDC_V3)
  const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
    await ethers.getContractFactory('CusdcV3Wrapper')
  )
  const wcusdcV3 = <CusdcV3Wrapper>await CusdcV3WrapperFactory.deploy(cusdcV3.address)
  const usdc = await ethers.getContractAt('ERC20Mock', USDC)

  return { cusdcV3, wcusdcV3, usdc }
}
