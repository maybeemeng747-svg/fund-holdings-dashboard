import { promises as fs } from "node:fs";
import path from "node:path";

const rootDir = path.resolve(new URL("..", import.meta.url).pathname);
const portfolioDir = path.join(rootDir, "portfolio");
const snapshotsDir = path.join(portfolioDir, "snapshots");

const files = [
  "current_holdings",
  "confirmed_nav_snapshot",
  "realtime_snapshot",
  "transactions",
  "fund_sector_map",
  "update_log",
];

async function ensureDir(dirPath) {
  await fs.mkdir(dirPath, { recursive: true });
}

async function copyIfMissing(name) {
  const target = path.join(portfolioDir, `${name}.json`);
  const example = path.join(portfolioDir, `${name}.example.json`);

  try {
    await fs.access(target);
    return { name, created: false };
  } catch {
    const raw = await fs.readFile(example, "utf8");
    await fs.writeFile(target, raw, "utf8");
    return { name, created: true };
  }
}

await ensureDir(snapshotsDir);
const results = await Promise.all(files.map(copyIfMissing));

for (const item of results) {
  console.log(`${item.created ? "created" : "kept"} ${item.name}.json`);
}
