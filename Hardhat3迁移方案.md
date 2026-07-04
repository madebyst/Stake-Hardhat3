# MetaNodeStake — Hardhat 2 → Hardhat 3 迁移方案

## 一、背景与目标

### 1.1 为什么迁移

Hardhat 2 将于 **2027 年 6 月 1 日（或 Hegota 硬分叉激活，取较早者）** 到达生命周期终点。此后不再发布任何更新（包括安全修复）。Hardhat 3 是一次**完全重写**，带来：

- ESM 优先架构，拥抱现代 JavaScript 生态
- 显式网络连接（支持单进程多链并发）
- 声明式插件系统（不再有隐式副作用导入）
- 钩子系统替代 extendConfig/extendEnvironment
- 内置加密密钥管理

### 1.2 当前项目状态

| 属性 | 值 |
|------|-----|
| 框架 | Hardhat v2.28.6 |
| Node.js | v25.8.2 |
| Solidity | 0.8.22（pragma ^0.8.20） |
| 代理模式 | UUPS（@openzeppelin/hardhat-upgrades v3） |
| 测试框架 | Mocha + Chai（@nomicfoundation/hardhat-toolbox v5） |
| 合约数量 | 3 个（MetaNodeStake、MetaNodeToken、TestERC20） |
| 脚本数量 | 7 个 JS 脚本 |
| 测试文件 | 1 个（12 个测试用例） |
| 当前 Ignition | 已有一个模块（ignition/modules/MetaNode.js） |

---

## 二、迁移总览（5 步）

整个迁移归结为 **5 类变更**，每类只改一种东西：

### 变更 ①：依赖 — 安装/卸载

```
卸载 12 个旧包 → 安装 6 个新包 → package.json 加 "type": "module"
```

| 操作 | 具体包 |
|------|--------|
| 卸载 | `hardhat@^2`, `@nomicfoundation/hardhat-toolbox`, `@nomicfoundation/hardhat-chai-matchers`, `@nomicfoundation/hardhat-ethers`, `@nomicfoundation/hardhat-ignition`, `@nomicfoundation/hardhat-ignition-ethers`, `@nomicfoundation/hardhat-network-helpers`, `@nomicfoundation/hardhat-verify`, `@openzeppelin/hardhat-upgrades@^3`, `@typechain/ethers-v6`, `@typechain/hardhat`, `typechain`, `hardhat-deploy`, `hardhat-gas-reporter`, `solidity-coverage` |
| 安装 | `hardhat@latest`（v3）, `@nomicfoundation/hardhat-toolbox-mocha-ethers`, `@openzeppelin/hardhat-upgrades@latest`（v4）, `ethers`, `dotenv`, `chai` |
| 不变 | `@openzeppelin/contracts`, `@openzeppelin/contracts-upgradeable` |

### 变更 ②：hardhat.config — CJS → ESM + 显式插件

```
.js → .ts
require → import
module.exports → export default defineConfig({...})
副作用导入 → plugins: [...] 显式注册
process.env → configVariable()
```

```diff
- require("@nomicfoundation/hardhat-toolbox");
- require("@openzeppelin/hardhat-upgrades");
- require("dotenv").config();
- module.exports = { solidity: {...}, networks: {...} };

+ import { defineConfig, configVariable } from "hardhat/config";
+ import hardhatToolbox from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
+ import hardhatUpgrades from "@openzeppelin/hardhat-upgrades";
+ import "dotenv/config";
+
+ export default defineConfig({
+   plugins: [hardhatToolbox, hardhatUpgrades],
+   solidity: {...},
+   networks: {
+     sepolia: {
+       type: "http",
+       chainType: "l1",
+       url: configVariable("SEPOLIA_RPC_URL", "..."),
+       accounts: [configVariable("PRIVATE_KEY", "")],
+     },
+   },
+ });
```

### 变更 ③：脚本 — ethers 来源变了 + upgrades API 变了

