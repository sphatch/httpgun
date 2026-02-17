const state = {
  activeTab: null,
  capture: null,
  showSensitive: false,
  search: ""
};

const summaryEl = document.querySelector("#summary");
const messageEl = document.querySelector("#message");
const headersBodyEl = document.querySelector("#headers-body");
const reloadCaptureEl = document.querySelector("#reload-capture");
const openViewerEl = document.querySelector("#open-viewer");
const copyRawEl = document.querySelector("#copy-raw");
const copyJsonEl = document.querySelector("#copy-json");
const showSensitiveEl = document.querySelector("#show-sensitive");
const searchEl = document.querySelector("#search");
const redirectsEl = document.querySelector("#redirects");

init().catch((error) => {
  setMessage(error instanceof Error ? error.message : String(error), true);
});

chrome.runtime.onMessage.addListener((message) => {
  if (!state.activeTab) {
    return;
  }

  if (message?.type === "captureUpdated" && message.tabId === state.activeTab.id) {
    void refreshCapture();
  }

  if (message?.type === "captureFailed" && message.tabId === state.activeTab.id) {
    setMessage(`Capture failed: ${message.error || "unknown error"}`, true);
  }
});

reloadCaptureEl.addEventListener("click", async () => {
  if (!state.activeTab) {
    return;
  }

  setMessage("Reloading tab and waiting for main-frame response headers...");

  const result = await sendMessage({
    type: "reloadAndCapture",
    tabId: state.activeTab.id,
    tabUrl: state.activeTab.url
  });

  if (!result.ok) {
    setMessage(result.error || "Could not start capture.", true);
    return;
  }

  setMessage("Capture armed. Headers will appear after the page response arrives.");
});

openViewerEl.addEventListener("click", async () => {
  if (!state.activeTab) {
    return;
  }

  const result = await sendMessage({
    type: "openViewerTab",
    sourceTabId: state.activeTab.id
  });

  if (!result.ok) {
    setMessage(result.error || "Could not open request builder.", true);
  }
});

copyRawEl.addEventListener("click", async () => {
  if (!state.capture) {
    return;
  }

  const text = buildRawHeaderOutput(state.capture, state.showSensitive);
  await navigator.clipboard.writeText(text);
  setMessage("Raw headers copied to clipboard.");
});

copyJsonEl.addEventListener("click", async () => {
  if (!state.capture) {
    return;
  }

  const text = JSON.stringify(buildJsonOutput(state.capture, state.showSensitive), null, 2);
  await navigator.clipboard.writeText(text);
  setMessage("JSON payload copied to clipboard.");
});

showSensitiveEl.addEventListener("change", () => {
  state.showSensitive = showSensitiveEl.checked;
  renderCapture();
});

searchEl.addEventListener("input", () => {
  state.search = searchEl.value.trim().toLowerCase();
  renderCapture();
});

async function init() {
  const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });

  if (!activeTab || !activeTab.id) {
    summaryEl.textContent = "No active tab found.";
    return;
  }

  state.activeTab = activeTab;
  await refreshCapture();
}

async function refreshCapture() {
  if (!state.activeTab) {
    return;
  }

  const result = await sendMessage({
    type: "getActiveTabCapture",
    tabId: state.activeTab.id
  });

  if (!result.ok) {
    setMessage(result.error || "Could not read capture state.", true);
    return;
  }

  state.capture = result.capture;
  renderCapture();

  if (!state.capture) {
    setMessage("No captured response yet. Use Reload & Capture.");
  } else {
    setMessage("Captured headers are shown below.");
  }
}

function renderCapture() {
  const capture = state.capture;

  copyRawEl.disabled = !capture;
  copyJsonEl.disabled = !capture;

  if (!capture) {
    summaryEl.textContent = "No headers captured for this tab yet.";
    headersBodyEl.innerHTML = "<tr><td colspan=\"2\">No headers captured yet.</td></tr>";
    redirectsEl.classList.add("hidden");
    redirectsEl.innerHTML = "";
    return;
  }

  const domain = getDomain(capture.url);
  summaryEl.innerHTML = `
    <strong>${escapeHtml(domain)}</strong><br>
    ${escapeHtml(capture.url)}<br>
    Status: <strong>${capture.statusCode}</strong> • Captured: ${escapeHtml(formatDate(capture.timeCaptured))}
  `;

  const filteredHeaders = (capture.responseHeaders || []).filter((header) => {
    if (!state.search) {
      return true;
    }

    const name = (header.name || "").toLowerCase();
    const value = String(header.value || "").toLowerCase();
    return name.includes(state.search) || value.includes(state.search);
  });

  if (!filteredHeaders.length) {
    headersBodyEl.innerHTML = "<tr><td colspan=\"2\">No matching headers.</td></tr>";
  } else {
    headersBodyEl.innerHTML = filteredHeaders
      .map((header) => {
        const displayValue = shouldMask(header) && !state.showSensitive ? "[masked]" : header.value;
        return `<tr><td>${escapeHtml(header.name)}</td><td>${escapeHtml(String(displayValue || ""))}</td></tr>`;
      })
      .join("");
  }

  renderRedirects(capture.redirectChain || []);
}

function renderRedirects(redirectChain) {
  if (!redirectChain.length) {
    redirectsEl.classList.add("hidden");
    redirectsEl.innerHTML = "";
    return;
  }

  redirectsEl.classList.remove("hidden");
  redirectsEl.innerHTML = `
    <strong>Redirect chain</strong>
    ${redirectChain
      .map(
        (hop) =>
          `<div class="redirect-hop"><strong>${escapeHtml(String(hop.statusCode))}</strong> ${escapeHtml(
            hop.url
          )}</div>`
      )
      .join("")}
  `;
}

function shouldMask(header) {
  if (header?.sensitive) {
    return true;
  }

  const lower = String(header?.name || "").toLowerCase();
  return lower === "authorization" || lower === "cookie" || lower === "set-cookie";
}

function buildRawHeaderOutput(capture, showSensitive) {
  const lines = [
    `${capture.statusCode} ${capture.url}`,
    `captured-at: ${capture.timeCaptured}`,
    ""
  ];

  for (const header of capture.responseHeaders || []) {
    const value = shouldMask(header) && !showSensitive ? "[masked]" : header.value;
    lines.push(`${header.name}: ${value}`);
  }

  return lines.join("\n");
}

function buildJsonOutput(capture, showSensitive) {
  return {
    ...capture,
    responseHeaders: (capture.responseHeaders || []).map((header) => ({
      ...header,
      value: shouldMask(header) && !showSensitive ? "[masked]" : header.value
    })),
    redirectChain: (capture.redirectChain || []).map((hop) => ({
      ...hop,
      responseHeaders: (hop.responseHeaders || []).map((header) => ({
        ...header,
        value: shouldMask(header) && !showSensitive ? "[masked]" : header.value
      }))
    }))
  };
}

function setMessage(text, isError = false) {
  messageEl.textContent = text;
  messageEl.classList.toggle("error", Boolean(isError));
}

function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleString();
  } catch (_error) {
    return isoString;
  }
}

function getDomain(url) {
  try {
    return new URL(url).host;
  } catch (_error) {
    return url;
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function sendMessage(payload) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(payload, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }

      resolve(response || { ok: false, error: "No response" });
    });
  });
}
