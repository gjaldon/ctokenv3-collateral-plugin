import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import '@nomicfoundation/hardhat-toolbox'
import 'hardhat-dependency-compiler'
import { HardhatUserConfig } from 'hardhat/config'
import dotenv from 'dotenv'

dotenv.config()

const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || ''

const config: HardhatUserConfig = {
  networks: {
    hardhat: {
      forking: {
        url: MAINNET_RPC_URL,
        blockNumber: 15850930,
      },
    },
  },
  solidity: {
    compilers: [
      {
        version: '0.8.15',
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: '0.8.9',
        settings: {
          optimizer: { enabled: true, runs: 200 },
        },
      },
      {
        version: '0.6.12',
        settings: { optimizer: { enabled: false } },
      },
    ],
  },
  dependencyCompiler: {
    paths: [
      'reserve/contracts/plugins/assets/Asset.sol',
      'reserve/contracts/plugins/trading/GnosisTrade.sol',
      'reserve/contracts/plugins/mocks/ERC20Mock.sol',
      'reserve/contracts/plugins/mocks/GnosisMock.sol',
      'reserve/contracts/plugins/mocks/EasyAuction.sol',
      'reserve/contracts/plugins/mocks/ChainlinkMock.sol',
      'reserve/contracts/plugins/mocks/InvalidChainlinkMock.sol',
      'reserve/contracts/p1/Main.sol',
      'reserve/contracts/p1/mixins/RewardableLib.sol',
      'reserve/contracts/p1/mixins/RecollateralizationLib.sol',
      'reserve/contracts/p1/AssetRegistry.sol',
      'reserve/contracts/p1/BackingManager.sol',
      'reserve/contracts/p1/BasketHandler.sol',
      'reserve/contracts/p1/Broker.sol',
      'reserve/contracts/p1/Deployer.sol',
      'reserve/contracts/p1/Distributor.sol',
      'reserve/contracts/p1/Furnace.sol',
      'reserve/contracts/p1/RevenueTrader.sol',
      'reserve/contracts/p1/RToken.sol',
      'reserve/contracts/p1/StRSR.sol',
      'reserve/contracts/p1/StRSRVotes.sol',
      'reserve/contracts/libraries/Permit.sol',
      'reserve/contracts/facade/FacadeRead.sol',
      'reserve/contracts/facade/FacadeTest.sol',
    ],
  },
}

export default config
