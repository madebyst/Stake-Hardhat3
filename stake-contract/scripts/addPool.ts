// scripts/addPool.ts
import hre from "hardhat";
import type { MetaNodeStake } from "../types/ethers-contracts/index.js";

async function main() {
  const connection = await hre.network.create();
  const { ethers } = connection;

  const MetaNodeStake = await ethers.getContractAt("MetaNodeStake", "0x12f58591069B0bd7033fb306f8496E90E8fA98B2") as unknown as MetaNodeStake;

  // 用于本地测试:
  // const MetaNodeStake = await ethers.getContractAt("MetaNodeStake", "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512");
  const [signer] = await ethers.getSigners();

  console.log("signer::", signer.address);

  // 获取当前 nonce 和待处理交易数
  const nonce = await ethers.provider.getTransactionCount(signer.address, "latest");
  const pendingNonce = await ethers.provider.getTransactionCount(signer.address, "pending");

  console.log("当前 nonce:", nonce);
  console.log("待处理 nonce:", pendingNonce);

  if (pendingNonce > nonce) {
    console.log("警告: 有", pendingNonce - nonce, "个交易待处理，请等待它们完成后再试");
    console.log("建议: 等待 1-2 分钟后重新运行脚本");
    return;
  }

  // 添加延迟函数
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

  try {
    console.log("正在发送交易...");

    // 发送交易时使用更高的 gas price 和明确的 nonce
    const tx = await MetaNodeStake.connect(signer).addPool(
      ethers.ZeroAddress, // TODO: ERC-20 代币的地址
      500,
      100,
      20,
      true,
      {
        nonce: nonce,
        gasLimit: 500000, // 明确设置 gas limit
      }
    );

    console.log("交易已发送，hash:", tx.hash);
    console.log("等待交易确认...");

    // 等待交易确认
    const receipt = await tx.wait(1); // 等待 1 个区块确认
    if (!receipt) {
      throw new Error("交易未在 1 个区块内确认");
    }

    console.log("交易成功! Gas 使用:", receipt.gasUsed.toString());
    console.log("区块号:", receipt.blockNumber);

    // 等待一下再查询，确保状态已更新
    await delay(2000);

    // 查询添加的 pool
    const poolLength = await MetaNodeStake.poolLength();
    console.log("当前 pool 数量:", poolLength.toString());

  } catch (error: any) {
    console.error("错误详情:", error.message);

    if (error.message.includes("in-flight transaction limit")) {
      console.log("\n解决方案:");
      console.log("1. 等待 1-2 分钟让待处理的交易完成");
      console.log("2. 在 Etherscan 上检查你的地址是否有待处理交易: https://sepolia.etherscan.io/address/" + signer.address);
      console.log("3. 考虑升级到付费的 Alchemy 计划以获得更高的速率限制");
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
