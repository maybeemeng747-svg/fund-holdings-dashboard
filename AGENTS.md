# Investment Controller — 项目协作规则

## 项目简介

这是用户的个人基金投资主控系统（本地部署），包含以下核心模块：

- **持仓真源**：JSON 文件管理当前持仓、交易记录、板块映射
- **截图导入**：OCR 识别支付宝/养基宝持仓截图，人工确认后写入
- **实时估值**：盘中通过东方财富接口估算基金净值和收益
- **网页看板**：小屏友好的持仓仪表盘，热力图 + 明细
- **风控建议**：Agent 读取持仓数据后输出分析建议
- **快照系统**：每次写入自动生成时间戳快照，保留历史

详细项目背景见 `docs/project-overview.md`。

## 多工具协作架构

```
用户（最终决策）
  │
  ├── OpenClaw（主控调度）── 读取上下文 → 判断任务 → 派发执行
  │     ├── 简单任务：直接 exec 执行（git/node/npm）
  │     └── 复杂任务：sessions_spawn 子 agent 或生成 Codex CLI 命令
  │
  ├── Codex CLI（代码执行器）── 读取同一套上下文文件 → 改代码 → 跑测试 → 输出 diff
  │
  └── Codex App（审查界面）── 查看 diff → 确认修改 → 做 review
```

**核心原则**：三者读取同一套项目上下文，不各自保存独立记忆。

## 必读文件（任何 coding agent 开始任务前）

1. `AGENTS.md`（本文件）
2. `docs/project-overview.md`（项目背景 + 目录结构 + 数据源说明）
3. `docs/TASKS.md`（当前任务池）
4. `docs/DECISIONS.md`（架构决策记录）
5. `docs/DEVLOG.md`（最近修改日志）

## 执行规则

### 代码修改前
1. 执行 `git status`，确认当前分支和未提交变更
2. 确认修改范围不影响真实投资数据
3. 如果涉及核心模块，先跑一遍 `npm test` 确认基线

### 代码修改后
1. 运行 `npm test`，全部通过才算完成
2. 输出：修改文件列表、测试结果、发现的风险点
3. 更新 `docs/DEVLOG.md`

### OpenClaw 调度方式
- **简单任务**（改配置、修 bug、小重构）：OpenClaw 直接 `exec` 执行
- **复杂任务**（新功能、跨模块修改）：生成 Codex CLI 调用命令，由用户确认后执行
- **审查任务**：OpenClaw 不直接审查代码，提示用户用 Codex App 查看 diff

### Codex CLI 调用格式（OpenClaw 生成时使用）

```bash
cd /path/to/investment-controller
codex "先读取 AGENTS.md、docs/project-overview.md、docs/TASKS.md、docs/DECISIONS.md，然后完成任务：[具体任务描述]。改完运行 npm test，并更新 docs/DEVLOG.md。"
```

## 数据安全红线

### 禁止操作
- ❌ 删除 `portfolio/snapshots/` 目录及其内容
- ❌ 覆盖 `portfolio/current_holdings.json` 中的真实持仓数据
- ❌ 在更新股票、基金、账户或行情字段时修改、清空或删除 `watchlist`
- ❌ 覆盖 `portfolio/transactions.json` 中的真实交易记录
- ❌ 覆盖 `portfolio/fund_sector_map.json` 中的真实映射数据
- ❌ 把测试数据写入真实持仓文件
- ❌ 硬编码行情/净值数据到源代码中

### 允许操作
- ✅ 通过截图导入流程更新持仓（OCR → 预览 → 人工确认 → 写入）
- ✅ 通过 `confirmed_nav_snapshot.json` 更新确认净值
- ✅ 通过 `realtime_snapshot.json` 更新盘中估算
- ✅ 在 `*.example.json` 文件中写测试数据
- ✅ 修改源代码、样式、脚本、测试

### 观察仓保护规则

- `watchlist` 是独立于实际持仓的用户维护数据，不计入仓位和收益。
- 任何持仓同步、截图导入、record / Open PRO 更新或整文件重写，都必须先读取旧值，并原样保留 `watchlist`。
- 输入中缺少 `watchlist`，或输入里出现空数组，都不能视为清空授权。
- 只有用户明确提出“新增、删除、替换或清空观察仓”时，才允许修改 `watchlist`。

### 数据源优先级（从高到低）
1. `portfolio/confirmed_nav_snapshot.json` — 最准确的确认仓位基线
2. `portfolio/current_holdings.json` — 基础持仓真源
3. `portfolio/realtime_snapshot.json` — 盘中估算层（可能过期）
4. `portfolio/fund_sector_map.json` — 板块风格映射
5. `portfolio/transactions.json` — 交易记录

## 代码审查清单

详见 `docs/CODE_REVIEW.md`，核心检查项：
- 是否误改真实投资数据
- 是否破坏 JSON 结构
- 是否有测试覆盖
- 是否影响前端展示
- 是否能通过 git 回滚

## 关键代码文件

| 文件 | 职责 | 修改风险 |
|------|------|----------|
| `server.js` | HTTP 服务 + API 路由 | 高 |
| `src/portfolio-store.js` | 持仓 JSON 读写逻辑 | 高（涉及真源） |
| `src/import-service.js` | 截图导入流程 | 高（涉及写入） |
| `src/import-quality.js` | 导入质量校验 | 中 |
| `src/realtime-service.js` | 盘中实时估值 | 中 |
| `src/config.js` | 配置常量 | 低 |
| `public/app.js` | 前端逻辑 | 中 |
| `public/index.html` | 前端页面 | 低 |
| `public/styles.css` | 前端样式 | 低 |
| `tests/portfolio.test.js` | 测试 | 低（只增不改） |
