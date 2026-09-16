# 架构决策记录

> 记录项目中的关键架构决策，方便后续回溯"为什么这样做"。

---

##ADR-001: OpenClaw 作为主控调度
- **日期**：2026-05-09
- **背景**：需要 OpenClaw、Codex CLI、Codex App 三者协作处理同一项目
- **决策**：OpenClaw 负责任务判断和调度，不直接做代码修改；Codex CLI 负责代码执行；Codex App 负责审查
- **原因**：OpenClaw 有完整的 agent 调度能力（exec / sessions_spawn / cron），适合做编排层；Codex 在代码生成和测试方面更专业
- **影响**：所有代码修改任务必须经过 OpenClaw 判断复杂度后决定执行路径

---

## ADR-002: Git 仓库 + docs/ 作为项目事实源
- **日期**：2026-05-09
- **背景**：多个工具需要读取同一套项目上下文
- **决策**：不使用任何 agent 的独立记忆系统保存项目状态，所有关键信息写入 Git 仓库的 docs/ 目录
- **原因**：避免信息分散、版本冲突、单点失效
- **影响**：每次任务开始前必须读取 AGENTS.md + docs/ 下的上下文文件

---

## ADR-003: 复用已有的 docs/project-overview.md
- **日期**：2026-05-09
- **背景**：ChatGPT 建议创建 docs/PROJECT_CONTEXT.md，但项目已有详细的 project-overview.md
- **决策**：不创建冗余的 PROJECT_CONTEXT.md，将新增协作规范直接补入 project-overview.md
- **原因**：避免两份文档内容重叠导致维护负担和信息不一致
- **影响**：project-overview.md 是项目背景的唯一权威文档

---

## ADR-004: 不创建 .openclaw/project.md
- **日期**：2026-05-09
- **背景**：ChatGPT 建议创建 .openclaw/project.md 供 OpenClaw 读取
- **决策**：不创建，OpenClaw 不会自动读取这个路径
- **原因**：OpenClaw 读取的是 workspace 根目录的 AGENTS.md，不是项目目录下的自定义文件。项目特定规则写入项目的 AGENTS.md 即可
- **影响**：OpenClaw 处理此项目时，通过 exec 读取项目 AGENTS.md 获取上下文

---

## ADR-005: 暂不创建 .codex/config.toml
- **日期**：2026-05-09
- **背景**：Codex CLI 尚未安装在本地
- **决策**：待 Codex CLI 安装后再创建配置文件
- **原因**：配置文件依赖工具实际存在才有意义
- **影响**：当前代码修改通过 OpenClaw exec 直接执行，或手动操作

---

## ADR-006: 观察仓不随持仓更新
- **日期**：2026-09-16
- **背景**：record、Open PRO 等工具全量更新持仓真源时，可能因输入不含观察仓而将原有 `watchlist` 清空
- **决策**：`watchlist` 作为独立的用户维护字段；所有普通持仓写入必须从写入前真源原样保留它
- **原因**：观察仓不属于实际仓位，也不应被持仓同步生命周期覆盖
- **影响**：字段缺失或空数组不构成清空授权；只有用户明确要求调整观察仓时才允许修改

---

## 决策模板（后续新增时复制）

```
## ADR-NNN: [决策标题]
- **日期**：YYYY-MM-DD
- **背景**：[为什么需要做这个决策]
- **决策**：[做了什么决定]
- **原因**：[为什么选这个方案]
- **影响**：[对项目的影响]
```
