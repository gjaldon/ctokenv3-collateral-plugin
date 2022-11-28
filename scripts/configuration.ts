import { ethers } from 'hardhat'

interface NetworkConfig {
  collateralOpts: CollateralOptsConfig
  comet: CometConfig
  cusdcV3Wrapper?: string // Address of the Wrapper token for cUSDCv3. Set this if you want to use an existing deployment of the Wrapper Token
  oracleLib?: string // Address of OracleLib. Set this if you want to use an existing deployment of OracleLib.
}

interface CollateralOptsConfig {
  erc20?: string // Address of the Collateral Token. We set this in the deploy script
  chainlinkFeed: string
  rewardERC20: string
  targetName: string
  oracleTimeout: number | bigint
  fallbackPrice: bigint
  maxTradeVolume: bigint
  defaultThreshold: bigint
  delayUntilDefault: bigint
  reservesThresholdIffy: number | bigint
  reservesThresholdDisabled: number | bigint
}

interface CometConfig {
  address: string
  rewards: string
  comp: string
}

export const networkConfig: { [key: string]: NetworkConfig } = {
  mainnet: {
    // mainnet settings
    collateralOpts: {
      chainlinkFeed: '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6', // Chainlink price feed for USDC:USD
      rewardERC20: '0xc00e94Cb662C3520282E6f5717214004A7f26888', // COMP Token address
      targetName: ethers.utils.formatBytes32String('USD'), // Name of target unit in bytes format
      oracleTimeout: 86400, // Seconds that an oracle value is considered valid
      fallbackPrice: 1n * 10n ** 18n, // Price given when price computation reverts
      maxTradeVolume: 1000000n, // The max trade volume, in UoA
      defaultThreshold: 5n * 10n ** 16n, // A value like 0.05 that represents a deviation tolerance
      delayUntilDefault: 86400n, // The number of seconds deviation must occur before default
      reservesThresholdIffy: 10, // If reserves in Compound III are below this threshold, set the collateral as IFFY
      reservesThresholdDisabled: 1, // If reserves in Compound III are below this threshold, set the collateral as DISABLED
    },
    comet: {
      // Below addresses could be found at https://docs.compound.finance/
      address: '0xc3d688B66703497DAA19211EEdff47f25384cdc3',
      rewards: '0x1B0e765F6224C21223AeA2af16c1C46E38885a40',
      comp: '0xc00e94Cb662C3520282E6f5717214004A7f26888',
    },
  },

  goerli: {
    collateralOpts: {
      chainlinkFeed: '0xAb5c49580294Aff77670F839ea425f5b78ab3Ae7',
      rewardERC20: '0x3587b2F7E0E2D6166d6C14230e7Fe160252B0ba4',
      targetName: ethers.utils.formatBytes32String('USD'),
      oracleTimeout: 86400,
      fallbackPrice: 1n * 10n ** 18n,
      maxTradeVolume: 1000000n,
      defaultThreshold: 5n * 10n ** 16n,
      delayUntilDefault: 86400n,
      reservesThresholdIffy: 10,
      reservesThresholdDisabled: 1,
    },
    comet: {
      // Below addresses could be found at https://docs.compound.finance/
      address: '0x3EE77595A8459e93C2888b13aDB354017B198188',
      rewards: '0xef9e070044d62C38D2e316146dDe92AD02CF2c2c',
      comp: '0x3587b2F7E0E2D6166d6C14230e7Fe160252B0ba4',
    },
  },
}
