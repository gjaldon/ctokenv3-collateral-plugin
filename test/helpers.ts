import { OracleLib, MockV3Aggregator, AggregatorV3Interface } from '../typechain-types'
import { ethers, network } from 'hardhat'
import { Contract, ContractFactory } from 'ethers'

export const USDC_USD_PRICE_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const CUSDC_V3 = '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
export const COMP_V3 = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
export const REWARDS_ADDR = '0x1B0e765F6224C21223AeA2af16c1C46E38885a40'
export const ORACLE_TIMEOUT = 281474976710655n / 2n // type(uint48).max / 2
export const DEFAULT_THRESHOLD = 5n * 10n ** 16n // 0.05
export const DELAY_UNTIL_DEFAULT = 86400n
export const RTOKEN_MAX_TRADE_VOL = 1000000n
export const USDC_DECIMALS = 6

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const MAX_UINT256 = 2n ** 256n - 1n

export enum CollateralStatus {
  SOUND,
  IFFY,
  DISABLED,
}

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

interface DeployedCollateral {
  collateral: Contract
  chainlinkFeed: AggregatorV3Interface
}

export const deployCollateralWithFeed = async (): Promise<DeployedCollateral> => {
  const chainlinkFeed = await ethers.getContractAt('AggregatorV3Interface', USDC_USD_PRICE_FEED)
  const CTokenV3CollateralFactory = await makeCollateralFactory()
  const collateral = await CTokenV3CollateralFactory.deploy(
    1,
    chainlinkFeed.address,
    CUSDC_V3,
    COMP_V3,
    RTOKEN_MAX_TRADE_VOL,
    ORACLE_TIMEOUT,
    ethers.utils.formatBytes32String('USD'),
    DEFAULT_THRESHOLD,
    DELAY_UNTIL_DEFAULT,
    REWARDS_ADDR,
    USDC_DECIMALS
  )
  await collateral.deployed()
  return { collateral, chainlinkFeed }
}

export const deployCollateral = async (): Promise<DeployedCollateral> => {
  const CTokenV3CollateralFactory = await makeCollateralFactory()
  const MockV3AggregatorFactory: ContractFactory = await ethers.getContractFactory(
    'MockV3Aggregator'
  )
  const chainlinkFeed: MockV3Aggregator = <MockV3Aggregator>(
    await MockV3AggregatorFactory.deploy(6, 1n * 10n ** 6n)
  )

  const collateral = await CTokenV3CollateralFactory.deploy(
    1,
    chainlinkFeed.address,
    CUSDC_V3,
    COMP_V3,
    RTOKEN_MAX_TRADE_VOL,
    ORACLE_TIMEOUT,
    ethers.utils.formatBytes32String('USD'),
    DEFAULT_THRESHOLD,
    DELAY_UNTIL_DEFAULT,
    REWARDS_ADDR,
    USDC_DECIMALS
  )
  await collateral.deployed()
  return { collateral, chainlinkFeed }
}
