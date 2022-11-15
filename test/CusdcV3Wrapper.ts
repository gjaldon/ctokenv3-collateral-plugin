import { expect } from 'chai'
import { ethers } from 'hardhat'
import { loadFixture } from '@nomicfoundation/hardhat-network-helpers'
import { USDC_HOLDER, USDC, CUSDC_V3, advanceTime, allocateERC20, exp } from './helpers'
import { makewCSUDC } from './fixtures'

describe('Wrapped CUSDCv3', () => {
  describe('deposit', () => {
    it('deposits max uint256 and mints only available amount of wrapped cusdc', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC)
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateERC20(usdc, USDC_HOLDER, bob.address, balance)
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
      await allocateERC20(usdc, USDC_HOLDER, bob.address, balance)

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

  describe('withdraw', () => {
    it('withdraws underlying balance including revenue', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC)
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateERC20(usdc, USDC_HOLDER, bob.address, balance)

      await usdcAsB.approve(CUSDC_V3, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(USDC, 20000e6)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositFor(bob.address, 10000e6)

      const wrappedBalance = await wcusdcV3.balanceOf(bob.address)
      advanceTime(1000)

      expect(wrappedBalance).to.equal(await wcusdcV3.balanceOf(bob.address))
      // Underlying balance increases over time and is greater than the balance in the wrapped token
      const underlyingBalance = await wcusdcV3.underlyingBalanceOf(bob.address)
      expect(wrappedBalance).to.be.lessThan(underlyingBalance)

      const remainingCusdc = await cusdcV3.balanceOf(bob.address)
      await wcusdcV3AsB.withdrawTo(bob.address, ethers.constants.MaxUint256)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(
        underlyingBalance.toBigInt() + remainingCusdc.toBigInt(),
        1000
      )
    })
  })

  describe('underlying balance', async () => {
    it('returns underlying balance of user which includes revenue', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC)
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateERC20(usdc, USDC_HOLDER, bob.address, balance)

      await usdcAsB.approve(CUSDC_V3, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(USDC, 20000e6)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositFor(bob.address, 10000e6)

      const wrappedBalance = await wcusdcV3.balanceOf(bob.address)
      advanceTime(1000)

      expect(wrappedBalance).to.equal(await wcusdcV3.balanceOf(bob.address))
      // Underlying balance increases over time and is greater than the balance in the wrapped token
      expect(wrappedBalance).to.be.lessThan(await wcusdcV3.underlyingBalanceOf(bob.address))
    })

    it('returns 0 when user has no balance', async () => {
      const { wcusdcV3 } = await loadFixture(makewCSUDC)
      const [_, bob] = await ethers.getSigners()

      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.equal(0)
    })
  })

  describe('underlying exchange rate', async () => {
    it('returns 1e18 when wrapped token has 0 balance', async () => {
      const { wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC)
      expect(await cusdcV3.balanceOf(wcusdcV3.address)).to.equal(0)
      expect(await wcusdcV3.underlyingExchangeRate()).to.equal(exp(1, 18))
    })

    it('returns 1e18 when wrapped token has 0 supply of the underlying token', async () => {
      const { wcusdcV3 } = await loadFixture(makewCSUDC)
      expect(await wcusdcV3.totalSupply()).to.equal(0)
      expect(await wcusdcV3.underlyingExchangeRate()).to.equal(exp(1, 18))
    })

    it('computes exchange rate based on total underlying balance and total supply of wrapped token', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await loadFixture(makewCSUDC)
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateERC20(usdc, USDC_HOLDER, bob.address, balance)

      await usdcAsB.approve(CUSDC_V3, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(USDC, 20000e6)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositFor(bob.address, ethers.constants.MaxUint256)

      const totalSupply = (await wcusdcV3.totalSupply()).toBigInt()
      const underlyingBalance = (await cusdcV3.balanceOf(wcusdcV3.address)).toBigInt()
      expect(await wcusdcV3.underlyingExchangeRate()).to.equal(
        (underlyingBalance * BigInt(1e18)) / totalSupply
      )
    })
  })
})
