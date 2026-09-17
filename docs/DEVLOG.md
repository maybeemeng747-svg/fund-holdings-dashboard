# 修改日志

> 每次代码修改后必须更新此文件，保持连续性。

---

## 2026-07-20 | 新增“海瑞投资审判系统”任务

- **执行者**：Codex App
- **任务**：将 ChatGPT 对话《分支 · 股市复盘分析》中形成的“海瑞投资审判系统”思路整理进任务池
- **修改文件**：
  - `docs/TASKS.md` — 新增 B-007，明确投资知识库、海瑞 Agent、OpenClaw/TA 分工、微信/zcode 或飞书入口和验收标准
  - `docs/DEVLOG.md` — 记录本次任务整理
- **测试结果**：不涉及代码修改，未运行测试
- **风险点**：低。仅更新文档任务池，不影响运行逻辑
- **下一步**：优先设计《个人投资宪法》和单只持仓投资档案模板，再进入自动化开发

---

## 2026-07-14 | 统一持仓数据源到 OpenClaw workspace

- **执行者**：Codex App
- **任务**：通过 `HOLDINGS_FILE` 读取 `$HOME/.openclaw/workspace/portfolio/holdings.json`，移除本地持仓双写
- **修改文件**：
  - `src/config.js` — `currentHoldingsFile` 指向 OpenClaw workspace 持仓真源
  - `src/portfolio-store.js` — 新增 workspace schema 与看板 schema 的双向适配，截图确认写入时转回 `account + holdings.stocks/funds`
  - `tests/portfolio.test.js` — 增加 workspace 持仓 schema 映射测试
  - `portfolio/current_holdings.json` — 删除旧本地数据源文件
  - `docs/DEVLOG.md` — 记录本次修改
- **测试结果**：npm test = 10 pass / 0 fail
- **风险点**：中。`src/portfolio-store.js` 现在会写入外部 workspace 真源，截图导入确认前仍需人工复核预览 diff
- **下一步**：重启看板服务并验证 `/api/holdings`

---

## 2026-07-14 | 修复股票看板兜底显示

- **执行者**：Codex App
- **任务**：修复股票实时行情接口不稳定时，看板股票区域和组合合计可能为空的问题
- **修改文件**：
  - `src/stock-service.js` — 新增股票行情服务，实时行情失败时回退到 `current_holdings.json` 中的本地股票持仓字段
  - `server.js` — `/api/stock-quotes` 与 `/api/holdings` 改用统一股票行情服务
  - `tests/portfolio.test.js` — 增加股票本地兜底和实时覆盖测试
  - `docs/DEVLOG.md` — 记录本次修复
- **测试结果**：npm test = 8 pass / 0 fail
- **验证结果**：
  - `/api/stock-quotes` 返回股票 6 只
  - `/api/holdings` 返回基金 1 只 + 股票 6 只，`stock_market_value` 正常合并
- **风险点**：低。只调整股票展示读取层，不写入真实持仓 JSON
- **下一步**：刷新 `http://localhost:3030` 看板确认股票区域恢复

---

## 2026-05-09 | 搭建多工具协作工作流

- **执行者**：OpenClaw（主控AI）
- **任务**：创建项目协作基础设施，不涉及代码修改
- **修改文件**：
  - `AGENTS.md` — 升级，加入多工具协作规则、安全红线、执行流程
  - `docs/project-overview.md` — 新增"多工具协作规范"章节
  - `docs/TASKS.md` — 新建，任务池
  - `docs/DECISIONS.md` — 新建，架构决策记录
  - `docs/DEVLOG.md` — 新建，本文件
  - `docs/CODE_REVIEW.md` — 新建，代码审查清单
- **测试结果**：不涉及代码修改，基线 `npm test` = 5 pass / 0 fail
- **风险点**：无
- **下一步**：
  - [ ] B-003: 检查 fund_sector_map.json 映射完整性
  - [ ] B-004: 检查前端展示
  - [ ] B-006: 安装 Codex CLI（待确认）

---

## 2026-05-09 | 修复 summary 未包含股票市值的问题

- **执行者**：OpenClaw（主控AI）
- **任务**：`/api/holdings` 返回的 summary 只计算基金市值，遗漏了 stocks 数组中的股票
- **修改文件**：
  - `server.js` — `/api/holdings` 端点新增股票市值合并逻辑，返回 `combined_*` 系列字段
- **测试结果**：npm test = 5 pass / 0 fail
- **修复效果**：
  - 合计市值正确包含基金与股票
  - 合计收益、当日收益和股票权重按完整组合重新计算
