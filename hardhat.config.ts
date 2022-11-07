import '@typechain/hardhat'
import '@nomiclabs/hardhat-ethers'
import '@nomicfoundation/hardhat-chai-matchers'
import '@nomicfoundation/hardhat-toolbox'
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
}

export default config
