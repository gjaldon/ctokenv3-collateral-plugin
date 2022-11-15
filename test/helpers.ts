import hre, { ethers, network } from 'hardhat'
import { expect } from 'chai'
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers'
import { ERC20Mock } from '../typechain-types'

// Addresses
export const RSR = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
export const USDC_USD_PRICE_FEED = '0x8fFfFfd4AfB6115b954Bd326cbe7B4BA576818f6'
export const CUSDC_V3 = '0xc3d688B66703497DAA19211EEdff47f25384cdc3'
export const COMP = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
export const REWARDS = '0x1B0e765F6224C21223AeA2af16c1C46E38885a40'
export const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
export const USDC_HOLDER = '0x0a59649758aa4d66e25f08dd01271e891fe52199'

export const ORACLE_TIMEOUT = 281474976710655n / 2n // type(uint48).max / 2
export const DEFAULT_THRESHOLD = 5n * 10n ** 16n // 0.05
export const DELAY_UNTIL_DEFAULT = 86400n
export const RTOKEN_MAX_TRADE_VOL = 1000000n
export const USDC_DECIMALS = 6

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'
export const MAX_UINT256 = 2n ** 256n - 1n
export const FIX_ONE = 1n * 10n ** 18n

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
  await hre.network.provider.request({
    method: 'hardhat_impersonateAccount',
    params: [address],
  })
  const signer = await ethers.getSigner(address)

  await f(signer)

  await hre.network.provider.request({
    method: 'hardhat_stopImpersonatingAccount',
    params: [address],
  })
  // If anyone ever needs it, we could make sure here that we set the balance at address back to
  // its original quantity...
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

  expect(await token.balanceOf(to)).to.equal(balance)
}

export const exp = (i: Numeric, d: Numeric = 0): bigint => {
  return BigInt(i) * 10n ** BigInt(d)
}