- **风险点**：低。只在 `/api/holdings` GET 端点追加计算，不影响写入流程和 JSON 文件
- **下一步**：
  - [x] B-003: fund_sector_map 映射完整 ✅
  - [x] B-004: 前端 API 数据正常 ✅
  - [x] B-006: Codex CLI 已安装 ✅
  - [ ] B-005: 建立盘中/盘后分析结果写入规范

---

## 2026-05-09 | Codex CLI 接入智谱 GLM-5.1（Coding Plan API）

- **执行者**：OpenClaw（主控AI）
- **任务**：将 Codex CLI 从 OpenAI GPT-5.5（无额度）切换到智谱 GLM-5.1 Coding Plan API
- **问题**：
  - Codex CLI v0.130.0 强制使用 OpenAI Responses API 格式（`wire_api = "responses"`），不支持 Chat Completions
  - 智谱 Coding API 只有 Chat Completions 端点，没有 Responses 端点
- **解决方案**：编写本地 SSE proxy（`~/.codex/zhipu-proxy.mjs`）做协议转换
  - 接收 Codex CLI 的 Responses API 请求 → 转换为 Chat Completions 格式 → 转发到智谱 Coding API
  - 将智谱的 SSE streaming 响应 → 转换为 Responses API 的 SSE 事件格式
  - 注册为 launchd 常驻服务（`com.maybee.zhipu-codex-proxy`，端口 4000）
- **修改文件**：
  - `~/.codex/config.toml` — model=glm-5.1, provider=zhipu, base_url=localhost:4000/v1
  - `~/.codex/zhipu-proxy.mjs` — 新建，Responses↔Chat Completions 协议转换 proxy
  - `~/Library/LaunchAgents/com.maybee.zhipu-codex-proxy.plist` — 常驻服务配置
- **测试结果**：`codex exec "回复两个字：测试"` → 模型正确返回 "测试"
- **风险点**：proxy 是单点，如果挂了 Codex CLI 无法工作（已配 KeepAlive）
- **下一步**：
  - [ ] B-005: 建立盘中/盘后分析结果写入规范
  - [ ] 用 codex 执行一次实际代码任务验证全链路

---

## 2026-05-09 | B-005 分析写入规范 + SKILL.md 修复

- **执行者**：OpenClaw（主控AI）
- **任务**：建立分析结果写入规范，修复 Codex CLI 报错
- **修改文件**：
  - `docs/analysis-write-spec.md` — 新建，定义盘前/盘中/盘后分析 JSON schema、写入规则、清理规则
  - `portfolio/analysis/` — 新建目录结构（pre-market/intraday/post-market/archive）
  - `.agents/skills/read-current-holdings/SKILL.md` — 补 YAML frontmatter，修复 Codex CLI 加载报错
  - `~/.codex/zhipu-proxy.mjs` — 修复 /v1/models 端点格式，同时返回 models 和 data 字段
- **测试结果**：npm test = 5 pass / 0 fail
- **风险点**：无
- **下一步**：
  - [ ] 全部 B 系列任务完成，进入正常开发节奏
  - [ ] 可选：用 codex 跑一个实际代码修改任务做端到端验证

---

## 2026-05-09 | 安装 Codex CLI + 配置 + 项目短链接 + git commit

- **执行者**：OpenClaw（主控AI）
- **任务**：完成工作流搭建收尾
- **修改文件**：
  - `.codex/config.toml` — 新建，sandbox=workspace-write, approval=on-request, project_docs 指向 AGENTS.md + docs/
  - `docs/TASKS.md` — B-001~B-004, B-006 标记完成
  - `docs/DEVLOG.md` — 本记录
- **其他操作**：
  - 安装 @openai/codex@0.130.0
  - 创建 ~/Projects/investment-controller → 项目目录
  - git commit 两次（d8d8293 + e2e241c1）
- **测试结果**：npm test = 5 pass / 0 fail
- **风险点**：无
- **下一步**：
  - [ ] B-005: 建立盘中/盘后分析结果写入规范
  - [ ] 用 codex 命令验证

---

## 日志模板（后续新增时复制）

```
## YYYY-MM-DD | [任务简述]

- **执行者**：[OpenClaw / Codex CLI / 手动]
- **任务**：[具体做了什么]
- **修改文件**：
  - `path/to/file` — [修改内容简述]
- **测试结果**：npm test = [X pass / Y fail]
- **风险点**：[有 / 无，具体说明]
- **下一步**：[接下来的动作]
```

---

