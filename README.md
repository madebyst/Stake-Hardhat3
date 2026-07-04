# MetaNodeStake 项目分析文档

## 一、项目概述

MetaNodeStake 是一个基于 Solidity 的**多池质押挖矿系统**，部署在以太坊（Sepolia 测试网）上。用户将 ETH 或 ERC20 代币质押到合约中，按区块高度累积获得 MetaNode 奖励代币。系统支持多个独立的质押池，每个池可配置不同的质押代币、权重、最小质押金额和解质押锁定期。

### 技术架构

```
┌─────────────────────┐     ┌────────────────────────────┐
│   stake-fe (前端)    │ ──→ │        Sepolia 链上         │
│   React 应用         │     │                            │
│                      │     │ MetaNodeStake.sol (代理)    │ ← UUPS 可升级
└─────────────────────┘     │   └── 实现合约 (逻辑)        │
                            │ MetaNode.sol                │ ← ERC20 奖励代币
                            │ TestERC20.sol               │ ← 测试用 ERC20
                            └────────────────────────────┘
```

| 层级 | 技术 | 说明 |
|------|------|------|
| 合约框架 | Hardhat v2 (v2.28.6) | 编译、部署、测试、验证 |
| 合约语言 | Solidity ^0.8.20/0.8.22 | 当前实现版本 0.8.22 |
| 代理模式 | UUPS (OpenZeppelin) | 可升级，`UPGRADE_ROLE` 控制 |
| 前端 | React | 支持 ETH + ERC20 双模质押交互 |
| 网络 | Sepolia (测试网) | Chain ID: 11155111 |

---

## 二、核心合约及职责

### 2.1 MetaNodeToken（`MetaNode.sol`）

```solidity
contract MetaNodeToken is ERC20 {
    constructor() ERC20("MetaNodeToken", "MetaNode") {
        _mint(msg.sender, 10000000 * 1e18);
    }
}
```

| 属性 | 值 |
|------|-----|
| 名称 | MetaNodeToken |
| 代号 | MetaNode |
| 总供应量 | 1000 万枚（固定，不可增发） |
| 精度 | 18 位 |
| 职责 | 质押系统的奖励代币 |

- 部署时一次性铸造全部供应量给部署者
- 部署后需手动将代币转入质押合约作为奖励池
- 无 `mint` 接口，总量恒定

### 2.2 MetaNodeStake（`MetaNodeStake.sol`）

核心质押合约，约 839 行。继承体系：

```
Initializable → UUPSUpgradeable → PausableUpgradeable → AccessControlUpgradeable
                                                              ↓
                                                      MetaNodeStake
```

| 职责 | 说明 |
|------|------|
| 质押管理 | 处理 ETH 和 ERC20 代币的存入、解质押、提取 |
| 奖励计算 | 按区块高度 + 池权重 + 用户份额计算 MetaNode 奖励 |
| 池管理 | 创建/更新质押池，配置权重、锁定参数 |
| 权限控制 | ADMIN_ROLE / UPGRADE_ROLE / DEFAULT_ADMIN_ROLE 三级角色 |
| 暂停控制 | 独立的 withdraw 暂停和 claim 暂停开关 |

### 2.3 TestERC20（`TestERC20.sol`）

可自定义名称、代号、初始供应量的 ERC20 代币，用于在 Sepolia 测试网上创建非 ETH 的质押池。

---

## 三、数据结构

### 3.1 Pool（质押池）

```solidity
struct Pool {
    address stTokenAddress;      // 质押代币地址（0x0 = ETH）
    uint256 poolWeight;          // 池权重（占总奖励比例 = poolWeight / totalPoolWeight）
    uint256 lastRewardBlock;     // 上次奖励计算的区块号
    uint256 accMetaNodePerST;    // 累积：每单位质押代币获得的总 MetaNode（×1e18）
    uint256 stTokenAmount;       // 当前池内质押代币总量
    uint256 minDepositAmount;    // 最小单次质押金额
    uint256 unstakeLockedBlocks; // 解质押后锁定的区块数
}
```

