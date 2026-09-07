const screenshotInput = document.getElementById('screenshot-input');
const selectedFile = document.getElementById('selected-file');
const extractButton = document.getElementById('extract-button');
const importStatus = document.getElementById('import-status');
const previewSection = document.getElementById('preview-section');
const importScope = document.getElementById('import-scope');
const previewWarnings = document.getElementById('preview-warnings');
const diffSummary = document.getElementById('diff-summary');
const holdingsJson = document.getElementById('holdings-json');
const rawLines = document.getElementById('raw-lines');
const confirmCheckbox = document.getElementById('confirm-checkbox');
const confirmButton = document.getElementById('confirm-button');

let selectedImageDataUrl = null;
let currentPreview = null;

function setStatus(message, type = '') {
  importStatus.textContent = message;
  importStatus.dataset.type = type;
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('截图读取失败'));
    reader.readAsDataURL(file);
  });
}

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

function renderPreview(preview) {
  currentPreview = preview;
  previewSection.hidden = false;
  holdingsJson.value = JSON.stringify(preview.holdings || [], null, 2);
  importScope.textContent = preview.import_scope === 'partial'
    ? '单基金更新，将合并到现有组合'
    : '完整组合更新';

  previewWarnings.replaceChildren();
  for (const warning of preview.warnings || []) {
    const item = document.createElement('li');
    item.textContent = warning;
    previewWarnings.appendChild(item);
  }

  const diff = preview.diff || {};
  diffSummary.textContent =
    `新增 ${(diff.added || []).length} · 删除 ${(diff.removed || []).length} · 变更 ${(diff.changed || []).length}`;
  rawLines.textContent = (preview.ocr_summary?.raw_lines || [])
    .map((item) => `${item.text}  [${item.confidence}]`)
    .join('\n');
  confirmCheckbox.checked = false;
  confirmButton.disabled = true;
}

screenshotInput.addEventListener('change', async () => {
  const file = screenshotInput.files?.[0];
  currentPreview = null;
  previewSection.hidden = true;
  if (!file) {
    selectedImageDataUrl = null;
    selectedFile.textContent = '尚未选择';
    extractButton.disabled = true;
    return;
  }

  try {
    selectedImageDataUrl = await readFileAsDataUrl(file);
    selectedFile.textContent = file.name;
    extractButton.disabled = false;
    setStatus('');
  } catch (error) {
    setStatus(error.message, 'error');
  }
});

extractButton.addEventListener('click', async () => {
  const file = screenshotInput.files?.[0];
  if (!selectedImageDataUrl || !file) return;

  extractButton.disabled = true;
  setStatus('正在提取截图...');
  try {
    const preview = await postJson('/api/import/extract', {
      imageDataUrl: selectedImageDataUrl,
      imageName: file.name,
    });
    renderPreview(preview);
    setStatus('提取完成，请逐项核对后确认。', 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    extractButton.disabled = false;
  }
});

confirmCheckbox.addEventListener('change', () => {
  confirmButton.disabled = !confirmCheckbox.checked;
});

confirmButton.addEventListener('click', async () => {
  if (!currentPreview || !confirmCheckbox.checked) return;

  let holdings;
  try {
    holdings = JSON.parse(holdingsJson.value);
    if (!Array.isArray(holdings) || holdings.length === 0) {
      throw new Error('持仓 JSON 必须是非空数组');
    }
  } catch (error) {
    setStatus(`JSON 格式错误：${error.message}`, 'error');
    return;
  }

  confirmButton.disabled = true;
  setStatus('正在写入持仓...');
  try {
    await postJson('/api/import/confirm', {
      confirmed: true,
      holdings,
      import_scope: currentPreview.import_scope,
      source: currentPreview.source,
      warnings: currentPreview.warnings || [],
    });
    setStatus('写入完成，持仓真源和快照已更新。', 'success');
    confirmCheckbox.checked = false;
  } catch (error) {
    setStatus(error.message, 'error');
    confirmButton.disabled = false;
  }
});