## 2026-07-22 | fund-estimate.js 四项Bug修复

- **执行者**：Codex CLI
- **任务**：修复 fund-estimate.js 的4个Bug + 2项额外改进
- **修改文件**：
  - `src/fund-estimate.js` —
    - Bug1: 支持5位港股代码(01888/00700)，添加 `detectMarket()`/`toSinaSymbol()`，regex 从 `\d{6}` 改为 `\d{5,6}`，holding 增加 `market` 字段
    - Bug3: 新增45秒Sina批量行情缓存(`cachedQuotes`/`quotesFetchedAt`)
    - 移除硬编码 "2026年1季度"，改为动态解析最新季度
    - 防御性检查：Sina返回缺失股票时 log warning 而非错位
    - 提取 `parseHoldingsFromHtml()`/`parseSinaQuotesResponse()` 为可测试导出函数
    - 修复 HK Sina 行情解析（多段引号格式 vs A股单段逗号格式）
    - 修复正则表达式支持单双引号 class 属性
    - 删除未使用的 `fetchStockQuote()` 单股函数
  - `src/realtime-service.js` —
    - Bug2: `persistRealtimeSnapshot` 增加 `estimated_summary`/`estimate_fresh` 字段
  - `public/app.js` —
    - Bug2: 顶部汇总栏优先使用 `estimated_summary`（fresh时），降级使用 confirmed 值
  - `tests/fund-estimate.test.js` — 新增12个测试用例
- **测试结果**：npm test = 22 pass / 0 fail
- **风险点**：中。fund-estimate.js 核心估值逻辑重构，需验证盘中实际表现
- **下一步**：手动验证目标基金估算显示10/10持仓

---

## 2026-07-27 | 看板增加两市成交额并精简股票卡片

- **执行者**：Codex App
- **任务**：在持仓看板顶部增加沪深两市总成交额，并将股票卡片精简为当日涨跌幅和当前股价
- **修改文件**：
  - `src/market-summary.js` — 新增 Sina 沪深指数成交额解析、45 秒缓存和失败降级
  - `server.js` — 新增 `/api/market-summary`
  - `public/index.html` — 顶部栏增加两市成交额位置
  - `public/app.js` — 接入成交额接口；股票卡片仅保留名称、当日涨跌幅和现价；总仓位与总收益支持点击隐藏/显示
  - `public/styles.css` — 增加成交额及精简股票卡片样式；放大股票名称、两市成交额和多晶硅字号
  - `tests/market-summary.test.js` — 覆盖成交额合计、缺失数据和异常值
- **测试结果**：`npm test` 26 pass / 0 fail；桌面 800×480、移动端 390×844 均无横向溢出
- **风险点**：Sina 行情不可用时展示最近一次成功值并标记为过期；无缓存时展示 `--`
- **下一步**：观察交易时段内两市成交额刷新是否稳定；非交易日显示最近交易日的最终成交额

---

## 2026-07-30 | GitHub 备份前安全清理与审查修复

- **执行者**：Codex App
- **任务**：公开备份前清除真实持仓痕迹，并修复提交前审查发现的 P1/P2
- **修改文件**：
  - `.gitignore` — 排除持仓备份、成交额运行缓存和 Python 缓存
  - `src/config.js` — 支持 `HOLDINGS_FILE`，默认使用项目内示例真源
  - `src/import-service.js`、`src/portfolio-store.js`、`src/portfolio-merge.js` — 单基金截图采用合并写入
  - `public/import.*` — 恢复截图上传、OCR 预览、人工确认入口
  - `src/stock-service.js` — 保留本地日收益、拒绝零价行情并并发拉取
  - `src/fund-estimate.js`、`src/realtime-service.js` — 非交易时段停用自建估值，修正确认日收益基准
  - `src/market-summary.js` — 同时保留当前与上一交易日成交额
  - `scripts/sync-to-ta.py` — 读取统一 schema，用户 ID 改为环境变量
  - `public/styles.css`、`public/app.js` — 明确移动端基金行字段并标记本地回退行情
- **测试结果**：`npm test` 33 pass / 0 fail；Node/Python/zsh/plist 语法检查通过；桌面 800×480、移动端 390×844 与隐私切换验收通过，浏览器控制台无错误
- **风险点**：外部真源部署需设置 `HOLDINGS_FILE`；TA 同步需设置 `TA_USER_ID`
- **下一步**：二次代码审查通过后推送 GitHub

---

## 2026-08-03 | 修复持仓看板白屏与 LaunchAgent 启动失败

