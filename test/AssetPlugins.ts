import { expect } from 'chai'
import { ethers } from 'hardhat'
import { Asset, ERC20Mock } from '../typechain-types'
import { ERC20 } from '../typechain-types/@openzeppelin/contracts/token/ERC20/ERC20'
import { ZERO_ADDRESS, RTOKEN_MAX_TRADE_VOL, ORACLE_TIMEOUT } from './helpers'

const COMP_ADDRESS = '0xc00e94Cb662C3520282E6f5717214004A7f26888'
const RSR_ADDRESS = '0x320623b8e4ff03373931769a31fc52a4e78b5d70'
const RSR_PRICE_FEED = '0x759bBC1be8F90eE6457C44abc7d443842a976d02'

describe('Integration tests', () => {
  let compAsset: Asset
  let rsrAsset: Asset
  let rsr: ERC20Mock
  let compToken: ERC20Mock

  beforeEach(async () => {
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
})
