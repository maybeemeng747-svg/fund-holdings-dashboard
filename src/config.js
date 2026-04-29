import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");

export const paths = {
  rootDir,
  portfolioDir: path.join(rootDir, "portfolio"),
  snapshotsDir: path.join(rootDir, "portfolio", "snapshots"),
  currentHoldingsFile: path.join(rootDir, "portfolio", "current_holdings.json"),
  confirmedNavSnapshotFile: path.join(rootDir, "portfolio", "confirmed_nav_snapshot.json"),
  realtimeSnapshotFile: path.join(rootDir, "portfolio", "realtime_snapshot.json"),
  transactionsFile: path.join(rootDir, "portfolio", "transactions.json"),
  fundSectorMapFile: path.join(rootDir, "portfolio", "fund_sector_map.json"),
  updateLogFile: path.join(rootDir, "portfolio", "update_log.json"),
  ocrScriptFile: path.join(rootDir, "scripts", "ocr.swift"),
};

export const staleDaysThreshold = 7;