- **执行者**：Codex App
- **任务**：修复 `3030` 服务未监听导致的白屏，并让 LaunchAgent 使用当前 Node 和真实持仓路径
- **修改文件**：
  - `scripts/start-dashboard.sh` — 补齐 Homebrew 与系统 PATH
  - `scripts/com.maybee.fund-dashboard.plist` — 改为安装时替换的路径模板
  - `scripts/install-launch-agent.sh` — 生成本机 plist、重载服务并校验配置
- **本机服务处理**：卸载并禁用指向已删除 `/tmp/fund-dashboard` 的旧 `com.maybee.investment-controller`，保留其 plist 文件
- **测试结果**：`npm test` 33 pass / 0 fail；launchd 为 `running`，3030 正常监听；API 返回 6 股 + 1 基金并读取外部真源；浏览器页面正常且无控制台错误
- **风险点**：LaunchAgent 仍依赖本机 Node 与 `HOLDINGS_FILE` 可读；安装脚本会在每次执行时覆盖同名用户级 plist
- **下一步**：观察下一次登录或重启后 LaunchAgent 是否仍能自动启动

---

## 2026-09-07 | GitHub 代码备份

- **执行者**：Codex App
- **任务**：将当前看板及启动修复保存到 `codex/backup-20260907` 备份分支
- **修改文件**：`.gitignore` 扩展真实数据备份排除规则；`README.md` 增加恢复步骤；`src/stock-service.js` 修复五位港股代码与行情字段解析；`tests/stock-hk.test.js` 增加回归测试
- **测试结果**：`npm test` 35 pass / 0 fail
- **审查结果**：首轮 `codex review --uncommitted` 报告港股代码映射 P2，已修复并增加字段解析回归测试；修复后自动复核因模型接口 404 中断。此次保存为备份分支，不表示完成发布审查。
- **备份边界**：包含代码、文档和示例数据；真实持仓、交易、快照和本机日志保留本地，不推送公开仓库
- **风险点**：这是当前开发版本的代码备份；恢复真实组合时需另行恢复私有数据并设置 `HOLDINGS_FILE`

---

## 2026-09-15 | 看板增加五格观察仓

- **执行者**：Codex App
- **任务**：在持仓看板底部增加最多 5 只股票的观察仓，不计入总仓位和总收益
- **修改文件**：
  - `src/stock-service.js` — 兼容观察列表的 `code` / `name` 字段并复用实时行情
  - `server.js` — `/api/stock-quotes` 返回最多 5 只观察标的行情
  - `public/index.html`、`public/app.js`、`public/styles.css` — 增加固定五格观察仓，显示名称、当日涨幅和现价，空位显示“待添加”
  - `tests/stock-hk.test.js` — 增加观察列表字段兼容回归测试
- **测试结果**：`npm test` 36 pass / 0 fail；桌面 800×480、移动端 390×844 均显示 5 格且无页面溢出；浏览器控制台无错误
- **数据安全**：只读取真源中的 `watchlist`，未修改任何真实持仓、交易或快照文件
- **风险点**：观察仓依赖新浪行情；行情失败时显示真源中的本地价格或 `--`

---

## 2026-09-15 | 股票与观察仓增加实时均线

- **执行者**：Codex App
- **任务**：为股票持仓和观察仓标注 MA5、MA20，并放大观察仓展示区域
- **修改文件**：
  - `src/stock-service.js` — 读取新浪最近 20 个交易日日 K，计算 MA5/MA20，缓存 45 秒并支持失败降级
  - `public/app.js`、`public/styles.css` — 股票卡片增加均线行；观察仓加高并放大名称、涨幅、现价和均线
  - `tests/stock-hk.test.js` — 增加均线解析与计算回归测试
- **测试结果**：`npm test` 37 pass / 0 fail；真实接口返回 3 只持仓股和 2 只观察股的 MA5/MA20；桌面 800×480、移动端 390×844 无页面溢出
- **数据安全**：均线仅为只读展示，不写入持仓真源
- **风险点**：均线依赖新浪日 K；数据不足或接口失败时显示 `--`，不影响现价和涨跌幅

---

## 2026-09-15 | Tushare 行情主源与观察仓 35% 布局

- **执行者**：Codex App
- **任务**：复用 TradingAgents-AShare 的 Tushare 凭据，将观察仓扩大到主内容区的 35%
- **修改文件**：
  - `src/stock-service.js` — A 股实时价改用 Tushare `rt_min`，昨收与 MA5/MA20 使用 `daily`；单股失败自动回退新浪
  - `server.js` — 持仓股和观察股合并为一次实时行情批量请求
  - `public/styles.css` — 观察仓固定占主内容区 35%，五格随可用高度自适应
  - `scripts/*dashboard*` — 仅传递 TA `.env` 文件路径，不复制或记录 Token
  - `tests/stock-hk.test.js` — 增加市场代码、Tushare 表格和均线计算回归测试
