# Fund Holdings Dashboard

一个给基金投资者用的本地工具：

- 用截图导入基金持仓
- 用 JSON 作为持仓真源
- 自动维护确认净值快照与盘中估算
- 提供适合小屏常驻查看的网页看板

这个项目适合：

- 买基金但平台不再给实时收益的人
- 想自己维护持仓真源的人
- 想把持仓交给 Agent / 自动化系统分析的人

## 功能概览

- `portfolio/current_holdings.json`：持仓基础真源
- `portfolio/confirmed_nav_snapshot.json`：最新确认净值后的真实仓位基线
- `portfolio/realtime_snapshot.json`：盘中实时估算快照
- `portfolio/fund_sector_map.json`：风格 / 板块 / 仓位角色映射
- 网页看板统一读取同一套数据源
- 截图导入必须先预览，再人工确认写入
- 写入后自动生成历史快照和更新日志

## 项目结构

```text
.
├── AGENTS.md
├── README.md
├── package.json
├── server.js
├── public/
├── scripts/
├── src/
├── tests/
└── portfolio/
    ├── README.md
    ├── *.example.json
    └── snapshots/
```

## 重要说明

公开仓库里默认只提交示例模板，不提交你的真实持仓。

这些真实数据文件已经被 `.gitignore` 忽略：

- `portfolio/current_holdings.json`
- `portfolio/confirmed_nav_snapshot.json`
- `portfolio/realtime_snapshot.json`
- `portfolio/transactions.json`
- `portfolio/fund_sector_map.json`
- `portfolio/update_log.json`
- `portfolio/snapshots/*.json`
- `.run/`

也就是说：

- GitHub 上看到的是结构和示例
- 你本机保留的是真实持仓

## 本地运行

### 1. 安装前提

- macOS
- Node.js
- 支持本地 `swift + Vision` OCR

### 2. 初始化示例数据

第一次克隆项目后运行：

```bash
npm run bootstrap-data
```

这会把 `portfolio/*.example.json` 复制成你本地可用的 `portfolio/*.json`。

### 3. 启动网站

```bash
npm start
```

打开：

[http://localhost:3030](http://localhost:3030)

## 截图导入流程

1. 打开网页看板
2. 上传支付宝 / 养基宝持仓截图
3. 点击“提取并生成预览”
4. 检查结构化结果、缺失项、异常提示
5. 人工确认后写入 `portfolio/current_holdings.json`
6. 系统自动更新：
   - `portfolio/current_holdings.json`
   - `portfolio/confirmed_nav_snapshot.json`
   - `portfolio/update_log.json`
   - `portfolio/snapshots/*.json`

## 数据口径

### 基础持仓真源

- `portfolio/current_holdings.json`
- 用来保存基金名称、代码、份额、成本等基础持仓信息

### 当前真实仓位

- `portfolio/confirmed_nav_snapshot.json`
- 用来保存最新确认净值口径下的真实仓位

### 盘中实时估算

- `portfolio/realtime_snapshot.json`
- 用来保存今日盘中估算涨幅和当日收益

## Agent 读取规则

请优先遵守：

- [AGENTS.md](./AGENTS.md)
- [.agents/skills/read-current-holdings/SKILL.md](./.agents/skills/read-current-holdings/SKILL.md)

推荐读取顺序：

1. `portfolio/current_holdings.json`
2. `portfolio/confirmed_nav_snapshot.json`
3. `portfolio/realtime_snapshot.json`
4. `portfolio/fund_sector_map.json`

## 测试

```bash
npm test
```

## 发布到 GitHub

如果你从来没发过 GitHub，最简单就是按下面做。

### 1. 先在 GitHub 网站创建一个空仓库

建议仓库名：

- `fund-holdings-dashboard`
- 或 `fund-json-dashboard`

创建时：

- 选 `Public`
- 不要勾选自动创建 README
- 不要勾选 `.gitignore`

### 2. 在本地初始化 Git

在项目目录运行：

```bash
git init
git add .
git commit -m "Initial public release"
```

### 3. 绑定远程仓库

把下面的地址换成你自己的：

```bash
git remote add origin https://github.com/你的用户名/你的仓库名.git
git branch -M main
git push -u origin main
```

### 4. 以后更新项目

每次修改后运行：

```bash
git add .
git commit -m "Update dashboard"
git push
```

## 建议你公开前再检查一次

重点检查：

- 不要把真实持仓 JSON 加进 Git
- 不要把 `.run/` 日志加进 Git
- 不要把你本机的绝对路径写进文档

可以用这条命令快速检查：

```bash
git status --short
```

## 当前限制

- OCR 依赖 macOS Vision，不是跨平台实现
- 主动混合基金的盘中估算不是官方净值，只是估算
- QDII 的实时估算可信度低于普通 A 股基金
- 默认更适合本地个人使用，不是多用户云服务