- **Pool[0]** 固定为 ETH 池（`stTokenAddress == address(0x0)`）
- **Pool[1+]** 为 ERC20 池
- `accMetaNodePerST` 是核心累积值，随区块高度递增

### 3.2 UnstakeRequest（解质押请求）

```solidity
struct UnstakeRequest {
    uint256 amount;         // 请求解质押的代币数量
    uint256 unlockBlocks;   // 可提取的区块高度
}
```

- 解质押不是立即可取，进入队列等待锁定期结束
- `unlockBlocks = block.number + pool.unstakeLockedBlocks`

### 3.3 User（用户信息）

```solidity
struct User {
    uint256 stAmount;             // 当前质押的代币数量
    uint256 finishedMetaNode;     // 已结算的 MetaNode 奖励（不可逆）
    uint256 pendingMetaNode;      // 待领取的 MetaNode 奖励
    UnstakeRequest[] requests;    // 解质押请求队列（FIFO）
}
```

- `finishedMetaNode` = `(stAmount × accMetaNodePerST) / 1e18`（更新于每次 deposit/unstake 后）
- `pendingMetaNode` = 解质押时固化的待领奖励

### 3.4 全局状态变量

| 变量 | 类型 | 说明 |
|------|------|------|
| `startBlock` | uint256 | 质押开始区块，奖励计算起点 |
| `endBlock` | uint256 | 质押结束区块，奖励计算终点 |
| `MetaNodePerBlock` | uint256 | 每个区块全局产出的 MetaNode 数量 |
| `totalPoolWeight` | uint256 | 所有池权重之和 |
| `pool` | Pool[] | 质押池动态数组 |
| `user` | mapping | `poolId → userAddress → User` |
| `MetaNode` | IERC20 | 奖励代币合约地址 |
| `withdrawPaused` | bool | 暂停提现 |
| `claimPaused` | bool | 暂停领奖 |

### 3.5 存储布局（Storage Layout）

| Slot | 变量 | 类型 |
|------|------|------|
| 0 | startBlock | uint256 |
| 1 | endBlock | uint256 |
| 2 | MetaNodePerBlock | uint256 |
| 3 | withdrawPaused + claimPaused + MetaNode | bool(1) + bool(1) + address(20) |
| 4 | totalPoolWeight | uint256 |
| 5 | pool | Pool[] |
| 6 | user | mapping |

---

## 四、奖励计算逻辑

### 4.1 核心公式

```
待领奖励 = (user.stAmount × pool.accMetaNodePerST) / 1e18
           - user.finishedMetaNode
           + user.pendingMetaNode
```

### 4.2 分步推导

**步骤 1：计算区块跨度倍数**

```
multiplier = (min(block.number, endBlock) - max(lastRewardBlock, startBlock))
             × MetaNodePerBlock
```

`getMultiplier()` 函数自动将区块范围裁剪到 `[startBlock, endBlock]` 内。

**步骤 2：按权重分配**

```
池奖励 = multiplier × pool.poolWeight / totalPoolWeight
```

**步骤 3：累积到每单位质押**

```
accMetaNodePerST += (池奖励 × 1e18) / pool.stTokenAmount
```

**步骤 4：用户份额**

```
用户奖励 = (user.stAmount × accMetaNodePerST) / 1e18 - finishedMetaNode + pendingMetaNode
```

### 4.3 数值示例

假设：
- `MetaNodePerBlock = 1 (×1e18)`
- ETH 池权重 100，总权重 100（独占）
- 用户 A 质押 10 ETH，池总量 100 ETH
- 经过 1000 个区块

```
总奖励 = 1000 × 1e18 × 100 / 100 = 1000e18 MetaNode
accMetaNodePerST = 1000e18 × 1e18 / 100e18 = 10e18
用户 A 奖励 = (10e18 × 10e18) / 1e18 = 100 MetaNode
```

### 4.4 关键设计点

