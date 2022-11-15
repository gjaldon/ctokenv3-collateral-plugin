import { expect } from 'chai'
import { ethers } from 'hardhat'
import { ContractFactory } from 'ethers'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { USDC_HOLDER, USDC, CUSDC_V3, advanceTime, whileImpersonating } from './helpers'
import { CusdcV3Wrapper, CusdcV3Wrapper__factory, CometInterface } from '../typechain-types'

const makewCSUDC = async () => {
  const cusdcV3 = <CometInterface>await ethers.getContractAt('CometInterface', CUSDC_V3)
  const CusdcV3WrapperFactory = <CusdcV3Wrapper__factory>(
    await ethers.getContractFactory('CusdcV3Wrapper')
  )
  const wcusdcV3 = <CusdcV3Wrapper>await CusdcV3WrapperFactory.deploy(cusdcV3.address)
  const usdc = await ethers.getContractAt('ERC20Mock', USDC)

  return { cusdcV3, wcusdcV3, usdc }
}

describe('deposit', () => {
  it('deposits max uint256 and mints only available amount of wrapped cusdc', async () => {
    const { usdc, wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC)
    const [_, bob] = await ethers.getSigners()
    const usdcAsB = usdc.connect(bob)
    const cusdcV3AsB = cusdcV3.connect(bob)
    const wcusdcV3AsB = wcusdcV3.connect(bob)

    const balance = 20000e6
    await whileImpersonating(USDC_HOLDER, async (signer) => {
      await usdc.connect(signer).transfer(bob.address, balance)
    })
    expect(await usdc.balanceOf(bob.address)).to.equal(balance)

    await usdcAsB.approve(CUSDC_V3, ethers.constants.MaxUint256)
    await cusdcV3AsB.supply(USDC, 20000e6)
    expect(await usdc.balanceOf(bob.address)).to.equal(0)

    await cusdcV3AsB.allow(wcusdcV3.address, true)
    await wcusdcV3AsB.depositFor(bob.address, ethers.constants.MaxUint256)
    expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
    expect(await usdc.balanceOf(bob.address)).to.equal(0)
    expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(balance, 100)
  })

  it('deposits less than available cusdc', async () => {
    const { usdc, wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC)
    const [_, bob] = await ethers.getSigners()
    const usdcAsB = usdc.connect(bob)
    const cusdcV3AsB = cusdcV3.connect(bob)
    const wcusdcV3AsB = wcusdcV3.connect(bob)

    const balance = 20000e6
    await whileImpersonating(USDC_HOLDER, async (signer) => {
      await usdc.connect(signer).transfer(bob.address, balance)
    })
    expect(await usdc.balanceOf(bob.address)).to.equal(balance)

    await usdcAsB.approve(CUSDC_V3, ethers.constants.MaxUint256)
    await cusdcV3AsB.supply(USDC, 20000e6)
    expect(await usdc.balanceOf(bob.address)).to.equal(0)

    await cusdcV3AsB.allow(wcusdcV3.address, true)
    await wcusdcV3AsB.depositFor(bob.address, 10000e6)
    expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(10000e6, 100)
    expect(await usdc.balanceOf(bob.address)).to.equal(0)
    expect(await wcusdcV3.balanceOf(bob.address)).to.equal(10000e6)
  })
})