- **数据安全**：只读 TA 项目现有凭据；未改持仓、交易、快照或观察列表真源
- **降级策略**：Tushare 无权限、超时或缺少单股数据时，自动使用新浪现价与日 K
- **测试结果**：`npm test` 39 pass / 0 fail；LaunchAgent 正常运行；真实接口中两只观察股均使用 Tushare，场内 ETF 自动回退新浪；桌面与手机端观察仓均占可用主内容高度 35%，无页面溢出

---

## 2026-09-15 | 放大观察仓信息层级

- **执行者**：Codex App
- **任务**：提升观察仓在桌面和手机端的阅读清晰度
- **修改文件**：`public/styles.css` — 放大名称、当日涨幅、现价、MA5/MA20 和空位文字；手机端改为三格加两格的双行布局，保留五个位置且避免文字截断
- **数据安全**：仅修改展示样式，未修改任何持仓或观察列表数据
- **测试结果**：`npm test` 39 pass / 0 fail；桌面五格单排、手机三格加两格均无文字或页面溢出

---

## 2026-09-15 | 增强观察仓与均线视觉对比

- **执行者**：Codex App
- **任务**：进一步放大观察仓字体，并提高主文字及 MA5/MA20 的辨识度
- **修改文件**：
  - `public/styles.css` — 观察仓使用纯黑底、纯白粗体主文字；桌面与手机字号继续放大
  - `public/app.js` — 股票区和观察仓的 MA5/MA20 拆分为独立样式，分别使用亮蓝与亮黄
- **数据安全**：仅修改前端结构和样式，未修改任何投资数据
- **测试结果**：`npm test` 39 pass / 0 fail；390x844 与 1280x720 实测无文字或页面溢出，MA5/MA20 颜色与字号均按预期生效

---

## 2026-09-16 | 观察仓写入保护规则

- **执行者**：Codex App
- **任务**：防止 record、Open PRO 或其他持仓更新流程误删观察仓
- **规则**：普通持仓更新必须原样保留旧 `watchlist`；字段缺失或空数组不视为清空授权；仅在用户明确要求时允许调整观察仓
- **修改文件**：`AGENTS.md`、`.agents/skills/read-current-holdings/SKILL.md`、`docs/project-overview.md`、`docs/DECISIONS.md`、`tests/portfolio.test.js`
- **数据恢复**：恢复此前由用户明确加入的利通电子和百合花；不修改其他真实持仓字段
- **测试结果**：`npm test` 40 pass / 0 fail；看板 API 已重新读取两只观察股；恢复前快照保存在外部真源的 `snapshots/` 目录

---

## 2026-09-17 | 观察仓扩容到十格

- **执行者**：Codex App
- **任务**：将观察仓容量从 5 只扩大到 10 只，不修改现有观察标的
- **修改文件**：`server.js`、`public/app.js`、`public/index.html`、`public/styles.css`
- **布局**：桌面 5×2 显示十格；手机保持三列和大字，通过观察仓内部滚动查看后续位置
- **数据安全**：未修改 `watchlist` 真源内容
- **测试维护**：持仓来源断言改为接受任意非空来源名称，兼容当前 `true_source_sync` 和后续更新器
- **验收范围**：1280×720、800×480、390×844；低高度屏幕单独收紧名称与涨幅间距，手机端保留大字
- **测试结果**：`npm test` 40 pass / 0 fail；正式 LaunchAgent 已恢复运行；三种尺寸均无页面或单元格溢出

---

## 2026-09-17 | 观察仓改为左右滑动

- **执行者**：Codex App
- **任务**：解决十格上下两排导致单格过小的问题
- **修改文件**：`public/styles.css`
- **布局**：十格改为单排横向轨道；桌面/平板同时显示 4 格，手机同时显示 2 格，通过左右滑动查看后续位置
- **字号**：恢复宽屏大字号，并进一步放大手机端名称、涨幅、现价和均线信息；仅对低高度手机做必要收紧
- **数据安全**：仅修改展示样式，未修改 `watchlist` 真源内容
- **验收**：1280×720、800×480、390×844、390×640 均可横向滑到第 10 格，无页面或观察仓内容溢出；`npm test` 40 pass / 0 fail