- `accMetaNodePerST` 使用 **1e18 精度放大**避免小数截断
- `finishedMetaNode` 记录"已结算"奖励，防止重复领取
- 质押和解质押时自动触发 `updatePool()` 结算
- 奖励仅在 `[startBlock, endBlock]` 窗口内产生

---

## 五、质押（Stake）流程

### 5.1 ETH 质押 — `depositETH()`

```
用户发送 ETH
      │
      ▼
┌─────────────────────┐
│ 1. require Pool[0]   │  验证是 ETH 池（stTokenAddress == 0x0）
│ 2. require 金额≥最小值 │
│ 3. _deposit(0, msg.value) │
└────────┬────────────┘
         │
         ▼
┌─────────────────────┐
│ _deposit() 内部逻辑:  │
│                     │
│ ① updatePool(0)     │  把这个池的奖励结算到当前区块
│                     │
│ ② 如果用户已有质押:  │
│   结算待领奖励 →     │  pending = (stAmount × acc) / 1e18 - finished
│   pendingMetaNode    │  追加到 user.pendingMetaNode
│                     │
│ ③ 更新用户质押量:   │  user.stAmount += _amount
│ ④ 更新池总量:       │  pool.stTokenAmount += _amount
│ ⑤ 更新已结算奖励:   │  finishedMetaNode = (stAmount × acc) / 1e18
│                     │
│ ⑥ emit Deposit()    │
└─────────────────────┘
```

### 5.2 ERC20 质押 — `deposit(_pid, _amount)`

相比 ETH 质押多一步，这是 ETH 和 ERC20 本质不同造成的：

| 对比 | ETH | ERC20 |
|------|-----|-------|
| 转账方式 | 协议层原生，`msg.value` 自动到账 | 合约调用 `transferFrom`，需主动拉取 |
| 权限控制 | 无（交易附带的 ETH 天然属于接收方） | 需用户提前 `approve` 授权给质押合约 |
| 交互合约 | 1 个（MetaNodeStake） | 2 个（ERC20 代币合约 + MetaNodeStake） |

ETH 是链上原生资产，交易发出时钱就已经在合约账上了。ERC20 是独立合约里的数据——MetaNodeStake 不能直接"拿"用户钱包里的代币，必须先让用户在 ERC20 合约上执行 **approve** 开许可，然后质押合约才能通过 **safeTransferFrom** 把代币拉过来。

```
步骤 1（用户 → ERC20 代币合约）:
  用户调用 approve(MetaNodeStake地址, 金额)
  意思："我允许 MetaNodeStake 合约从我账上划走这么多代币"

步骤 2（用户 → MetaNodeStake）:
┌─────────────────────┐
│ 1. require _pid ≠ 0  │  非 ETH 池
│ 2. require 金额≥最小值 │
│ 3. safeTransferFrom  │  合约调用 ERC20.transferFrom(用户, 合约, 金额)，把钱拉到合约账上
│ 4. _deposit(_pid, _amount) │  更新状态、结算奖励（同 ETH 逻辑）
└─────────────────────┘
```

### 序列图

```
用户                          MetaNodeStake                    ERC20/ETH
 │                                │                               │
 │── depositETH/deposit() ──────→│                               │
 │                                │── updatePool()                │
 │                                │── 结算 pendingMetaNode         │
 │                                │── 更新 stAmount                │
 │                                │── 更新 finishedMetaNode        │
 │                                │── emit Deposit()              │
 │←──────────────────────────────│                               │
```

---

## 六、解质押与提现流程

`unstake` 和 `withdraw` 是两个独立步骤。

### 6.1 解质押 — `unstake(_pid, _amount)`

