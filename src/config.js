import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const portfolioDir = path.join(rootDir, "portfolio");

export const paths = {
  rootDir,
  portfolioDir,
  snapshotsDir: path.join(portfolioDir, "snapshots"),
  currentHoldingsFile:
    process.env.HOLDINGS_FILE || path.join(portfolioDir, "current_holdings.json"),
  confirmedNavSnapshotFile: path.join(portfolioDir, "confirmed_nav_snapshot.json"),
  realtimeSnapshotFile: path.join(portfolioDir, "realtime_snapshot.json"),
  transactionsFile: path.join(portfolioDir, "transactions.json"),
  fundSectorMapFile: path.join(portfolioDir, "fund_sector_map.json"),
  updateLogFile: path.join(portfolioDir, "update_log.json"),
  ocrScriptFile: path.join(rootDir, "scripts", "ocr.swift"),
};

export const staleDaysThreshold = 7;
