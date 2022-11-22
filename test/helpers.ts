import hre, { ethers } from 'hardhat'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import {
  ERC20Mock,
  CometInterface,
  ICometConfigurator,
  ICometProxyAdmin,
  CusdcV3Wrapper,
} from '../typechain-types'

// Mainnet Addresses
export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const USDC_USD_PRICE_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const CUSDC_V3 = '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
export const COMP = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
export const REWARDS = '0x1B0e765F6224C21223AeA2af16c1C46E38885a40'
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
export const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199'
export const COMET_CONFIGURATOR = '0x316f9708bB98af7dA9c68C1C3b5e79039cD336E3'
export const COMET_PROXY_ADMIN = '0x1EC63B5883C3481134FD50D5DAebc83Ecd2E8779'

export const ORACLE_TIMEOUT = 281474976710655n / 2n // type(uint48).max / 2
export const DEFAULT_THRESHOLD = 5n * 10n ** 16n // 0.05
export const DELAY_UNTIL_DEFAULT = 86400n
export const MAX_TRADE_VOL = 1000000n
export const USDC_DECIMALS = 6

export const FIX_ONE = 1n * 10n ** 18n

export enum CollateralStatus {
  SOUND,
  IFFY,
  DISABLED,
}

type ImpersonationFunction<T> = (signer: SignerWithAddress) => Promise<T>

/* whileImpersonating(address, f):

   Set up `signer` to be an ethers transaction signer that impersonates the account address
   `address`. In that context, call f(signer). `address` can be either a contract address or an
   external account, so you can use often this instead of building entire mock contracts.

   Example usage:

   await whileImpersonating(basketHandler.address, async (signer) => {
     await expect(rToken.connect(signer).setBasketsNeeded(fp('1'))
     .to.emit(rToken, 'BasketsNeededChanged')
   })

   This does the following:
   - Sets the basketHandler Eth balance to 2^256-1 (so it has plenty of gas)
   - Calls rToken.setBasketsNeeded _as_ the basketHandler contract,
   - Checks that that call emits the event 'BasketNeededChanged'
*/
export const whileImpersonating = async (address: string, f: ImpersonationFunction<void>) => {
  // Set maximum ether balance at address
  await hre.network.provider.request({
    method: 'hardhat_setBalance',
    params: [address, '0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'],
  })
  const signer = await ethers.getImpersonatedSigner(address)

  await f(signer)
}

export type Numeric = number | bigint

export const allocateERC20 = async (
  token: ERC20Mock,
  from: string,
  to: string,
  balance: Numeric
) => {
  if (typeof balance == 'number') {
    balance = BigInt(balance)
  }

  await whileImpersonating(from, async (signer) => {
    await token.connect(signer).transfer(to, balance)
  })
}

export const allocateUSDC = async (
  to: string,
  balance: Numeric,
  from: string = USDC_HOLDER,
  token: string = USDC
) => {
  const usdc = await ethers.getContractAt('ERC20Mock', token)
  await allocateERC20(usdc, from, to, balance)
}

export const exp = (i: Numeric, d: Numeric = 0): bigint => {
  return BigInt(i) * 10n ** BigInt(d)
}

export const resetFork = async () => {
  // Need to reset state since running the whole test suites to all
  // test cases in this file to fail. Strangely, all test cases
  // pass when running just this file alone.
  await hre.network.provider.request({
    method: 'hardhat_reset',
    params: [
      {
        forking: {
          jsonRpcUrl: process.env.MAINNET_RPC_URL,
          blockNumber: 15850930,
        },
      },
    ],
  })
}

export const enableRewardsAccrual = async (
  cusdcV3: CometInterface,
  baseTrackingSupplySpeed = exp(2, 14)
) => {
  const governorAddr = await cusdcV3.governor()
  const configurator = <ICometConfigurator>(
    await ethers.getContractAt('ICometConfigurator', COMET_CONFIGURATOR)
  )

  await whileImpersonating(governorAddr, async (governor) => {
    await configurator
      .connect(governor)
      .setBaseTrackingSupplySpeed(cusdcV3.address, baseTrackingSupplySpeed)
    const proxyAdmin = <ICometProxyAdmin>(
      await ethers.getContractAt('ICometProxyAdmin', COMET_PROXY_ADMIN)
    )
    await proxyAdmin.connect(governor).deployAndUpgradeTo(configurator.address, cusdcV3.address)
  })
}

export const mintWcUSDC = async (
  usdc: ERC20Mock,
  cusdc: CometInterface,
  wcusdc: CusdcV3Wrapper,
  account: SignerWithAddress,
  amount: bigint
) => {
  await allocateUSDC(account.address, amount)
  await usdc.connect(account).approve(cusdc.address, ethers.constants.MaxUint256)
  await cusdc.connect(account).supply(usdc.address, amount)
  await cusdc.connect(account).allow(wcusdc.address, true)
  await wcusdc.connect(account).depositTo(account.address, amount)
}