```
hre.ethers       → (await hre.network.connect()).ethers
hre.upgrades.xxx → (await upgrades(hre, connection)).xxx
require()        → import
.js              → .ts
```

```diff
- const { ethers, upgrades } = require("hardhat");
- const [signer] = await ethers.getSigners();
- const stake = await upgrades.deployProxy(...);

+ import hre from "hardhat";
+ import { upgrades } from "@openzeppelin/hardhat-upgrades";
+ const { ethers } = await hre.network.connect();
+ const api = await upgrades(hre, connection);
+ const [signer] = await ethers.getSigners();       // ← 不变
+ const stake = await api.deployProxy(...);         // ← api 对象变了
```

> 影响的文件：7 个脚本全部照此模式改。

### 变更 ④：测试 — Chai 断言 + provider API 变了

```
.to.be.reverted       → .to.revert(ethers)
.to.be.revertedWith() → .to.revert(ethers, "msg")
provider.send()       → provider.request()
```

```diff
- await expect(tx).to.be.revertedWith("Not enough staking token balance");
+ await expect(tx).to.revert(ethers, "Not enough staking token balance");

- await hre.network.provider.send("evm_mine");
+ const { provider } = await hre.network.connect();
+ await provider.request({ method: "evm_mine" });
```

> 影响的文件：1 个测试文件，约 12 处断言需改。

### 变更 ⑤：Solidity 合约 + Ignition 模块 — 基本不动

| 文件 | 改动 |
|------|------|
| `contracts/*.sol` 3 个文件 | **零改动**（pragma、import、逻辑全部不变） |
| `ignition/modules/MetaNode.js` | `require` → `import`，`module.exports` → `export default`（纯语法翻译） |
| `.openzeppelin/sepolia.json` | **零改动**（直接复制到新目录） |

### 执行顺序

```
① 装依赖 → ② 改 config → ③ 改脚本 → ④ 改测试 → ⑤ 编译/测试/部署 三步验证
```

---

## 三、详细迁移步骤

### 步骤 1：环境准备

- 确认 Node.js ≥ v22.10.0（当前 v25.8.2 ✅）
- 将 `stake-contract/` 复制到新工作目录，避免直接改原项目
- 备份 `hardhat.config.js`、`package.json`、`scripts/`、`test/`、`ignition/`

### 步骤 2：安装新依赖

- 在 `package.json` 中添加 `"type": "module"`
- 安装 `hardhat@latest`（覆盖旧的 v2）
- 安装 `@nomicfoundation/hardhat-toolbox-mocha-ethers`（替代旧的 toolbox）+ `@openzeppelin/hardhat-upgrades@latest`（v4）
- 保留 `@openzeppelin/contracts` 和 `@openzeppelin/contracts-upgradeable`（不变）
- 可选的旧依赖（`hardhat-deploy`、`hardhat-gas-reporter`、`solidity-coverage`、`typechain` 等）如果留着不碍事，但已经不会被用到

### 步骤 3：重写 hardhat.config

- 新建 `hardhat.config.ts`（旧的 `.js` 文件重命名备份即可）
- 将 `require()` 改为 `import`，`module.exports` 改为 `export default defineConfig({...})`
- 将插件写成 `plugins: [hardhatToolbox, hardhatUpgrades]` 显式注册
- 网络和 Etherscan 配置中的敏感信息改用 `configVariable()` 读取（也支持 fallback 默认值）
- `solidity` 配置块和 optimizer 设置不变

### 步骤 4：迁移 scripts/（7 个文件）

每个脚本做三件事：

1. 文件头：`require("hardhat")` → `import hre from "hardhat"`，`require("upgrades")` → `import { upgrades } from "@openzeppelin/hardhat-upgrades"`
2. 函数体第一行：加 `const { ethers } = await hre.network.connect()`，以及 `const api = await upgrades(hre, connection)`（如果用到 upgrades）
3. 后续 `hre.ethers` 全部改为上面拿到的 `ethers`，`hre.upgrades.xxx` 全部改为 `api.xxx`