```
用户请求解质押
      │
      ▼
┌──────────────────────────────────────┐
│ 1. require user.stAmount ≥ _amount   │  余额足够
│ 2. require 未暂停提现                  │
│ 3. updatePool(_pid)                  │  结算池奖励
│ 4. 计算并固化待领奖励                  │  pendingMetaNode += 新奖励
│ 5. user.stAmount -= _amount          │  减少质押
│ 6. 创建 UnstakeRequest:              │
│    {                                 │
│      amount: _amount,                │
│      unlockBlocks: block.number      │
│        + pool.unstakeLockedBlocks    │  ← 锁定 N 个区块
│    }                                 │
│    → push 到 user.requests[]         │
│ 7. pool.stTokenAmount -= _amount     │
│ 8. 更新 finishedMetaNode              │
│ 9. emit RequestUnstake()             │
└──────────────────────────────────────┘
```

### 6.2 提现 — `withdraw(_pid)`

```
用户请求提现（提取已解锁的代币）
      │
      ▼
┌──────────────────────────────────────┐
│ 1. require 未暂停提现                  │
│ 2. 遍历 user.requests[]:             │
│    如果 unlockBlocks ≤ block.number: │  ← 已解锁
│      累计到 pendingWithdraw_         │
│      记录 popNum_++                  │
│    否则 break（FIFO，后面的都是锁定的）│
│ 3. 弹出已处理的请求（数组移位 + pop）  │
│ 4. 转账:                             │
│    - ETH 池 → _safeETHTransfer()     │
│    - ERC20池 → safeTransfer()        │
│ 5. emit Withdraw()                   │
└──────────────────────────────────────┘
```

### 6.3 时序说明

```
deposit()              unstake()               withdraw()
   │                       │                       │
   │←———  收益持续累积  ——→  │←——  收益继续累积  ——→   │
   │                       │                       │
   │                   锁定 N 区块（unstakeLockedBlocks）
   │                   本金冻结，奖励可 claim
   │                       │                       │
   │                       │···········锁定期······→│ unlockBlocks 到达
   │                       │                         本金 + 已解锁代币到账
```

---

## 七、领取奖励流程 — `claim(_pid)`

```
用户领取奖励
      │
      ▼
┌──────────────────────────────────────┐
│ 1. require 未暂停领奖                  │
│ 2. updatePool(_pid)                  │  先结算池奖励
│ 3. 计算待领奖励:                      │
│    pending =                          │
│      (stAmount × accMetaNodePerST)    │
│      / 1e18                           │
│      - finishedMetaNode               │
│      + pendingMetaNode                │
│ 4. if pending > 0:                   │
│      user.pendingMetaNode = 0         │  清零
│      _safeMetaNodeTransfer(msg.sender, │
│        pending)                        │  转账
│ 5. 更新 finishedMetaNode              │
│ 6. emit Claim()                      │
└──────────────────────────────────────┘
```

**_safeMetaNodeTransfer 防护**：如果合约内 MetaNode 余额不足，则转出所有余额（防御性编程）。

---

## 八、权限控制机制

### 8.1 角色定义

```solidity
bytes32 public constant ADMIN_ROLE   = keccak256("admin_role");
bytes32 public constant UPGRADE_ROLE = keccak256("upgrade_role");
```

| 角色 | 持有者 | 权限 |
|------|--------|------|
| `DEFAULT_ADMIN_ROLE` | 部署者 | 可授予/撤销所有角色 |
| `ADMIN_ROLE` | 部署者（初始）| 池管理、参数设置、暂停/恢复 |
| `UPGRADE_ROLE` | 部署者（初始）| 合约升级（`_authorizeUpgrade` 检查） |

### 8.2 权限函数映射

