# Portfolio Data

这个目录在公开仓库里只保留示例模板，不提交真实持仓数据。

首次克隆项目后，请运行：

```bash
npm run bootstrap-data
```

它会把以下模板复制成你本地可用的真实文件：

- `current_holdings.example.json` -> `current_holdings.json`
- `confirmed_nav_snapshot.example.json` -> `confirmed_nav_snapshot.json`
- `realtime_snapshot.example.json` -> `realtime_snapshot.json`
- `transactions.example.json` -> `transactions.json`
- `fund_sector_map.example.json` -> `fund_sector_map.json`
- `update_log.example.json` -> `update_log.json`

说明：

- `*.example.json` 适合公开展示结构
- `*.json` 是你本地私有数据
- `snapshots/` 会存本地历史快照，不建议公开提交