`getContractFactory`、`getSigners`、`parseUnits` 等 ethers API 本身不变，只是 `ethers` 的来源变了。

### 步骤 5：迁移 test/（1 个文件）

- `before()` 中先 `const { ethers } = await hre.network.connect()`
- `expect(tx).to.be.reverted` → `expect(tx).to.revert(ethers)`
- `expect(tx).to.be.revertedWith("msg")` → `expect(tx).to.revert(ethers, "msg")`
- `hre.network.provider.send("evm_mine")` → `provider.request({ method: "evm_mine" })`（provider 同样从 connection 解构）
- 其他 `changeEtherBalance`、`changeTokenBalance` 等 matcher 第一个参数也要加 `ethers`

### 步骤 6：迁移 Ignition 模块（1 个文件）

- `require("...")` → `import { buildModule } from "@nomicfoundation/hardhat-ignition/modules"`
- `module.exports =` → `export default`
- `buildModule(...)` 内的声明式逻辑完全不变

### 步骤 7：Solidity 合约

**不碰。** 3 个 `.sol` 文件的 pragma、import、逻辑全部原封不动。

### 步骤 8：更新 npm scripts 和 CI 配置（可选）

- 如果 `package.json` 里有自定义 scripts（如 `deploy`、`test` 等），把文件扩展名从 `.js` 改为 `.ts`
- `.gitignore` 中补充 Hardhat 3 自动生成的 `hardhat.config.d.ts`

### 步骤 9：验证

按顺序执行：

1. `npx hardhat compile` — 3 个合约全部通过
2. `npx hardhat test` — 12 个测试用例全部通过
3. `npx hardhat run scripts/deploy.ts --network localhost` — 本地部署成功

---

## 四、依赖对照表

| Hardhat 2 | Hardhat 3 | 说明 |
|-----------|-----------|------|
| `hardhat@^2.22.8` | `hardhat@latest`（v3） | 核心框架 |
| `@nomicfoundation/hardhat-toolbox@^5.0.0` | `@nomicfoundation/hardhat-toolbox-mocha-ethers` | 按测试框架拆分 |
| `@nomicfoundation/hardhat-chai-matchers@^2.0.0` | 整合进 toolbox-mocha-ethers | 不再独立安装 |
| `@nomicfoundation/hardhat-ethers@^3.0.0` | 整合进 toolbox-mocha-ethers | 不再独立安装 |
| `@nomicfoundation/hardhat-ignition@^0.15.0` | 整合进 Hardhat 3 核心 | 不再独立安装 |
| `@nomicfoundation/hardhat-ignition-ethers@^0.15.0` | 整合进 Hardhat 3 核心 | 不再独立安装 |
| `@nomicfoundation/hardhat-network-helpers@^1.0.0` | 通过 connection 获取 | API 变化 |
| `@nomicfoundation/hardhat-verify@^2.0.0` | 整合进 Hardhat 3 核心 | 不再独立安装 |
| `@openzeppelin/hardhat-upgrades@^3.2.1` | `@openzeppelin/hardhat-upgrades@latest`（v4） | 异步工厂 API |
| `@openzeppelin/contracts@^5.0.2` | `@openzeppelin/contracts@^5.0.2` | **不变** |
| `@openzeppelin/contracts-upgradeable@^5.0.2` | `@openzeppelin/contracts-upgradeable@^5.0.2` | **不变** |
| `ethers@^6.4.0` | `ethers@^6.4.0` | **不变** |
| `dotenv@^16.4.5` | `dotenv@^16.4.5` | **不变** |
| `chai@^4.2.0` | `chai@^4.2.0` | **不变** |
| `@typechain/ethers-v6@^0.5.0` | ❌ 移除 | Hardhat 3 有原生类型生成 |
| `@typechain/hardhat@^9.0.0` | ❌ 移除 | 同上 |
| `typechain@^8.3.0` | ❌ 移除 | 同上 |
| `hardhat-deploy@^0.14.0` | ❌ 移除 | 用 Ignition 替代 |
| `hardhat-gas-reporter@^1.0.8` | ❌ 移除 | Hardhat 3 内置 gas 统计 |
| `solidity-coverage@^0.8.0` | ❌ 移除 | 替换为 `npx hardhat test --coverage` |

