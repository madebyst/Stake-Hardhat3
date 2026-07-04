// scripts/addERC20Pool.ts
import hre from "hardhat";
import type { MetaNodeStake, TestERC20 } from "../types/ethers-contracts/index.js";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;

  const [signer] = await ethers.getSigners();
  console.log("signer::", signer.address);

  // ============ 1. 部署 ERC20 测试币，并给 deployer mint 一笔 ============
  console.log("\n--- 步骤 1: 部署 ERC20 测试币 ---");

  const TestERC20 = await ethers.getContractFactory("TestERC20");
  const initialSupply = ethers.parseEther("1000000"); // 100万枚
  const testToken = await TestERC20.deploy("Test Stake Token", "TST", initialSupply) as unknown as TestERC20;
  await testToken.waitForDeployment();

  const testTokenAddress = await testToken.getAddress();
  console.log("TestERC20 部署成功，地址:", testTokenAddress);

  const balance = await testToken.balanceOf(signer.address);
  console.log("Deployer 余额:", ethers.formatEther(balance), "TST");

  // ============ 2. 对 Stake 合约执行 addPool ============
  console.log("\n--- 步骤 2: 添加 ERC20 资金池 ---");

  // 注意：填代理地址，不要填实现合约地址
  const STAKE_CONTRACT_ADDRESS = "0x12f58591069B0bd7033fb306f8496E90E8fA98B2";
  // 用于本地测试:
  // const STAKE_CONTRACT_ADDRESS = "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512";

  const MetaNodeStake = await ethers.getContractAt("MetaNodeStake", STAKE_CONTRACT_ADDRESS) as unknown as MetaNodeStake;

  // 获取当前 nonce 和待处理交易数
  const nonce = await ethers.provider.getTransactionCount(signer.address, "latest");
  const pendingNonce = await ethers.provider.getTransactionCount(signer.address, "pending");

  console.log("当前 nonce:", nonce);
  console.log("待处理 nonce:", pendingNonce);

  if (pendingNonce > nonce) {
    console.log("警告: 有", pendingNonce - nonce, "个交易待处理，请等待它们完成后再试");
    return;
  }

  // 添加延迟函数
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    console.log("正在发送 addPool 交易...");

    const tx = await MetaNodeStake.connect(signer).addPool(
      testTokenAddress,   // ERC-20 测试币地址
      500,                // poolWeight: 资金池权重
      ethers.parseEther("1"), // minDepositAmount: 最小质押 1 TST
      20,                 // unstakeLockedBlocks: 解锁等待区块数
      true,               // withUpdate: 更新所有池子
      {
        nonce: nonce,
        gasLimit: 500000,
      }
    );

    console.log("交易已发送，hash:", tx.hash);
    console.log("等待交易确认...");

    const receipt = await tx.wait(1);
    if (!receipt) {
      throw new Error("交易未在 1 个区块内确认");
    }
    console.log("交易成功! Gas 使用:", receipt.gasUsed.toString());
    console.log("区块号:", receipt.blockNumber);

    // 等待状态更新
    await delay(2000);

    // 查询 pool 信息
    const poolLength = await MetaNodeStake.poolLength();
    console.log("\n当前 pool 数量:", poolLength.toString());
    console.log("新添加的 ERC20 Pool ID:", (poolLength - 1n).toString());

  } catch (error: any) {
    console.error("错误详情:", error.message);

    if (error.message.includes("in-flight transaction limit")) {
      console.log("\n解决方案:");
      console.log("1. 等待 1-2 分钟让待处理的交易完成");
      console.log("2. 在 Etherscan 上检查你的地址是否有待处理交易: https://sepolia.etherscan.io/address/" + signer.address);
    }

    throw error;
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
