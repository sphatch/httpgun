# HTTPGun

HTTPGun is a Chrome Manifest V3 extension for:

1. Inspecting response headers for the active tab's main document request.
2. Running custom HTTP requests in an extension viewer tab.

## Features

- Main-frame header capture for the current tab.
- Reload-and-capture flow when no response has been observed yet.
- Response summary: URL, status code, timestamp, headers.
- Optional redirect chain display.
- Header search and clipboard copy (raw / JSON).
- Sensitive-header masking (`authorization`, `cookie`, `set-cookie`) with toggle.
- One-click **Grant All Sites** action to avoid repeated per-host permission prompts.
- Request builder with method, URL, headers, body mode (`none`, `raw`, `json`).
- Restricted-header filtering and warning messages.
- Response viewer for status, headers, and body preview (JSON/text/binary metadata).
- Local request history (metadata only).

## Install (Unpacked)

1. Open `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the folder location where you downloaded this plugin.

## Usage

### Header Inspector (Popup)

1. Open any `http://` or `https://` page.
2. Click the extension icon.
3. If no capture exists, click **Reload & Capture**.
4. View status + response headers for the top-level document request.
5. Use search/copy controls as needed.

Important: response headers are only available if they were observed while the request happened.

### Custom Request Runner (Viewer Tab)

1. In the popup, click **Open Request Builder**.
2. Set method, URL, headers, and optional body.
3. Click **Send Request**.
4. Review status, final URL, response headers, and body preview.

The extension opens the viewer as an extension page tab next to the source tab.

## Permissions

- `activeTab`: access active tab context for popup actions.
- `tabs`: open viewer next to source tab and read source tab URL.
- `webRequest`: observe main-frame response headers.
- `storage`: persist captures and request history.
- `optional_host_permissions` (`<all_urls>`): requested at runtime per host when capturing/sending.

## Privacy and Safety

- Data is stored locally using `chrome.storage.local`.
- Sensitive header values are masked by default in UI.
- No external telemetry is included.

## Limitations

- This does not replicate the browser's exact navigation internals for custom requests.
- Browser/extension platform policies restrict certain request headers.
- Cross-origin and CORS behavior still applies.

## Project Files

- `manifest.json`
- `background.js`
- `popup.html`, `popup.css`, `popup.js`
- `viewer.html`, `viewer.css`, `viewer.js`
- `LICENSE`

## License

MIT. See `LICENSE`.
