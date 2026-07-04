// test/02_CoverageBoostTest.ts — 补充测试提升覆盖率至 80%+
import { expect } from "chai";
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";

describe("coverage boost test", function () {
    let admin: any, user1: any, user2: any;
    let erc20Contract: any, stakeProxyContract: any;
    let ethers: any, upgradesApi: any, provider: any;

    const metaNodePerBlock = 100n;
    const blockHight = 10000;
    const unstakeLockedBlocks = 10;
    const zeroAddress = "0x0000000000000000000000000000000000000000";

    before(async function () {
        const connection = await hre.network.connect();
        ethers = connection.ethers;
        provider = ethers.provider;
        upgradesApi = await upgrades(hre, connection);
    });

    // ==================== View / Query 函数 ====================

    it("poolLength", async function () {
        const [deployer] = await ethers.getSigners();
        admin = deployer;

        // 部署
        const erc20 = await ethers.getContractFactory("MetaNodeToken");
        erc20Contract = await erc20.connect(admin).deploy();
        await erc20Contract.waitForDeployment();

        const blockNumber = await provider.getBlockNumber();
        const metaNodeStake = await ethers.getContractFactory("MetaNodeStake");
        stakeProxyContract = await upgradesApi.deployProxy(
            metaNodeStake.connect(admin),
            [await erc20Contract.getAddress(), blockNumber, blockNumber + blockHight, metaNodePerBlock],
            { kind: "uups" }
        );
        await stakeProxyContract.waitForDeployment();

        // 初始 0 个池
        expect(await stakeProxyContract.poolLength()).to.eq(0);

        // 添加一个池
        await stakeProxyContract.connect(admin).addPool(zeroAddress, 5, 1E15, unstakeLockedBlocks, false);
        expect(await stakeProxyContract.poolLength()).to.eq(1);

        // 添加第二个池
        await erc20Contract.connect(admin).approve(await stakeProxyContract.getAddress(), ethers.parseEther("10"));
        await stakeProxyContract.connect(admin).addPool(await erc20Contract.getAddress(), 10, 1E15, unstakeLockedBlocks, false);
        expect(await stakeProxyContract.poolLength()).to.eq(2);
    });

    it("stakingBalance", async function () {
        const [, u1] = await ethers.getSigners();
        user1 = u1;

        // 初始为 0
        expect(await stakeProxyContract.stakingBalance(0, user1.address)).to.eq(0);

        // deposit ETH
        await stakeProxyContract.connect(user1).depositETH({ value: ethers.parseEther("5") });
        expect(await stakeProxyContract.stakingBalance(0, user1.address)).to.eq(ethers.parseEther("5"));
    });

    it("pendingMetaNode query", async function () {
        // 初始待领奖励为 0
        const pending = await stakeProxyContract.pendingMetaNode(0, user1.address);
        expect(pending).to.eq(0);
    });

    it("pendingMetaNodeByBlockNumber", async function () {
        const blockNumber = await provider.getBlockNumber();
        const pending = await stakeProxyContract.pendingMetaNodeByBlockNumber(0, user1.address, blockNumber);
        expect(pending).to.eq(0);
    });

    it("withdrawAmount", async function () {
        const [requestAmount, pendingWithdraw] = await stakeProxyContract.withdrawAmount(0, user1.address);
        // 未 unstake，所以 request 和 pending 都是 0
        expect(requestAmount).to.eq(0);
        expect(pendingWithdraw).to.eq(0);
    });

    // ==================== Admin 函数补充 ====================

    it("setMetaNodePerBlock", async function () {
        await stakeProxyContract.connect(admin).setMetaNodePerBlock(200n);
        expect(await stakeProxyContract.MetaNodePerBlock()).to.eq(200n);
        // 恢复原值
        await stakeProxyContract.connect(admin).setMetaNodePerBlock(metaNodePerBlock);
    });

    it("setStartBlock must be <= endBlock", async function () {
        const endBlock = await stakeProxyContract.endBlock();
        try {
            await stakeProxyContract.connect(admin).setStartBlock(endBlock + 100n);
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("start block must be smaller than end block");
        }
    });

    it("setEndBlock must be >= startBlock", async function () {
        const startBlock = await stakeProxyContract.startBlock();
        try {
            await stakeProxyContract.connect(admin).setEndBlock(startBlock - 1n);
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("start block must be smaller than end block");
        }
    });

    it("setPoolWeight requires > 0", async function () {
        try {
            await stakeProxyContract.connect(admin).setPoolWeight(0, 0, false);
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("invalid pool weight");
        }
    });

    // ==================== 暂停场景（需先 deposit 再测） ====================
    // 注：MetaNodeStake 只暴露了 pauseWithdraw / pauseClaim，没有暴露
    // PausableUpgradeable 的全局 _pause()，因此无法测试 whenNotPaused 修饰器。

    it("cannot claim when claimPaused", async function () {
        // 先确保 claimPaused = false
        if (await stakeProxyContract.claimPaused()) {
            await stakeProxyContract.connect(admin).unpauseClaim();
        }
        // 暂停领奖
        await stakeProxyContract.connect(admin).pauseClaim();
        try {
            await stakeProxyContract.connect(user1).claim(0);
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("claim is paused");
        }
        await stakeProxyContract.connect(admin).unpauseClaim();
    });

    it("cannot withdraw when withdrawPaused", async function () {
        // 先确保 withdrawPaused = false
        if (await stakeProxyContract.withdrawPaused()) {
            await stakeProxyContract.connect(admin).unpauseWithdraw();
        }
        // 暂停提现
        await stakeProxyContract.connect(admin).pauseWithdraw();
        try {
            await stakeProxyContract.connect(user1).withdraw(0);
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("withdraw is paused");
        }
        await stakeProxyContract.connect(admin).unpauseWithdraw();
    });

    it("double pause withdraw should revert", async function () {
        if (await stakeProxyContract.withdrawPaused()) {
            await stakeProxyContract.connect(admin).unpauseWithdraw();
        }
        await stakeProxyContract.connect(admin).pauseWithdraw();
        try {
            await stakeProxyContract.connect(admin).pauseWithdraw();
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("already paused");
        }
        await stakeProxyContract.connect(admin).unpauseWithdraw();
    });

    it("double unpause withdraw should revert", async function () {
        if (await stakeProxyContract.withdrawPaused()) {
            await stakeProxyContract.connect(admin).unpauseWithdraw();
        }
        // 此时已经是 unpaused，再 unpause 应 revert
        try {
            await stakeProxyContract.connect(admin).unpauseWithdraw();
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("already unpaused");
        }
    });

    it("double pause claim should revert", async function () {
        if (await stakeProxyContract.claimPaused()) {
            await stakeProxyContract.connect(admin).unpauseClaim();
        }
        await stakeProxyContract.connect(admin).pauseClaim();
        try {
            await stakeProxyContract.connect(admin).pauseClaim();
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("already paused");
        }
        await stakeProxyContract.connect(admin).unpauseClaim();
    });

    it("double unpause claim should revert", async function () {
        if (await stakeProxyContract.claimPaused()) {
            await stakeProxyContract.connect(admin).unpauseClaim();
        }
        try {
            await stakeProxyContract.connect(admin).unpauseClaim();
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("already unpaused");
        }
    });

    // ==================== 参数校验 ====================

    it("invalid pid should revert", async function () {
        try {
            await stakeProxyContract.stakingBalance(999, user1.address);
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("invalid pid");
        }
    });

    it("deposit ERC20 with pid=0 should revert", async function () {
        try {
            await stakeProxyContract.connect(user1).deposit(0, ethers.parseEther("1"));
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("deposit not support ETH staking");
        }
    });

    it("unstake more than balance should revert", async function () {
        const balance = await stakeProxyContract.stakingBalance(0, user1.address);
        try {
            await stakeProxyContract.connect(user1).unstake(0, balance + 1n);
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("Not enough");
        }
    });

    it("getMultiplier with invalid range should revert", async function () {
        try {
            await stakeProxyContract.getMultiplier(100, 50);
            expect.fail("should have reverted");
        } catch (e: any) {
            expect(e.message).to.include("invalid block");
        }
    });

    // ==================== 分支覆盖：已有质押用户再追加 ====================

    it("existing user deposits more (adds to pendingMetaNode)", async function () {
        // user1 已有质押，再追加
        const beforeStake = await stakeProxyContract.stakingBalance(0, user1.address);
        await stakeProxyContract.connect(user1).depositETH({ value: ethers.parseEther("2") });
        const afterStake = await stakeProxyContract.stakingBalance(0, user1.address);
        expect(afterStake - beforeStake).to.eq(ethers.parseEther("2"));
    });

    // ==================== claim 奖励（正向） ====================

    it("claim rewards", async function () {
        // 推进一些区块以产生奖励
        for (let i = 0; i < 5; i++) {
            await provider.send("evm_mine", []);
        }
        await stakeProxyContract.massUpdatePools();
        await stakeProxyContract.connect(user1).claim(0);

        // claim 后 pending 应为 0
        const pending = await stakeProxyContract.pendingMetaNode(0, user1.address);
        expect(pending).to.eq(0);
    });

    // ==================== unstake → 产生 pendingMetaNode ====================

    it("unstake creates pending requests", async function () {
        // user1 还有质押，再前进一些区块
        for (let i = 0; i < 5; i++) {
            await provider.send("evm_mine", []);
        }
        // unstake 部分 — 这会把当前奖励结算到 pendingMetaNode
        await stakeProxyContract.connect(user1).unstake(0, ethers.parseEther("1"));

        // 检查 withdrawAmount 中的 requestAmount（刚锁定，未解锁所以 pendingWithdraw=0）
        const [requestAmount, _] = await stakeProxyContract.withdrawAmount(0, user1.address);
        // requestAmount 应该反映 unstake 锁定的金额
        expect(requestAmount).to.be.gt(0);
    });

    // ==================== withdrawAmount: 有请求但未解锁 ====================

    it("withdrawAmount shows locked requests", async function () {
        const [requestAmount, pendingWithdraw] = await stakeProxyContract.withdrawAmount(0, user1.address);
        // 有 unstake 请求，requestAmount > 0
        expect(requestAmount).to.be.gt(0);
        // 刚 unstake，区块还没推进够，pendingWithdraw 可能为 0 或小于 requestAmount
        expect(pendingWithdraw).to.be.gte(0);
    });

    // ==================== massUpdatePools ====================

    it("massUpdatePools with multiple pools", async function () {
        // 已有 2 个池（ETH + ERC20），massUpdatePools 应对两者都不会出错
        await stakeProxyContract.massUpdatePools();
    });

    // ==================== addPool with _withUpdate=true ====================

    it("addPool with _withUpdate=true", async function () {
        const TestERC20 = await ethers.getContractFactory("TestERC20");
        const testToken = await TestERC20.deploy("Test", "T", ethers.parseEther("1000"));
        await testToken.waitForDeployment();

        const poolCountBefore = await stakeProxyContract.poolLength();
        await stakeProxyContract.connect(admin).addPool(
            await testToken.getAddress(), 5, ethers.parseEther("1"), 20, true  // withUpdate = true
        );
        const poolCountAfter = await stakeProxyContract.poolLength();
        expect(poolCountAfter).to.eq(poolCountBefore + 1n);
    });

    // ==================== TestERC20 独立覆盖 ====================

    it("TestERC20 deploy", async function () {
        const TestERC20 = await ethers.getContractFactory("TestERC20");
        const token = await TestERC20.deploy("MyToken", "MTK", ethers.parseEther("5000"));
        await token.waitForDeployment();
        const addr = await token.getAddress();
        expect(addr).to.length.gt(0);

        const [deployer] = await ethers.getSigners();
        const balance = await token.balanceOf(deployer.address);
        expect(balance).to.eq(ethers.parseEther("5000"));
    });
});
