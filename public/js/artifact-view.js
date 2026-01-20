export function artifactStorageKey(artifactId) {
  return `harness.artifact.${artifactId}.storage`;
}

export function loadArtifactStorage(artifactId) {
  try {
    const raw = localStorage.getItem(artifactStorageKey(artifactId));
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function saveArtifactStorage(artifactId, data) {
  try {
    localStorage.setItem(artifactStorageKey(artifactId), JSON.stringify(data || {}));
  } catch {
    // Storage can be unavailable; the artifact still works in memory.
  }
}

const ARTIFACT_CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob:; media-src data: blob:; style-src 'unsafe-inline'; font-src data:; script-src 'unsafe-inline' 'unsafe-eval'; connect-src 'none'; form-action 'none'; base-uri 'self';">`;

function storageShim(artifactId, token, snapshot) {
  const safeData = JSON.stringify(snapshot || {}).replace(/</g, '\\u003c');
  return `<script>
(function () {
  var ID = ${JSON.stringify(artifactId)};
  var TOKEN = ${JSON.stringify(token)};
  var store = new Map(Object.entries(${safeData}));
  function post() {
    try {
      parent.postMessage({
        __harnessArtifact: true,
        id: ID,
        token: TOKEN,
        data: Object.fromEntries(store)
      }, "*");
    } catch (error) {}
  }
  var api = {
    getItem: function (key) { key = String(key); return store.has(key) ? store.get(key) : null; },
    setItem: function (key, value) { store.set(String(key), String(value)); post(); },
    removeItem: function (key) { store.delete(String(key)); post(); },
    clear: function () { store.clear(); post(); },
    key: function (index) { var keys = Array.from(store.keys()); return index >= 0 && index < keys.length ? keys[index] : null; }
  };
  Object.defineProperty(api, "length", { get: function () { return store.size; } });
  try {
    Object.defineProperty(window, "localStorage", { configurable: true, get: function () { return api; } });
  } catch (error) {
    try { window.localStorage = api; } catch (ignored) {}
  }
})();
</script>`;
}

function injectAfterHead(html, insertion) {
  if (/<head(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<head(\s[^>]*)?>/i, (match) => `${match}\n${insertion}`);
  }
  if (/<html(\s[^>]*)?>/i.test(html)) {
    return html.replace(/<html(\s[^>]*)?>/i, (match) => `${match}\n<head>${insertion}</head>`);
  }
  return `<head>${insertion}</head>\n${html}`;
}

/**
 * Build the srcdoc for an artifact. The iframe is sandboxed without
 * allow-same-origin, so an artifact cannot reach the host app. localStorage is
 * replaced with a small in-memory Storage that syncs to the parent.
 */
export function buildArtifactDocument(artifact, snapshot, token) {
  const shim = storageShim(artifact.id, token, snapshot);
  if (artifact.kind === 'svg') {
    const shell = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">${ARTIFACT_CSP}<base target="_blank"><style>html,body{margin:0;min-height:100%;background:#0a0c0f;color:#eef1f5;font-family:ui-sans-serif,system-ui,sans-serif}.svg-wrap{min-height:100vh;display:grid;place-items:center;padding:24px;box-sizing:border-box}.svg-wrap svg{max-width:100%;height:auto}</style>${shim}</head><body><div class="svg-wrap">${artifact.content}</div></body></html>`;
    return shell;
  }
  const base = '<base target="_blank">';
  return injectAfterHead(String(artifact.content || ''), `${ARTIFACT_CSP}\n${base}\n${shim}`);
}

export function downloadArtifact(artifact) {
  const extension = artifact.kind === 'svg' ? 'svg' : 'html';
  const blob = new Blob([artifact.content], {
    type: artifact.kind === 'svg' ? 'image/svg+xml' : 'text/html'
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${(artifact.title || 'artifact').replace(/[\\/:*?"<>|]/g, '-')}.${extension}`;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function randomToken() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}
