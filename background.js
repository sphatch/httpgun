const CAPTURE_KEY = "capturedResponsesByTabId";
const HISTORY_KEY = "customRequestHistory";
const MAX_HISTORY_ITEMS = 20;
const MAX_BODY_PREVIEW_CHARS = 200_000;
const REDIRECT_CODES = new Set([301, 302, 303, 307, 308]);
const SENSITIVE_HEADERS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie"
]);

const FORBIDDEN_REQUEST_HEADERS = new Set([
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie",
  "date",
  "dnt",
  "expect",
  "host",
  "keep-alive",
  "origin",
  "permissions-policy",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via"
]);

let capturedResponsesByTabId = {};
let customRequestHistory = [];
const pendingCaptureTabIds = new Set();
const requestFlows = new Map();

const stateLoaded = loadState();

chrome.runtime.onInstalled.addListener(() => {
  void stateLoaded;
});

chrome.webRequest.onHeadersReceived.addListener(
  (details) => {
    if (details.type !== "main_frame" || details.tabId < 0) {
      return;
    }

    const flow = requestFlows.get(details.requestId) || {
      tabId: details.tabId,
      hops: []
    };

    flow.tabId = details.tabId;
    flow.hops.push({
      url: details.url,
      statusCode: details.statusCode,
      responseHeaders: sanitizeWebRequestHeaders(details.responseHeaders || []),
      timeCaptured: new Date().toISOString()
    });
    requestFlows.set(details.requestId, flow);

    if (!REDIRECT_CODES.has(details.statusCode)) {
      void persistCaptureFromFlow(details.tabId, flow.hops);
      requestFlows.delete(details.requestId);
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] },
  ["responseHeaders", "extraHeaders"]
);