| 函数 | 权限检查 | 说明 |
|------|----------|------|
| `addPool()` | `onlyRole(ADMIN_ROLE)` | 创建新质押池 |
| `updatePool()` | `onlyRole(ADMIN_ROLE)` | 修改池参数 |
| `setPoolWeight()` | `onlyRole(ADMIN_ROLE)` | 修改池权重 |
| `setStartBlock()` | `onlyRole(ADMIN_ROLE)` | 修改开始区块 |
| `setEndBlock()` | `onlyRole(ADMIN_ROLE)` | 修改结束区块 |
| `setMetaNodePerBlock()` | `onlyRole(ADMIN_ROLE)` | 修改每区块奖励 |
| `setMetaNode()` | `onlyRole(ADMIN_ROLE)` | 修改奖励代币地址 |
| `pauseWithdraw()` | `onlyRole(ADMIN_ROLE)` | 暂停提现 |
| `unpauseWithdraw()` | `onlyRole(ADMIN_ROLE)` | 恢复提现 |
| `pauseClaim()` | `onlyRole(ADMIN_ROLE)` | 暂停领奖 |
| `unpauseClaim()` | `onlyRole(ADMIN_ROLE)` | 恢复领奖 |
| `_authorizeUpgrade()` | `onlyRole(UPGRADE_ROLE)` | UUPS 升级授权 |

### 8.3 修饰器

| 修饰器 | 作用 |
|--------|------|
| `checkPid(_pid)` | 验证池 ID 有效 |
| `whenNotPaused` | 继承自 `PausableUpgradeable` |
| `whenNotClaimPaused` | 额外检查 `claimPaused` |
| `whenNotWithdrawPaused` | 额外检查 `withdrawPaused` |

---

## 九、安全机制

| 机制 | 实现方式 |
|------|----------|
| **防重入** | Checks-Effects-Interactions：状态先更新，然后才转账 |
| **防溢出** | 全部使用 `SafeMath.tryMul/tryDiv/tryAdd/trySub`，失败则 revert |
| **地址验证** | `Address.sol` 库验证合约地址合法性 |
| **安全转账** | ETH 用 `call{value:}()` 而非 `transfer()`，防 2300 gas limit |
| **安全取款** | `_safeMetaNodeTransfer` 余额不足时仅转出可用余额 |
| **暂停防护** | 独立的提现/领奖暂停开关，事故时可紧急冻结 |
| **升级控制** | UUPS 模式 + `UPGRADE_ROLE`，只有授权者可升级 |
| **输入校验** | 所有公开函数均校验参数有效性和前置条件 |

---

## 十、时间线与生命周期

```
                    startBlock              endBlock
                        |====================|
部署 ──────────────────→ |  质押窗口 / 奖励区间 |←── 停止接受新质押
                        |                    |
                        | ← 用户随时质押       |←── 不再产生奖励
                        | ← 奖励按区块高度累积  |    但仍可领取已产生的奖励
                        | ← 随时可解质押       |
                        | ← 随时可领奖励       |
```

### 关键约束

- **添加池子**：必须在 `block.number < endBlock` 时
- **奖励计算**：自动裁剪到 `[startBlock, endBlock]` 区间
- **解质押锁定期**：与 startBlock/endBlock 无关，是相对当前区块的偏移量
- **结束后的行为**：
  - ❌ 不能添加新池
  - ❌ 不产生新奖励
  - ✅ 仍可提取本金
  - ✅ 仍可领取已产生的奖励

---

## 十一、设计模式参考

MetaNodeStake 的设计直接参考了 **SushiSwap MasterChef** 合约的经典 DeFi 挖矿模型：

- **多池架构**：一个合约管理多个质押池
- **权重分配**：按池权重比例分配总奖励
- **accPerShare 累积算法**：避免每次奖励分发都要遍历所有用户，Gas 友好
- **deposit/withdraw 时结算**：在用户改变质押量时触发奖励结算，而非被动等待

与 MasterChef 的差异：
- 增加了 **UnstakeRequest 队列** 和 **锁定期** 概念
- 独立的 **提现暂停** 和 **领奖暂停** 开关
- UUPS 代理模式（可升级），MasterChef 通常是不可升级的

---

> 📦 部署与升级的详细分析已移至独立文档：[MetaNodeStake部署与升级详解.md](MetaNodeStake部署与升级详解.md)
>
> 包括：deployProxy 入参解析、代理与实现绑定机制（ERC1967 槽位）、构造函数初始化 vs fallback 转发、upgradeToAndCall 完整调用链路、storage layout 安全约束等。
