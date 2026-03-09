# seeker alert

这是一个可运行的 Solana 自动化交易后端 MVP，支持用户配置三类规则：

- DCA（定投）
- Grid（网格）
- Limit Order（挂单）

## 1. 功能

- REST API 管理交易规则（新增/查询/修改开关/删除）
- 后台策略引擎按周期扫描规则
- 根据规则生成订单并交给执行器
- 钱包签名登录（Connect + Sign Message）鉴权
- 默认 `DRY_RUN=true`，先模拟执行，避免误交易

## 2. 快速启动

```bash
npm install
cp .env.example .env
npm run dev
```

服务默认端口：`3000`

健康检查：

```bash
curl http://localhost:3000/health
```

钱包连接演示页：

```bash
open http://localhost:3000/app/wallet.html
```

## 3. 钱包连接鉴权（参考 connect.zip 流程）

接口：

- `GET /api/auth/nonce?wallet=<钱包地址>`
- `POST /api/auth/verify`（提交钱包签名）
- `POST /api/auth/logout`

返回 token 后，调用规则和引擎接口时带：

```bash
Authorization: Bearer <token>
```

你提供的 `connect.zip` 里核心是 `connect + signMessage/signIn`，这里后端已按同样思路接好了签名校验。

## 4. API 示例

### 4.1 创建 DCA

```bash
curl -X POST http://localhost:3000/api/rules \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{
    "name": "SOL/USDC DCA Buy",
    "enabled": true,
    "strategyType": "dca",
    "inputMint": "So11111111111111111111111111111111111111112",
    "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "config": {
      "side": "buy",
      "amountPerInterval": 0.1,
      "intervalMinutes": 30,
      "maxRuns": 100
    }
  }'
```

### 4.2 创建 Grid

```bash
curl -X POST http://localhost:3000/api/rules \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{
    "name": "SOL Grid",
    "enabled": true,
    "strategyType": "grid",
    "inputMint": "So11111111111111111111111111111111111111112",
    "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "config": {
      "lowerPrice": 120,
      "upperPrice": 220,
      "gridCount": 10,
      "amountPerGrid": 0.05
    }
  }'
```

### 4.3 创建挂单

```bash
curl -X POST http://localhost:3000/api/rules \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer <token>' \
  -d '{
    "name": "SOL Limit Buy",
    "enabled": true,
    "strategyType": "limit_order",
    "inputMint": "So11111111111111111111111111111111111111112",
    "outputMint": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
    "config": {
      "side": "buy",
      "triggerPrice": 130,
      "amount": 0.2
    }
  }'
```

### 4.4 手动触发一轮策略

```bash
curl -X POST http://localhost:3000/api/engine/tick \
  -H 'Authorization: Bearer <token>'
```

## 5. 环境变量

- `PORT`: 服务端口
- `SOLANA_RPC_URL`: Solana RPC
- `WALLET_SECRET_KEY`: 执行钱包私钥（可选，实盘时才需要）
- `DRY_RUN`: `true/false`，生产建议先 `true` 验证
- `TICK_INTERVAL_MS`: 策略轮询间隔
- `AUTH_REQUIRED`: 是否启用钱包签名鉴权（默认 `true`）

## 6. 重要说明

当前版本是可运行的框架 MVP，执行器部分保留了实盘接口位点：

- 已接入：规则管理、策略评估、引擎调度、执行流程
- 待接入：Jupiter/DEX 的真实 swap 与下单指令

如果你要，我下一步可以继续补：

1. 前端（React）规则配置页面
2. 接 Jupiter Quote + Swap 实盘交易
3. 风控（单日最大交易额、止盈止损、滑点限制、白名单代币）

## 7. 原生手机钱包登录（已实现）

`mobile` 子项目已支持原生钱包流程（参考你的 `connect.zip`）：

- `MobileWalletProvider` 连接钱包
- `signIn` 原生签名
- 调后端 `POST /api/auth/verify-signin` 换取 token

手机端项目路径：`./mobile`


## Public Repo Notes

This public copy is sanitized for sharing. It excludes local caches, generated files, local keystores, data files, and project-specific Firebase bindings. Set your own Firebase project and backend URL before deployment.
