// test/01_MetaNodeStakeTest.ts
import { expect } from "chai";
import hre from "hardhat";
import { upgrades } from "@openzeppelin/hardhat-upgrades";
import type { HardhatUpgrades } from "@openzeppelin/hardhat-upgrades";

describe("stake test", function () {
    let admin: any, user1: any, user2: any, a0: any;
    let user3: any;
    let erc20Contract: any, stakeProxyContract: any;
    let ethers: any, upgradesApi: HardhatUpgrades, provider: any;

    const metaNodePerBlock = 100n;
    const blockHight = 10000;
    // 解除质押的锁定区块数
    const unstakeLockedBlocks = 10;
    const zeroAddress = "0x0000000000000000000000000000000000000000";

    before(async function () {
        // Hardhat 3: 显式创建网络连接
        const connection = await hre.network.create();
        ethers = connection.ethers;
        provider = ethers.provider;  // 使用 ethers 包装的 provider（支持 getBlockNumber/getBalance 等）
        upgradesApi = await upgrades(hre, connection);
    });

    it("deploy", async function () {
        // 部署 ERC20 合约
        [a0, admin, user1, user2, user3] = await ethers.getSigners();
        const erc20 = await ethers.getContractFactory("MetaNodeToken");
        erc20Contract = await erc20.connect(admin).deploy();
        await erc20Contract.waitForDeployment();
        const erc20ddress = await erc20Contract.getAddress();
        console.log("erc20ddress::", erc20ddress);
        expect(erc20ddress).to.length.gt(0);

        // 当前区块高度
        const blockNumber = await provider.getBlockNumber();
        console.log("当前区块高度::", blockNumber);
        // 部署 MetaNodeStake
        const metaNodeStake = await ethers.getContractFactory("MetaNodeStake");
        stakeProxyContract = await upgradesApi.deployProxy(
            metaNodeStake.connect(admin),
            [erc20ddress, blockNumber, blockNumber + blockHight, metaNodePerBlock],
            { kind: "uups" }
        );
        await stakeProxyContract.waitForDeployment();
        const metaNodeStakeAddress = await stakeProxyContract.getAddress();
        console.log("metaNodeStakeContract::", metaNodeStakeAddress);
        expect(metaNodeStakeAddress).to.length.gt(0);
        // 部署后新增 eth 质押池
        await stakeProxyContract.connect(admin).addPool(zeroAddress, 5, BigInt(1E15), unstakeLockedBlocks, false);
        const poolLength = await stakeProxyContract.poolLength();
        expect(poolLength).to.length.gt(0);
    });

    it("setMetaNode", async () => {
        const erc20 = await ethers.getContractFactory("MetaNodeToken");
        erc20Contract = await erc20.connect(admin).deploy();
        await erc20Contract.waitForDeployment();
        const erc20ddress = await erc20Contract.getAddress();

        await stakeProxyContract.connect(admin).setMetaNode(erc20ddress);
        const newERC20 = await stakeProxyContract.MetaNode();
        expect(newERC20).to.eq(erc20ddress);
    });

    it("pauseWithdraw", async () => {
        await stakeProxyContract.connect(admin).pauseWithdraw();
        const res = await stakeProxyContract.withdrawPaused();
        expect(res).to.true;
    });

    it("unpauseWithdraw", async () => {
        await stakeProxyContract.connect(admin).unpauseWithdraw();
        const res = await stakeProxyContract.withdrawPaused();
        expect(res).to.false;
    });

    it("pauseClaim", async () => {
        await stakeProxyContract.connect(admin).pauseClaim();
        const res = await stakeProxyContract.claimPaused();
        expect(res).to.true;
    });

    it("unpauseClaim", async () => {
        await stakeProxyContract.connect(admin).unpauseClaim();
        const res = await stakeProxyContract.claimPaused();
        expect(res).to.false;
    });

    it("pause", async () => {
        // admin 暂停合约
        await stakeProxyContract.connect(admin).pause();
        const paused = await stakeProxyContract.paused();
        expect(paused).to.true;

        // 暂停后 deposit 应该 revert
        await expect(
            stakeProxyContract.connect(user1).depositETH({ value: ethers.parseEther("1") })
        ).to.revert(ethers);

        // 暂停后 unstake 应该 revert
        await expect(
            stakeProxyContract.connect(user1).unstake(0, ethers.parseEther("1"))
        ).to.revert(ethers);

        // 非 admin 不能暂停
        await expect(
            stakeProxyContract.connect(user1).pause()
        ).to.revert(ethers);
    });

    it("unpause", async () => {
        // admin 恢复合约
        await stakeProxyContract.connect(admin).unpause();
        const paused = await stakeProxyContract.paused();
        expect(paused).to.false;

        // 非 admin 不能恢复
        await expect(
            stakeProxyContract.connect(user1).unpause()
        ).to.revert(ethers);
    });

    it("setStartBlock", async () => {
        // 当前区块高度
        const blockNumber = await provider.getBlockNumber();
        const startBlock = blockNumber;
        await stakeProxyContract.connect(admin).setStartBlock(startBlock);
        const res = await stakeProxyContract.startBlock();
        expect(res).to.eq(startBlock);
    });

    it("setEndBlock", async () => {
        const startBlock = await stakeProxyContract.startBlock();
        const endBlock = startBlock + 100n;
        await stakeProxyContract.connect(admin).setEndBlock(endBlock);
        const res = await stakeProxyContract.endBlock();
        expect(res).to.eq(endBlock);
    });

    it("addPool", async () => {
        const tokenAddress = await erc20Contract.getAddress();
        // 质押池的权重，影响奖励分配
        const poolWeight = 10;
        // 最小质押金额
        const minDepositAmount = BigInt(1E18);
        const withUpdate = false;
        await stakeProxyContract.connect(admin).addPool(tokenAddress, poolWeight, minDepositAmount, unstakeLockedBlocks, withUpdate);
        const poolLength = await stakeProxyContract.poolLength();
        expect(poolLength).to.length.gt(1);
    });

    it("updatePool", async () => {
        await stakeProxyContract.connect(admin).updatePool(0, 1E15, 10);
        await stakeProxyContract.connect(admin).setPoolWeight(0, 20, true);
    });

    it("getMultiplier", async () => {
        // 当前区块高度
        const fromBlock: bigint = await stakeProxyContract.startBlock();
        const toBlock = fromBlock + 10n;
        const mul = await stakeProxyContract.getMultiplier(fromBlock, toBlock);
        expect(mul).to.eq(metaNodePerBlock * (toBlock - fromBlock));
    });

    it("deposit", async () => {
        // user1 deposit 10ETH, user2 deposit 20ETH
        await stakeProxyContract.connect(user1).depositETH({ value: ethers.parseEther("10") });
        await stakeProxyContract.connect(user2).depositETH({ value: ethers.parseEther("20") });

        // user3 deposit 200 MetaNodeToken
        await erc20Contract.connect(admin).transfer(user3.address, ethers.parseEther("1000"));
        const proxyAddress = await stakeProxyContract.getAddress();
        await erc20Contract.connect(user3).approve(proxyAddress, ethers.parseEther("200"));
        await stakeProxyContract.connect(user3).deposit(1, ethers.parseEther("200"));

        const user1Stake = await stakeProxyContract.stakingBalance(0, user1.address);
        const user2Stake = await stakeProxyContract.stakingBalance(0, user2.address);
        const user3Stake = await stakeProxyContract.stakingBalance(1, user3.address);
        expect(user1Stake).to.eq(BigInt(10E18));
        expect(user2Stake).to.eq(BigInt(20E18));
        expect(user3Stake).to.eq(BigInt(200E18));
    });

    it("unstake", async () => {
        await stakeProxyContract.connect(user1).unstake(0, ethers.parseEther("2"));
        await stakeProxyContract.connect(user2).unstake(0, ethers.parseEther("2"));
        await stakeProxyContract.connect(user3).unstake(1, ethers.parseEther("10"));

        const user1Stake = await stakeProxyContract.stakingBalance(0, user1.address);
        const user2Stake = await stakeProxyContract.stakingBalance(0, user2.address);
        const user3Stake = await stakeProxyContract.stakingBalance(1, user3.address);
        expect(user1Stake).to.eq(BigInt(8E18));
        expect(user2Stake).to.eq(BigInt(18E18));
        expect(user3Stake).to.eq(BigInt(190E18));

        await stakeProxyContract.massUpdatePools();
    });

    it("withdraw", async () => {
        console.log(user1.address);

        const user1BalanceBefore = await provider.getBalance(user1.address);
        const user2BalanceBefore = await provider.getBalance(user2.address);
        const user3BalanceBefore = await erc20Contract.balanceOf(user3.address);
        console.log("user1BalanceBefore::", user1BalanceBefore);
        console.log("user2BalanceBefore::", user2BalanceBefore);
        console.log("user3BalanceBefore::", user3BalanceBefore);

        // 跳过锁定区块提现（Hardhat 3 + ethers v6: provider.send）
        for (let i = 0; i < unstakeLockedBlocks; i++) {
            await provider.send("evm_mine", []);
        }

        await stakeProxyContract.connect(user1).withdraw(0);
        await stakeProxyContract.connect(user2).withdraw(0);
        await stakeProxyContract.connect(user3).withdraw(1);

        const user1Balance = await provider.getBalance(user1.address);
        const user2Balance = await provider.getBalance(user2.address);
        const user3Balance = await erc20Contract.balanceOf(user3.address);
        console.log("user1Balance::", user1Balance);
        console.log("user2Balance::", user2Balance);
        console.log("user3Balance::", user3Balance);

        const user1BalanceAfter = await provider.getBalance(user1.address);
        const user2BalanceAfter = await provider.getBalance(user2.address);
        const user3BalanceAfter = await erc20Contract.balanceOf(user3.address);
        console.log("user1BalanceAfter::", user1BalanceAfter);
        console.log("user2BalanceAfter::", user2BalanceAfter);
        console.log("user3BalanceAfter::", user3BalanceAfter);

        // eth 余额比较,有 gas, 不完全等于
        expect(user1BalanceAfter - user1BalanceBefore).to.lt(BigInt(2E18)).gt(BigInt(1.9E18));
        expect(user2BalanceAfter - user2BalanceBefore).to.lt(BigInt(2E18)).gt(BigInt(1.9E18));
        expect(user3BalanceAfter - user3BalanceBefore).to.eq(BigInt(10E18));
    });
});
