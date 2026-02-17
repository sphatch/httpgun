const state = {
  showSensitive: false,
  responseHeaders: [],
  sourceTabId: null,
  history: []
};

const methodEl = document.querySelector("#method");
const urlEl = document.querySelector("#url");
const headersListEl = document.querySelector("#headers-list");
const addHeaderEl = document.querySelector("#add-header");
const bodyModeEl = document.querySelector("#body-mode");
const bodyEl = document.querySelector("#body");
const formatJsonEl = document.querySelector("#format-json");
const followRedirectsEl = document.querySelector("#follow-redirects");
const includeCredentialsEl = document.querySelector("#include-credentials");
const sendEl = document.querySelector("#send");
const requestMessageEl = document.querySelector("#request-message");
const responseSummaryEl = document.querySelector("#response-summary");
const responseHeadersBodyEl = document.querySelector("#response-headers-body");
const responseBodyEl = document.querySelector("#response-body");
const blockedHeadersEl = document.querySelector("#blocked-headers");
const showSensitiveEl = document.querySelector("#show-sensitive");
const historyListEl = document.querySelector("#history-list");

init().catch((error) => {
  setRequestMessage(error instanceof Error ? error.message : String(error), true);
});

addHeaderEl.addEventListener("click", () => addHeaderRow());

bodyModeEl.addEventListener("change", () => {
  const mode = bodyModeEl.value;
  bodyEl.disabled = mode === "none";
  formatJsonEl.disabled = mode !== "json";
});

formatJsonEl.addEventListener("click", () => {
  try {
    const parsed = JSON.parse(bodyEl.value || "{}");
    bodyEl.value = JSON.stringify(parsed, null, 2);
    setRequestMessage("JSON formatted.");
  } catch (_error) {
    setRequestMessage("Body is not valid JSON.", true);
  }
});

sendEl.addEventListener("click", async () => {
  const payload = buildPayload();

  if (!payload) {
    return;
  }

  sendEl.disabled = true;
  setRequestMessage("Sending request...");

  const result = await sendMessage({ type: "sendCustomRequest", payload });

  sendEl.disabled = false;

  if (!result.ok) {
    setRequestMessage(result.error || "Request failed.", true);
    renderError(result);
    return;
  }

  state.responseHeaders = result.response.headers || [];

  setRequestMessage(
    `Request completed (${result.response.status} ${result.response.statusText || ""}).`,
    false,
    true
  );

  renderBlockedHeaders(result.request.blockedHeaders || []);
  renderResponse(result.response);
  await loadHistory();
});

showSensitiveEl.addEventListener("change", () => {
  state.showSensitive = showSensitiveEl.checked;
  renderHeaders(state.responseHeaders);
});

async function init() {
  addHeaderRow("Accept", "application/json");
  bodyModeEl.dispatchEvent(new Event("change"));

  const params = new URLSearchParams(window.location.search);
  const sourceTabIdParam = params.get("sourceTabId");
  if (sourceTabIdParam) {
    state.sourceTabId = Number(sourceTabIdParam);
  }

  if (Number.isInteger(state.sourceTabId)) {
    const sourceResult = await sendMessage({ type: "getTabInfo", tabId: state.sourceTabId });
    if (sourceResult.ok && sourceResult.tab?.url?.startsWith("http")) {
      urlEl.value = sourceResult.tab.url;
    }
  }

  await loadHistory();
}

function addHeaderRow(name = "", value = "") {
  const row = document.createElement("div");
  row.className = "header-row";

  const nameInput = document.createElement("input");
  nameInput.placeholder = "Header name";
  nameInput.value = name;

  const valueInput = document.createElement("input");
  valueInput.placeholder = "Header value";
  valueInput.value = value;

  const removeButton = document.createElement("button");
  removeButton.type = "button";
  removeButton.textContent = "Remove";
  removeButton.addEventListener("click", () => row.remove());

  row.append(nameInput, valueInput, removeButton);
  headersListEl.appendChild(row);
}

function buildPayload() {
  const url = urlEl.value.trim();

  if (!url) {
    setRequestMessage("URL is required.", true);
    return null;
  }

  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      setRequestMessage("Only http:// and https:// URLs are supported.", true);
      return null;
    }
  } catch (_error) {
    setRequestMessage("URL is not valid.", true);
    return null;
  }

  const headers = [...headersListEl.querySelectorAll(".header-row")].map((row) => {
    const [nameInput, valueInput] = row.querySelectorAll("input");
    return {
      name: nameInput.value,
      value: valueInput.value
    };
  });

  return {
    method: methodEl.value,
    url,
    headers,
    bodyMode: bodyModeEl.value,
    body: bodyEl.value,
    followRedirects: followRedirectsEl.checked,
    includeCredentials: includeCredentialsEl.checked
  };
}