---

## 五、合约代码变更

**Solidity 合约不需要任何修改**。以下所有内容保持不变：

- Solidity 版本 pragma（`^0.8.20`）
- OpenZeppelin import 路径
- 合约逻辑
- 继承体系
- 存储布局

唯一需要注意的是如果需要**升级现有的 Sepolia 合约**，必须确保新实现合约的 storage layout 与 `.openzeppelin/sepolia.json` 中记录的一致。

---

## 六、CLI 命令变化

| 操作 | Hardhat 2 | Hardhat 3 |
|------|-----------|-----------|
| 编译 | `npx hardhat compile` | `npx hardhat compile`（不变） |
| 测试 | `npx hardhat test` | `npx hardhat test`（不变） |
| 运行脚本 | `npx hardhat run scripts/x.js --network sepolia` | `npx hardhat run scripts/x.ts --network sepolia` |
| 初始化项目 | `npx hardhat init` | `npx hardhat --init` |
| Ignition 部署 | `npx hardhat ignition deploy ...` | `npx hardhat ignition deploy ...`（不变） |
| 验证 | `npx hardhat verify ...` | `npx hardhat verify ...`（不变） |

---

## 七、验证计划

迁移完成后，按以下顺序验证：

### 6.1 编译验证

```bash
cd /Users/suntong/W3W3/stake-hardhat3/stake-contract
npx hardhat compile
```

预期：3 个合约全部编译通过，无错误。

### 6.2 测试验证

```bash
npx hardhat test
```

预期：全部 12 个测试用例通过。

### 6.3 本地部署验证

```bash
# 终端 1：启动本地节点
npx hardhat node

# 终端 2：部署到本地
npx hardhat run scripts/deploy.ts --network localhost
```

预期：MetaNodeToken 和 MetaNodeStake 代理部署成功，资金转入成功。

### 6.4 Ignition 部署验证

```bash
# 使用 Ignition 模块部署到本地
npx hardhat ignition deploy ignition/modules/MetaNodeToken.ts --network localhost
```

---

## 八、风险与注意事项

### 7.1 高风险项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `@openzeppelin/hardhat-upgrades` API 变化 | 部署/升级脚本全部需要重写 | 严格按照官方迁移指南适配 |
| `hardhat-deploy` 不兼容 | `addPool.js` 等脚本中的 `getContractAt` 调用方式需调整 | Hardhat 3 的 ethers 连接方式替代 |
| 现有 Sepolia 部署无法通过旧脚本管理 | 后续升级需全部切换到新工具链 | 保留 `.openzeppelin/sepolia.json` 文件，确保 v4 插件能正确识别 |
| Node.js v25 兼容性警告 | 之前 v2 有警告，v3 可能仍有 | 关注 Hardhat 3 官方文档的 Node.js 版本支持矩阵 |

### 7.2 中风险项

| 风险 | 影响 | 缓解措施 |
|------|------|----------|
| `hardhat-gas-reporter` 和 `solidity-coverage` 兼容性未知 | 需等待这两个插件发布 v3 兼容版本 | 暂时移除，确认兼容后再加回 |
| typechain 移除 | 不再自动生成 TypeScript 类型 | Hardhat 3 内置类型生成替代 |

### 7.3 .openzeppelin 目录的保留

`.openzeppelin/sepolia.json` 记录了 Sepolia 上所有代理和实现合约的部署历史。**必须保留并迁移到新项目目录**，否则无法通过插件管理已部署的合约升级。
