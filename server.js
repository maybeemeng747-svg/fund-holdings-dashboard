import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promises as fs } from "node:fs";

import { extractPortfolioFromScreenshot, validateImportPayload } from "./src/import-service.js";
import {
  buildDashboardPayload,
  getCurrentHoldings,
  writeConfirmedImport,
} from "./src/portfolio-store.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const port = Number(process.env.PORT || 3030);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload, null, 2));
}

function sendText(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(payload);
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }

  if (chunks.length === 0) {
    return {};
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  return JSON.parse(raw);
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let filePath = path.join(publicDir, url.pathname === "/" ? "index.html" : url.pathname);

  if (!filePath.startsWith(publicDir)) {
    sendText(res, 403, "Forbidden");
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    const extension = path.extname(filePath).toLowerCase();
    const contentType = mimeTypes[extension] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(file);
  } catch (error) {
    sendText(res, 404, "Not Found");
  }
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/holdings") {
    const payload = await buildDashboardPayload();
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/raw-holdings") {
    const payload = await getCurrentHoldings();
    sendJson(res, 200, payload);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/extract") {
    try {
      const body = await readJsonBody(req);
      const preview = await extractPortfolioFromScreenshot(body);
      sendJson(res, 200, preview);
    } catch (error) {
      sendJson(res, 400, { error: error.message || "截图提取失败" });
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/confirm") {
    try {
      const body = await readJsonBody(req);
      validateImportPayload(body);
      const result = await writeConfirmedImport(body);
      sendJson(res, 200, result);
    } catch (error) {
      sendJson(res, 400, { error: error.message || "写入失败" });
    }
    return;
  }

  sendJson(res, 404, { error: "API Not Found" });
}

const server = http.createServer(async (req, res) => {
  try {
    if ((req.url || "").startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }

    await serveStatic(req, res);
  } catch (error) {
    sendJson(res, 500, { error: error.message || "服务器内部错误" });
  }
});

server.listen(port, () => {
  console.log(`Fund dashboard is running at http://localhost:${port}`);
});
