import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { time, mine } from '@nomicfoundation/hardhat-network-helpers'
import { allocateUSDC, COMP, exp, resetFork, enableRewardsAccrual, mintWcUSDC } from './helpers'
import { makewCSUDC } from './fixtures'
import { ERC20Mock } from '../typechain-types'

describe('Wrapped CUSDCv3', () => {
  beforeEach(resetFork)

  describe('deposit', () => {
    it('deposits max uint256 and mints only available amount of wrapped cusdc', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, 20000e6)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositFor(bob.address, ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(balance, 100)
    })

    it('deposits less than available cusdc', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateUSDC(bob.address, balance)

      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, 20000e6)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositFor(bob.address, 10000e6)
      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(10000e6, 100)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(10000e6)
    })

    it('user that deposits must have same baseTrackingIndex as this Token in Comet', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      expect((await cusdcV3.callStatic.userBasic(wcusdcV3.address)).baseTrackingIndex).to.equal(
        await wcusdcV3.baseTrackingIndex(bob.address)
      )
    })

    it('multiple deposits leads to accurate balances and principals', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 40000e6
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, balance)
      await cusdcV3AsB.allow(wcusdcV3.address, true)

      await wcusdcV3AsB.depositFor(bob.address, 10000e6)
      await time.increase(1000)
      await wcusdcV3AsB.depositFor(bob.address, 10000e6)
      await time.increase(1000)
      await wcusdcV3AsB.depositFor(bob.address, 10000e6)
      await time.increase(1000)
      await wcusdcV3AsB.depositFor(bob.address, 10000e6)

      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(40000e6)
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.be.equal(
        await cusdcV3.balanceOf(wcusdcV3.address)
      )
    })
  })

  describe('withdraw', () => {
    it('withdraws all of underlying balance', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))

      await time.increase(1000)
      // Balance of Wrapped Comet should be less than Comet balance due to
      // interest accrual of Comet.
      const cusdcBalance = await wcusdcV3.underlyingBalanceOf(bob.address)
      expect(await wcusdcV3.balanceOf(bob.address)).to.be.lessThan(cusdcBalance)

      await wcusdcV3AsB.withdrawTo(bob.address, ethers.constants.MaxUint256)
      expect(await cusdcV3.balanceOf(wcusdcV3.address)).to.equal(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(0)
      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(cusdcBalance, 50)
    })

    it('withdraws all underlying balance via multiple withdrawals', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))

      await time.increase(1000)
      await wcusdcV3AsB.withdrawTo(bob.address, exp(10000, 6))
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(exp(10000, 6))
      await time.increase(1000)
      await wcusdcV3AsB.withdrawTo(bob.address, exp(10000, 6))
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(0)
    })

    it('withdraws 0', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await wcusdcV3AsB.withdrawTo(bob.address, 0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(exp(20000, 6))
    })
  })

  describe('transfer', () => {
    it('updates accruals and principals in sender and receiver', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, exp(20000, 6))

      await enableRewardsAccrual(cusdcV3)
      await time.increase(1000)

      await wcusdcV3.accrueAccount(don.address)
      await wcusdcV3.accrueAccount(bob.address)

      // Don's rewards accrual should be less than Bob's because he deposited later
      expect(await wcusdcV3.baseTrackingAccrued(don.address)).to.be.lt(
        await wcusdcV3.baseTrackingAccrued(bob.address)
      )

      await expect(
        wcusdcV3.connect(bob).transfer(don.address, exp(10000, 6))
      ).to.changeTokenBalances(wcusdcV3, [bob, don], [-10000e6, 10000e6])

      await time.increase(1000)
      await wcusdcV3.accrueAccount(don.address)
      await wcusdcV3.accrueAccount(bob.address)

      expect(await wcusdcV3.baseTrackingAccrued(don.address)).to.be.gt(
        await wcusdcV3.baseTrackingAccrued(bob.address)
      )

      // Balances are computed from principals so we are indirectly testing the accuracy
      // of Bob's and Don's stored principals here.
      const donsBalance = (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt()
      const bobsBalance = (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt()
      expect(donsBalance).to.be.gt(bobsBalance)
      const totalBalances = donsBalance + bobsBalance

      // Rounding in favor of the Wrapped Token is happening here. Amount is negligible
      expect(totalBalances).to.be.closeTo(await cusdcV3.balanceOf(wcusdcV3.address), 1)
    })
  })

  describe('accrueAccount', () => {
    // TODO: test that accrue account updates both account in Wrapped Comet and contract balance in Comet
    it('accrues rewards over time', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await allocateUSDC(bob.address, exp(20000, 6))
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, exp(20000, 6))
    })

    // TODO: test that accruals only happen when accruals are enabled in Comet
  })

  describe('underlying balance', () => {
    it('returns underlying balance of user which includes revenue', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      const wrappedBalance = await wcusdcV3.balanceOf(bob.address)
      await time.increase(1000)
      expect(wrappedBalance).to.equal(await wcusdcV3.balanceOf(bob.address))
      // Underlying balance increases over time and is greater than the balance in the wrapped token
      expect(wrappedBalance).to.be.lessThan(await wcusdcV3.underlyingBalanceOf(bob.address))
    })

    it('returns 0 when user has no balance', async () => {
      const { wcusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.equal(0)
    })

    it('also accrues account in Comet to ensure that global indices are updated', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()

      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      const oldTrackingSupplyIndex = (await cusdcV3.totalsBasic()).trackingSupplyIndex

      await time.increase(1000)
      await wcusdcV3.accrueAccount(bob.address)
      expect(oldTrackingSupplyIndex).to.be.lessThan(
        (await cusdcV3.totalsBasic()).trackingSupplyIndex
      )
    })

    it('matches balance in cUSDCv3', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)

      await network.provider.send('evm_setAutomine', [false])
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await allocateUSDC(bob.address, exp(20000, 6))
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, exp(20000, 6))
      await mine(1)
      await network.provider.send('evm_setAutomine', [true])

      expect(await cusdcV3.balanceOf(bob.address)).to.equal(
        await wcusdcV3.underlyingBalanceOf(bob.address)
      )

      await time.increase(100)
      expect(await cusdcV3.balanceOf(bob.address)).to.equal(
        await wcusdcV3.underlyingBalanceOf(bob.address)
      )
    })
  })

  describe('underlying exchange rate', async () => {
    it('returns 1e18 when wrapped token has 0 balance', async () => {
      const { wcusdcV3, cusdcV3 } = await makewCSUDC()
      expect(await cusdcV3.balanceOf(wcusdcV3.address)).to.equal(0)
      expect(await wcusdcV3.underlyingExchangeRate()).to.equal(exp(1, 18))
    })

    it('returns 1e18 when wrapped token has 0 supply of the underlying token', async () => {
      const { wcusdcV3 } = await makewCSUDC()
      expect(await wcusdcV3.totalSupply()).to.equal(0)
      expect(await wcusdcV3.underlyingExchangeRate()).to.equal(exp(1, 18))
    })

    it('computes exchange rate based on total underlying balance and total supply of wrapped token', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      const totalSupply = (await wcusdcV3.totalSupply()).toBigInt()
      const underlyingBalance = (await cusdcV3.balanceOf(wcusdcV3.address)).toBigInt()
      expect(await wcusdcV3.underlyingExchangeRate()).to.equal(
        (underlyingBalance * BigInt(1e18)) / totalSupply
      )
    })
  })

  describe('claiming rewards', () => {
    it('claims rewards and sends to claimer', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)
      await time.increase(1000)
      await enableRewardsAccrual(cusdcV3)
      await wcusdcV3.claim(bob.address)
      expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
    })

    it('claims rewards by participation', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, exp(20000, 6))

      await enableRewardsAccrual(cusdcV3)
      await time.increase(1000)

      expect(await compToken.balanceOf(bob.address)).to.equal(0)
      expect(await compToken.balanceOf(don.address)).to.equal(0)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)

      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.connect(bob).claim(bob.address)
      await wcusdcV3.connect(don).claim(don.address)
      await network.provider.send('evm_setAutomine', [true])
      await mine()

      expect(await compToken.balanceOf(bob.address)).to.be.greaterThan(0)
      expect(await compToken.balanceOf(bob.address)).to.equal(
        await compToken.balanceOf(don.address)
      )
      // Excess COMP left from rounding behavior
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(1e12)
    })

    // In this forked block, rewards accrual is not yet enabled in Comet
    it('claims no rewards when rewards accrual is not enabled', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await time.increase(1000)
      await wcusdcV3.connect(bob).claim(bob.address)
      expect(await compToken.balanceOf(bob.address)).to.equal(0)
    })
  })

  describe('baseTrackingAccrued', () => {
    it('matches baseTrackingAccrued in cUSDCv3 over time', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob, charlie, don] = await ethers.getSigners()

      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      let wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.equal(await wcusdcV3.baseTrackingAccrued(bob.address))

      await wcusdcV3.accrueAccount(bob.address)

      wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.equal(await wcusdcV3.baseTrackingAccrued(bob.address))
      expect((await cusdcV3.callStatic.userBasic(wcusdcV3.address)).baseTrackingIndex).to.equal(
        await wcusdcV3.baseTrackingIndex(bob.address)
      )

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, charlie, exp(20000, 6))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, exp(20000, 6))

      await time.increase(1000)

      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.accrueAccount(bob.address)
      await wcusdcV3.accrueAccount(charlie.address)
      await wcusdcV3.accrueAccount(don.address)
      await mine()
      await network.provider.send('evm_setAutomine', [true])

      // All users' total accrued rewards in Wrapped cUSDC should closely match Wrapped cUSDC's
      // accrued rewards in cUSDC.
      const bobBTA = await wcusdcV3.baseTrackingAccrued(bob.address)
      const charlieBTA = await wcusdcV3.baseTrackingAccrued(charlie.address)
      const donBTA = await wcusdcV3.baseTrackingAccrued(don.address)
      const totalUsersAccrued = bobBTA.add(charlieBTA).add(donBTA)
      wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.be.closeTo(totalUsersAccrued, 5)
    })

    it('matches baseTrackingAccrued in cUSDCv3 after withdrawals', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()

      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, exp(20000, 6))

      await time.increase(1000)
      await wcusdcV3.connect(bob).withdrawTo(bob.address, exp(10000, 6))

      await time.increase(1000)

      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.accrueAccount(bob.address)
      await wcusdcV3.accrueAccount(don.address)
      await mine()
      await network.provider.send('evm_setAutomine', [true])

      // All users' total accrued rewards in Wrapped cUSDC should match Wrapped cUSDC's accrued rewards in cUSDC.
      const totalUsersAccrued = (await wcusdcV3.baseTrackingAccrued(bob.address)).add(
        await wcusdcV3.baseTrackingAccrued(don.address)
      )
      const wrappedTokenAccrued = await cusdcV3.baseTrackingAccrued(wcusdcV3.address)
      expect(wrappedTokenAccrued).to.equal(totalUsersAccrued)
    })
  })

  describe('get reward owed', () => {
    it('returns reward owed after accrual and claims', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()

      await enableRewardsAccrual(cusdcV3)
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, exp(20000, 6))

      await time.increase(1000)

      await network.provider.send('evm_setAutomine', [false])
      await wcusdcV3.getRewardOwed(bob.address)
      await wcusdcV3.getRewardOwed(don.address)
      await mine()
      await network.provider.send('evm_setAutomine', [true])

      const bobsReward = await wcusdcV3.callStatic.getRewardOwed(bob.address)
      const donsReward = await wcusdcV3.callStatic.getRewardOwed(don.address)

      expect(bobsReward).to.be.greaterThan(donsReward)
      const accrued =
        (await (await wcusdcV3.baseTrackingAccrued(bob.address)).toBigInt()) * exp(1, 12)
      expect(bobsReward).to.equal(accrued)

      await wcusdcV3.connect(bob).claim(bob.address)
      expect(await wcusdcV3.callStatic.getRewardOwed(bob.address)).to.equal(0)

      await time.increase(1000)
      expect(await wcusdcV3.callStatic.getRewardOwed(bob.address)).to.be.greaterThan(0)
    })
  })
})