chrome.webRequest.onErrorOccurred.addListener(
  (details) => {
    if (details.type !== "main_frame") {
      return;
    }

    requestFlows.delete(details.requestId);

    if (pendingCaptureTabIds.has(details.tabId)) {
      pendingCaptureTabIds.delete(details.tabId);
      safeSendRuntimeMessage({
        type: "captureFailed",
        tabId: details.tabId,
        error: details.error
      });
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  void (async () => {
    await stateLoaded;

    switch (message?.type) {
      case "getActiveTabCapture": {
        sendResponse({
          ok: true,
          capture: capturedResponsesByTabId[String(message.tabId)] || null
        });
        return;
      }

      case "reloadAndCapture": {
        const { tabId, tabUrl } = message;
        const allowed = await ensureHostPermission(tabUrl);

        if (!allowed) {
          sendResponse({
            ok: false,
            error: "Host permission was not granted."
          });
          return;
        }

        pendingCaptureTabIds.add(tabId);
        await chrome.tabs.reload(tabId);

        sendResponse({ ok: true });
        return;
      }

      case "openViewerTab": {
        const sourceTabId = message.sourceTabId;
        const sourceTab = await chrome.tabs.get(sourceTabId);
        const viewerUrl = chrome.runtime.getURL(
          `viewer.html?sourceTabId=${encodeURIComponent(String(sourceTabId))}`
        );

        const newTab = await chrome.tabs.create({
          url: viewerUrl,
          index: (sourceTab.index || 0) + 1,
          windowId: sourceTab.windowId,
          active: true
        });

        sendResponse({ ok: true, tabId: newTab.id });
        return;
      }

      case "getTabInfo": {
        const tabId = Number(message.tabId);
        if (!Number.isInteger(tabId)) {
          sendResponse({ ok: false, error: "Invalid tab id." });
          return;
        }

        try {
          const tab = await chrome.tabs.get(tabId);
          sendResponse({
            ok: true,
            tab: {
              id: tab.id,
              title: tab.title,
              url: tab.url
            }
          });
        } catch (_error) {
          sendResponse({ ok: false, error: "Could not read source tab." });
        }
        return;
      }

      case "sendCustomRequest": {
        const result = await executeCustomRequest(message.payload || {});

        if (result.ok) {
          customRequestHistory.unshift({
            time: new Date().toISOString(),
            method: result.request.method,
            url: result.request.url,
            status: result.response.status,
            ok: result.response.ok
          });

          if (customRequestHistory.length > MAX_HISTORY_ITEMS) {
            customRequestHistory = customRequestHistory.slice(0, MAX_HISTORY_ITEMS);
          }

          await chrome.storage.local.set({ [HISTORY_KEY]: customRequestHistory });
        }

        sendResponse(result);
        return;
      }

      case "getRequestHistory": {
        sendResponse({ ok: true, history: customRequestHistory });
        return;
      }

      default: {
        sendResponse({ ok: false, error: "Unknown message type." });
      }
    }
  })().catch((error) => {
    sendResponse({
      ok: false,
      error: error instanceof Error ? error.message : String(error)
    });
  });

  return true;
});

async function loadState() {
  const data = await chrome.storage.local.get([CAPTURE_KEY, HISTORY_KEY]);
  capturedResponsesByTabId = data[CAPTURE_KEY] || {};
  customRequestHistory = Array.isArray(data[HISTORY_KEY]) ? data[HISTORY_KEY] : [];
}

async function persistCaptureFromFlow(tabId, hops) {
  if (!Array.isArray(hops) || hops.length === 0) {
    return;
  }

  const finalHop = hops[hops.length - 1];
  const capture = {
    tabId,
    url: finalHop.url,
    statusCode: finalHop.statusCode,
    responseHeaders: finalHop.responseHeaders,
    timeCaptured: finalHop.timeCaptured,
    redirectChain: hops.length > 1 ? hops.slice(0, -1) : []
  };

  capturedResponsesByTabId[String(tabId)] = capture;
  await chrome.storage.local.set({ [CAPTURE_KEY]: capturedResponsesByTabId });

  if (pendingCaptureTabIds.has(tabId)) {
    pendingCaptureTabIds.delete(tabId);
  }

  safeSendRuntimeMessage({ type: "captureUpdated", tabId });
}

function sanitizeWebRequestHeaders(headers) {
  return headers.map((header) => {
    const name = String(header.name || "");
    const lower = name.toLowerCase();
    let value = "";

    if (typeof header.value === "string") {
      value = header.value;
    } else if (Array.isArray(header.binaryValue)) {
      value = `[binary:${header.binaryValue.length}]`;
    }

    return { name, value, sensitive: SENSITIVE_HEADERS.has(lower) };
  });
}

async function ensureHostPermission(urlString) {
  let pattern;

  try {
    const url = new URL(urlString);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return false;
    }

    pattern = `${url.origin}/*`;
  } catch (_error) {
    return false;
  }

  const contains = await chrome.permissions.contains({ origins: [pattern] });
  return contains;
}