function renderResponse(response) {
  responseSummaryEl.innerHTML = `
    <strong>Status:</strong> ${escapeHtml(String(response.status))} ${escapeHtml(response.statusText || "")}<br>
    <strong>Final URL:</strong> ${escapeHtml(response.finalUrl || "")}
  `;

  renderHeaders(response.headers || []);

  if (response.bodyKind === "binary") {
    responseBodyEl.textContent = `Binary response\nContent-Type: ${response.contentType || "unknown"}\nSize: ${response.bodySize} bytes`;
    return;
  }

  if (!response.bodyText) {
    responseBodyEl.textContent = "No response body.";
    return;
  }

  if ((response.contentType || "").toLowerCase().includes("json")) {
    try {
      const parsed = JSON.parse(response.bodyText);
      responseBodyEl.textContent = JSON.stringify(parsed, null, 2);
    } catch (_error) {
      responseBodyEl.textContent = response.bodyText;
    }
  } else {
    responseBodyEl.textContent = response.bodyText;
  }

  if (response.bodyTruncated) {
    responseBodyEl.textContent += "\n\n[Preview truncated due to size]";
  }
}

function renderHeaders(headers) {
  state.responseHeaders = headers;

  if (!headers.length) {
    responseHeadersBodyEl.innerHTML = "<tr><td colspan=\"2\">No headers to show.</td></tr>";
    return;
  }

  responseHeadersBodyEl.innerHTML = headers
    .map((header) => {
      const value = shouldMask(header) && !state.showSensitive ? "[masked]" : header.value;
      return `<tr><td>${escapeHtml(header.name)}</td><td>${escapeHtml(String(value || ""))}</td></tr>`;
    })
    .join("");
}

function renderError(result) {
  const blocked = Array.isArray(result?.blockedHeaders) ? result.blockedHeaders : [];
  renderBlockedHeaders(blocked);

  responseSummaryEl.textContent = "Request did not complete.";
  responseHeadersBodyEl.innerHTML = "<tr><td colspan=\"2\">No headers to show.</td></tr>";

  const troubleshooting = [
    "Check host permissions when prompted.",
    "Endpoint may reject cross-origin requests or require auth.",
    "Restricted headers are ignored by browser policy."
  ];

  responseBodyEl.textContent = `${result.error || "Unknown request error."}\n\nTroubleshooting:\n- ${troubleshooting.join(
    "\n- "
  )}`;
}

function renderBlockedHeaders(blockedHeaders) {
  if (!blockedHeaders.length) {
    blockedHeadersEl.classList.add("hidden");
    blockedHeadersEl.textContent = "";
    return;
  }

  blockedHeadersEl.classList.remove("hidden");
  blockedHeadersEl.textContent = `Restricted headers were removed: ${blockedHeaders.join(", ")}.`;
}

function shouldMask(header) {
  if (header?.sensitive) {
    return true;
  }

  const lower = String(header?.name || "").toLowerCase();
  return lower === "authorization" || lower === "cookie" || lower === "set-cookie";
}

async function loadHistory() {
  const result = await sendMessage({ type: "getRequestHistory" });
  if (!result.ok) {
    return;
  }

  state.history = result.history || [];
  renderHistory();
}

function renderHistory() {
  if (!state.history.length) {
    historyListEl.innerHTML = "<li>No recent requests.</li>";
    return;
  }

  historyListEl.innerHTML = "";

  for (const item of state.history) {
    const li = document.createElement("li");

    const left = document.createElement("div");
    left.textContent = `${item.method} ${item.url} (${item.status})`;

    const reuseBtn = document.createElement("button");
    reuseBtn.type = "button";
    reuseBtn.textContent = "Reuse";
    reuseBtn.addEventListener("click", () => {
      methodEl.value = item.method;
      urlEl.value = item.url;
      setRequestMessage("Loaded request from history.");
    });

    li.append(left, reuseBtn);
    historyListEl.appendChild(li);
  }
}

function setRequestMessage(text, isError = false, isSuccess = false) {
  requestMessageEl.textContent = text;
  requestMessageEl.classList.toggle("error", Boolean(isError));
  requestMessageEl.classList.toggle("success", Boolean(isSuccess));
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
