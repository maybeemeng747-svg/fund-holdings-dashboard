# Fund Holdings Dashboard 项目说明

## 项目定位

这是一个面向基金投资者的本地化持仓管理与监控项目，目标是解决以下问题：

- 基金平台逐步弱化实时收益和盘中估值展示
- 用户希望自己维护一份可控的持仓真源
- 网页看板和投资 Agent 需要统一读取同一份持仓数据
- 截图导入后，需要人工确认再写入，避免 OCR 误识别直接污染真源

这个项目当前采用：

- 本地 OCR 截图导入
- JSON 真源管理
- 确认净值快照
- 盘中实时估算
- 小屏友好的网页看板

## 当前核心能力

### 1. 截图导入

支持从支付宝 / 养基宝持仓截图中提取以下字段：

- 基金名称
- 基金代码
- 持仓金额 / 市值
- 持有份额
- 成本价
- 最新净值
- 日涨幅
- 昨日收益
- 持有收益
- 持有收益率

导入流程是：

1. 上传截图
2. OCR 提取
3. 结构化预览
4. 与当前真源比对 diff
5. 人工确认
6. 写入 JSON
7. 自动生成快照
8. 更新更新日志

### 2. 持仓真源

项目中有三层不同的数据口径：

#### `portfolio/current_holdings.json`

基础持仓真源，主要保存：

- 基金名称
- 基金代码
- 持有份额
- 成本价
- 截图确认后的基础持仓数据

运行时可通过 `HOLDINGS_FILE` 指向外部真源；未设置时使用项目内的
`portfolio/current_holdings.json`，因此新克隆执行 `npm run bootstrap-data` 后即可运行。

#### `portfolio/confirmed_nav_snapshot.json`

当前最准确的确认仓位基线，主要保存：

- 最新确认净值
- 最新确认市值
- 最新确认持有收益
- 最新确认持有收益率

#### `portfolio/realtime_snapshot.json`

盘中实时估算层，主要保存：

- 今日盘中估算涨幅
- 当日收益
- 估算总收益
- 实时覆盖状态

### 3. 网页看板

网页看板提供两层展示：

- 顶部总览
- 热力图基金卡片 + 持仓明细列表

目前顶部总览展示：

- 今日涨幅
- 今日收益
- 基金总持仓金额
- 确认总收益

每只基金卡片目前展示：

- 基金名称
- 今日估算涨幅 / 今日涨幅
- 当日收益
- 仓位占比
- 状态标记，例如：
  - `已更新`
  - `黄金夜盘中`

下方持仓明细列表展示：

- 基金名称
- 基金代码
- 持仓金额
- 持有份额
- 持仓成本价
- 最新净值
- 确认总收益
- 确认总收益率
- 仓位占比

### 4. Agent / investment-controller 读取规则

当前约定：

1. 基础持仓读取 `portfolio/current_holdings.json`
2. 当前真实仓位优先读取 `portfolio/confirmed_nav_snapshot.json`
3. 今日盘中表现读取 `portfolio/realtime_snapshot.json`
4. 风格 / 板块辅助读取 `portfolio/fund_sector_map.json`

网页和 Agent 不应各自维护独立状态，必须尽量依赖同一套 JSON 数据源。

## 目录结构

```text
.
├── AGENTS.md
├── README.md
├── LICENSE
├── package.json
├── server.js
├── public/
│   ├── app.js
│   ├── index.html
│   └── styles.css
├── src/
│   ├── config.js
│   ├── import-quality.js
│   ├── import-service.js
│   ├── portfolio-store.js
│   └── realtime-service.js
├── scripts/
│   ├── bootstrap-portfolio.js
│   ├── com.maybee.fund-dashboard.plist
│   ├── ocr.swift
│   └── start-dashboard.sh
├── portfolio/
│   ├── *.example.json
│   ├── current_holdings.json
│   ├── confirmed_nav_snapshot.json
│   ├── realtime_snapshot.json
│   ├── fund_sector_map.json
│   ├── transactions.json
│   ├── update_log.json
│   └── snapshots/
├── tests/
│   └── portfolio.test.js
└── docs/
    ├── images/
    └── project-overview.md
```