async function executeCustomRequest(payload) {
  const method = String(payload.method || "GET").toUpperCase();
  const url = String(payload.url || "").trim();

  if (!url) {
    return { ok: false, error: "URL is required." };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    return { ok: false, error: "URL is not valid." };
  }

  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    return { ok: false, error: "Only http:// and https:// URLs are supported." };
  }

  const permissionOk = await ensureHostPermission(parsedUrl.toString());
  if (!permissionOk) {
    return {
      ok: false,
      error: "Host permission is required to send this request."
    };
  }

  const headerResult = sanitizeRequestHeaders(payload.headers || []);
  if (headerResult.error) {
    return { ok: false, error: headerResult.error };
  }

  const bodyMode = String(payload.bodyMode || "none");
  const followRedirects = payload.followRedirects !== false;
  const includeCredentials = payload.includeCredentials === true;

  const init = {
    method,
    headers: headerResult.headers,
    redirect: followRedirects ? "follow" : "manual",
    credentials: includeCredentials ? "include" : "omit"
  };

  if (
    ["GET", "HEAD"].includes(method) &&
    bodyMode !== "none" &&
    (payload.body || "").trim()
  ) {
    return { ok: false, error: `${method} requests cannot include a body.` };
  }

  if (!["GET", "HEAD"].includes(method) && bodyMode !== "none") {
    const bodyText = String(payload.body || "");

    if (bodyMode === "json") {
      try {
        const parsed = JSON.parse(bodyText || "{}");
        init.body = JSON.stringify(parsed);

        if (!hasHeader(headerResult.headers, "content-type")) {
          headerResult.headers["Content-Type"] = "application/json";
        }
      } catch (_error) {
        return { ok: false, error: "Body mode is JSON but body is not valid JSON." };
      }
    } else if (bodyMode === "raw") {
      init.body = bodyText;
    }
  }

  try {
    const response = await fetch(parsedUrl.toString(), init);
    const contentType = response.headers.get("content-type") || "";
    const responseHeaders = sanitizeFetchHeaders(response.headers);
    const body = await readResponseBody(response, contentType);

    return {
      ok: true,
      request: {
        method,
        url: parsedUrl.toString(),
        bodyMode,
        headers: headerResult.headers,
        blockedHeaders: headerResult.blockedHeaders,
        followRedirects,
        includeCredentials
      },
      response: {
        ok: response.ok,
        status: response.status,
        statusText: response.statusText,
        finalUrl: response.url,
        redirected: response.redirected,
        headers: responseHeaders,
        contentType,
        ...body
      }
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Request failed due to an unknown error.",
      blockedHeaders: headerResult.blockedHeaders
    };
  }
}

function sanitizeRequestHeaders(rawHeaders) {
  const headers = {};
  const blockedHeaders = [];

  for (const item of rawHeaders) {
    const name = String(item?.name || "").trim();
    if (!name) {
      continue;
    }

    const lower = name.toLowerCase();
    if (isForbiddenHeaderName(lower)) {
      blockedHeaders.push(name);
      continue;
    }

    headers[name] = String(item?.value || "");
  }

  return { headers, blockedHeaders };
}

function isForbiddenHeaderName(lowerName) {
  if (FORBIDDEN_REQUEST_HEADERS.has(lowerName)) {
    return true;
  }

  if (lowerName.startsWith("proxy-") || lowerName.startsWith("sec-")) {
    return true;
  }

  return false;
}

function hasHeader(headers, targetName) {
  const target = targetName.toLowerCase();
  return Object.keys(headers).some((name) => name.toLowerCase() === target);
}

function sanitizeFetchHeaders(headers) {
  const list = [];

  for (const [name, value] of headers.entries()) {
    const lower = name.toLowerCase();

    list.push({
      name,
      value,
      sensitive: SENSITIVE_HEADERS.has(lower)
    });
  }

  return list;
}

async function readResponseBody(response, contentType) {
  if (response.status === 204 || response.status === 304) {
    return {
      bodyKind: "empty",
      bodyText: "",
      bodySize: 0,
      bodyTruncated: false
    };
  }

  if (!isLikelyText(contentType)) {
    const buffer = await response.arrayBuffer();
    return {
      bodyKind: "binary",
      bodyText: "",
      bodySize: buffer.byteLength,
      bodyTruncated: false
    };
  }

  const text = await response.text();
  const truncated = text.length > MAX_BODY_PREVIEW_CHARS;

  return {
    bodyKind: "text",
    bodyText: truncated ? text.slice(0, MAX_BODY_PREVIEW_CHARS) : text,
    bodySize: text.length,
    bodyTruncated: truncated
  };
}

function isLikelyText(contentType) {
  const value = String(contentType || "").toLowerCase();

  return (
    value.startsWith("text/") ||
    value.includes("json") ||
    value.includes("xml") ||
    value.includes("javascript") ||
    value.includes("x-www-form-urlencoded") ||
    value === ""
  );
}

function safeSendRuntimeMessage(message) {
  chrome.runtime.sendMessage(message, () => {
    void chrome.runtime.lastError;
  });
}
