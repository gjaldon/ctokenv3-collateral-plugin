import { expect } from 'chai'
import { ethers, network } from 'hardhat'
import { time, mine } from '@nomicfoundation/hardhat-network-helpers'
import { allocateUSDC, COMP, exp, resetFork, enableRewardsAccrual, mintWcUSDC } from './helpers'
import { makewCSUDC } from './fixtures'
import { ERC20Mock } from '../typechain-types'

describe('Wrapped CUSDCv3', () => {
  beforeEach(resetFork)

  describe('deposit', () => {
    it('deposit to own account', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, 20000e6)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.deposit(ethers.constants.MaxUint256)
      expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(balance, 50)
    })

    it('deposits for someone else', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, 20000e6)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.depositTo(don.address, ethers.constants.MaxUint256)

      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
      expect(await wcusdcV3.balanceOf(don.address)).to.be.closeTo(balance, 50)
    })

    it('deposits from a different account', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob, charles, don] = await ethers.getSigners()

      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      const balance = 20000e6
      await allocateUSDC(bob.address, balance)
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, 20000e6)
      expect(await usdc.balanceOf(bob.address)).to.equal(0)

      expect(await wcusdcV3.balanceOf(charles.address)).to.eq(0)
      await cusdcV3AsB.allow(wcusdcV3.address, true)
      await wcusdcV3AsB.connect(bob).allow(don.address, true)
      await wcusdcV3
        .connect(don)
        .depositFrom(bob.address, charles.address, ethers.constants.MaxUint256)

      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
      expect(await wcusdcV3.balanceOf(charles.address)).to.be.closeTo(balance, 50)
    })

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
      await wcusdcV3AsB.depositTo(bob.address, ethers.constants.MaxUint256)
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
      await wcusdcV3AsB.depositTo(bob.address, 10000e6)
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

    it('multiple deposits lead to accurate balances', async () => {
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

      await wcusdcV3AsB.depositTo(bob.address, 10000e6)
      await time.increase(1000)
      await wcusdcV3AsB.depositTo(bob.address, 10000e6)
      await time.increase(1000)
      await wcusdcV3AsB.depositTo(bob.address, 10000e6)
      await time.increase(1000)
      await wcusdcV3AsB.depositTo(bob.address, 10000e6)

      // The more wcUSDCv3 is minted, the higher its value is relative to cUSDCv3.
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.be.gt(balance)
      expect(await wcusdcV3.balanceOf(bob.address)).to.be.closeTo(balance, exp(10, 6))

      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.be.closeTo(
        await cusdcV3.balanceOf(wcusdcV3.address),
        1
      )
    })
  })

  describe('withdraw', () => {
    it('withdraws to own account', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      expect(await wcusdcV3AsB.withdraw(ethers.constants.MaxUint256)).to.changeTokenBalance(
        wcusdcV3,
        bob,
        0
      )

      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(20000e6, 50)
    })

    it('withdraws to a different account', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await wcusdcV3AsB.withdrawTo(don.address, ethers.constants.MaxUint256)

      expect(await cusdcV3.balanceOf(don.address)).to.be.closeTo(20000e6, 50)
      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(0, 50)
      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
    })

    it('withdraws from a different account', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob, charles, don] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))

      await expect(
        wcusdcV3.connect(charles).withdrawFrom(bob.address, don.address, 20000e6)
      ).to.be.revertedWithCustomError(wcusdcV3, 'Unauthorized')

      await wcusdcV3AsB.allow(charles.address, true)
      await wcusdcV3.connect(charles).withdrawFrom(bob.address, don.address, 20000e6)

      expect(await cusdcV3.balanceOf(don.address)).be.closeTo(20000e6, 50)
      expect(await cusdcV3.balanceOf(bob.address)).be.closeTo(0, 50)
      expect(await cusdcV3.balanceOf(charles.address)).to.eq(0)

      expect(await wcusdcV3.balanceOf(bob.address)).to.eq(0)
    })

    it('withdraws all underlying balance via multiple withdrawals', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))

      await time.increase(1000)
      await wcusdcV3AsB.withdraw(10000e6)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(10000e6)
      await time.increase(1000)
      await wcusdcV3AsB.withdraw(10000e6)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(0)
    })

    it('withdraws 0', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await wcusdcV3AsB.withdraw(0)
      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(exp(20000, 6))
    })

    it('updates and principals in withdrawn account', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()
      const wcusdcV3AsB = wcusdcV3.connect(bob)

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await wcusdcV3AsB.withdraw(exp(5000, 6))

      expect(await wcusdcV3.balanceOf(bob.address)).to.equal(exp(15000, 6))
      const bobsCusdc = await wcusdcV3.underlyingBalanceOf(bob.address)
      expect(bobsCusdc).to.be.gt(0)
      expect(bobsCusdc).to.eq(await cusdcV3.balanceOf(wcusdcV3.address))
    })
  })

  describe('transfer', () => {
    it('does not transfer without approval', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))

      await expect(
        wcusdcV3.connect(bob).transferFrom(don.address, bob.address, exp(10000, 6))
      ).to.be.revertedWithCustomError(wcusdcV3, 'Unauthorized')
    })

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
    it('accrues rewards over time', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      expect(await wcusdcV3.baseTrackingAccrued(bob.address)).to.eq(0)
      await enableRewardsAccrual(cusdcV3)
      await time.increase(1000)

      await wcusdcV3.accrueAccount(bob.address)
      expect(await wcusdcV3.baseTrackingAccrued(bob.address)).to.be.gt(0)
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.eq(
        await cusdcV3.balanceOf(wcusdcV3.address)
      )
    })

    it('does not accrue when accruals are not enabled in Comet', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      expect(await wcusdcV3.baseTrackingAccrued(bob.address)).to.eq(0)

      await time.increase(1000)
      expect(await wcusdcV3.baseTrackingAccrued(bob.address)).to.eq(0)
    })
  })

  describe('underlying balance', () => {
    it('returns underlying balance of user which includes revenue', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      const wrappedBalance = await wcusdcV3.balanceOf(bob.address)
      await time.increase(1000)
      expect(wrappedBalance).to.equal(await wcusdcV3.balanceOf(bob.address))
      // Underlying balance increases over time and is greater than the balance in the wrapped token
      expect(wrappedBalance).to.be.lt(await wcusdcV3.underlyingBalanceOf(bob.address))
      expect(await wcusdcV3.underlyingBalanceOf(bob.address)).to.eq(
        await cusdcV3.balanceOf(wcusdcV3.address)
      )

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, exp(20000, 6))
      await time.increase(1000)
      const totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt()

      const contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 1)
      expect(totalBalances).to.be.lt(contractBalance)
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
      const [_, bob, charles, don] = await ethers.getSigners()
      const usdcAsB = usdc.connect(bob)
      const cusdcV3AsB = cusdcV3.connect(bob)

      await network.provider.send('evm_setAutomine', [false])
      await allocateUSDC(bob.address, exp(20000, 6))
      await usdcAsB.approve(cusdcV3.address, ethers.constants.MaxUint256)
      await cusdcV3AsB.supply(usdc.address, exp(20000, 6))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await mine()
      await network.provider.send('evm_setAutomine', [true])

      // Minting more wcUSDC to other accounts should not affect
      // Bob's underlying balance
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, charles, exp(20000, 6))
      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, don, exp(20000, 6))
      await time.increase(100000)

      let totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(charles.address)).toBigInt()

      // There are negligible rounding differences of ~.000002 in favor of the Token
      // contract.
      let contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 2)
      expect(totalBalances).to.be.lt(contractBalance)

      expect(await cusdcV3.balanceOf(bob.address)).to.be.closeTo(
        await wcusdcV3.underlyingBalanceOf(bob.address),
        2
      )

      await wcusdcV3.connect(bob).withdraw(exp(20000, 6))
      await wcusdcV3.connect(don).withdraw(exp(10000, 6))

      totalBalances =
        (await wcusdcV3.underlyingBalanceOf(don.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(bob.address)).toBigInt() +
        (await wcusdcV3.underlyingBalanceOf(charles.address)).toBigInt()
      contractBalance = await cusdcV3.balanceOf(wcusdcV3.address)
      expect(totalBalances).to.be.closeTo(contractBalance, 2)
      expect(totalBalances).to.be.lt(contractBalance)
    })
  })

  describe('exchange rate', async () => {
    it('returns 1e18 when wrapped token has 0 balance', async () => {
      const { wcusdcV3, cusdcV3 } = await makewCSUDC()
      expect(await cusdcV3.balanceOf(wcusdcV3.address)).to.equal(0)
      expect(await wcusdcV3.exchangeRate()).to.equal(exp(1, 18))
    })

    it('returns 1e18 when wrapped token has 0 supply of the underlying token', async () => {
      const { wcusdcV3 } = await makewCSUDC()
      expect(await wcusdcV3.totalSupply()).to.equal(0)
      expect(await wcusdcV3.exchangeRate()).to.equal(exp(1, 18))
    })

    it('computes exchange rate based on total underlying balance and total supply of wrapped token', async () => {
      const { usdc, wcusdcV3, cusdcV3 } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      const totalSupply = (await wcusdcV3.totalSupply()).toBigInt()
      const underlyingBalance = (await cusdcV3.balanceOf(wcusdcV3.address)).toBigInt()
      expect(await wcusdcV3.exchangeRate()).to.equal(
        (underlyingBalance * BigInt(1e18)) / totalSupply
      )
    })
  })

  describe('claiming rewards', () => {
    it('does not claim rewards when user has no permission', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob, don] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      await time.increase(1000)
      await enableRewardsAccrual(cusdcV3)
      await expect(
        wcusdcV3.connect(don).claimTo(bob.address, bob.address)
      ).to.be.revertedWithCustomError(wcusdcV3, 'Unauthorized')

      await wcusdcV3.connect(bob).allow(don.address, true)
      expect(await wcusdcV3.isAllowed(bob.address, don.address)).to.eq(true)
      await expect(wcusdcV3.connect(don).claimTo(bob.address, bob.address)).to.emit(
        wcusdcV3,
        'RewardClaimed'
      )
    })

    it('claims rewards and sends to claimer', async () => {
      const { wcusdcV3, cusdcV3, usdc } = await makewCSUDC()
      const [_, bob] = await ethers.getSigners()

      await mintWcUSDC(usdc, cusdcV3, wcusdcV3, bob, exp(20000, 6))
      const compToken = <ERC20Mock>await ethers.getContractAt('ERC20Mock', COMP)
      expect(await compToken.balanceOf(wcusdcV3.address)).to.equal(0)
      await time.increase(1000)
      await enableRewardsAccrual(cusdcV3)

      await expect(wcusdcV3.connect(bob).claimTo(bob.address, bob.address)).to.emit(
        wcusdcV3,
        'RewardClaimed'
      )
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
      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      await wcusdcV3.connect(don).claimTo(don.address, don.address)
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
      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
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

      await wcusdcV3.connect(bob).claimTo(bob.address, bob.address)
      expect(await wcusdcV3.callStatic.getRewardOwed(bob.address)).to.equal(0)

      await time.increase(1000)
      expect(await wcusdcV3.callStatic.getRewardOwed(bob.address)).to.be.greaterThan(0)
    })
  })
})