## 技术实现

### 后端

- Node.js
- 原生 HTTP 服务
- 本地 JSON 文件持久化

### OCR

- macOS `swift + Vision`
- 当前不是云 OCR，也不是跨平台实现

### 实时估值

- 普通基金：东方财富基金估值接口
- QDII：代理估算
- 黄金：允许夜盘估算，并在前端显示 `黄金夜盘中`

### 前端

- 原生 HTML / CSS / JS
- 热力图卡片布局
- 自动刷新
- 小屏常驻友好

## 当前已知限制

### OCR 仍然可能误识别

尤其是“单只基金详情页”这种截图，容易把：

- 交易记录
- 收益明细
- 按钮文字
- 标签说明

误识别为基金数据。

虽然现在已经做了额外过滤和已知基金代码纠偏，但仍建议：

- 上传后先看预览
- 确认 diff 再写入

### 主动混合基金实时估算不是官方净值

盘中展示的主动混合基金实时涨幅，仍然属于估算值，不等于基金公司最终确认净值。

### QDII 可信度低于普通 A 股基金

QDII 估算会受到：

- 海外市场交易时段
- 汇率
- 代理指数

影响，所以它的盘中估算精度会低一些。

### 真实数据不适合公开提交

项目已经通过 `.gitignore` 忽略真实持仓文件，但实际公开前仍应再次检查：

- `portfolio/*.json`
- `portfolio/snapshots/*.json`
- `.run/`

是否包含个人真实数据。

## 本地运行

```bash
npm run bootstrap-data
npm start
```

打开：

```text
http://localhost:3030
```

## 测试

```bash
npm test
```

## 常见维护动作

### 重启看板服务

如果页面打不开，通常是本地服务没有运行，需要重新拉起。

### 更新截图导入后的真源

建议步骤：

1. 先导入截图
2. 检查预览
3. 再确认写入
4. 写入后刷新网页和 Agent 数据源

### 遇到待确认金额

当前约定是：

- `待确认金额` 不立即并入当前已生效持仓
- 等下一开盘日真正转成份额后，再更新进真源

## 适合后续演进的方向

- 更强的详情页 OCR 识别
- 更稳定的多图批量导入
- 更明确的确认净值更新提示
- 更通用的模型接入层
- 更正式的导入审核工作流

## 多工具协作规范

### 项目事实源

项目状态统一保存在以下位置，任何 agent 不得单独保存关键项目状态：

- **Git 仓库** — 代码版本和变更历史
- **AGENTS.md** — 协作规则和安全红线
- **docs/** — 项目上下文、任务池、决策记录、修改日志
- **portfolio/*.json** — 投资数据真源（已在 .gitignore 中）

### 工具分工

| 工具 | 角色 | 权限边界 |
|------|------|----------|
| OpenClaw | 主控调度 | 读取上下文 → 判断任务 → 派发执行，不直接乱改代码 |
| Codex CLI | 代码执行器 | 读文件、改代码、跑测试、输出 diff |
| Codex App | 审查界面 | 看 diff、确认修改、做最终 review |

### 协作流程

1. 任务进入 → OpenClaw 读取上下文判断复杂度
2. 简单任务 → OpenClaw 直接 exec
3. 复杂任务 → 生成 Codex CLI 命令，用户确认后执行
4. 执行完成 → 更新 docs/DEVLOG.md
5. 用户通过 Codex App 审查 diff

---

## 结论

这个项目当前已经不是单纯网页，而是一套本地基金持仓数据系统：

- 有截图导入入口
- 有真源 JSON
- 有确认仓位基线
- 有盘中估算层
- 有网页展示层
- 有 Agent 统一读取规则

如果继续演进，它可以逐步从“个人持仓网页”变成“个人基金投资操作系统”的数据底座。
