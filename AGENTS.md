# 16vibe Assistant - AI Agent Guidelines & Architecture Reference

This document outlines the architecture, coding standards, message contracts, and guidelines for AI agents working on the **16vibe Assistant** Chrome Extension project (`d:\workspace\tools\extension-gemini\extension-gemini`).

---

## 🏗️ Project Architecture Overview

**16vibe Assistant** is a **Chrome Extension (Manifest V3)** designed to automate AI image generation, prompt injection, and result synchronization between **Google Gemini (`gemini.google.com`)** and the **EcomLap E-Commerce Platform (`https://ecomlap.com`)**.

```
d:\workspace\tools\extension-gemini\extension-gemini/
├── manifest.json                  # Manifest V3 extension configuration & permissions
├── assets/
│   ├── images/                    # Icons (logo-16.png, logo-128.png, logo.svg)
│   └── styles/                    # Injected stylesheets into Gemini web app
│       ├── gemini.css             # Floating control panel & status overlay styles
│       ├── gemini-manager.css     # Gemini automation manager & modal styles
│       └── design-ideas-manager.css # Design ideas queue & item manager styles
├── popup/                         # Extension Action Popup UI (React + MUI)
│   ├── popup.html                 # HTML shell mounting #root
│   ├── css/popup.css              # Popup baseline styles
│   └── scripts/popup.js           # Compiled React bundle for login & status controls
├── scripts/
│   ├── background.js              # Background Service Worker (MV3 IPC & API Bridge)
│   ├── content/
│   │   └── gemini-content.js      # Content Script injected into gemini.google.com
│   └── services/                  # Modular ES Service Layer
│       ├── api.js                 # HTTP fetch wrapper, token handling, file upload
│       ├── auth.js                # Authentication, token storage, credential caching
│       └── design-ideas.js        # Design ideas queue CRUD & AI analysis service
├── AGENTS.md                      # Architecture guidelines & agent reference (this file)
└── SKILLS.md                      # Actionable operational skills for developers & AI agents
```

---

## 🔄 Core Automation & Data Flow Lifecycle

The primary purpose of this extension is unattended and semi-automated design generation using Google Gemini:

```
+-----------------------------------------------------------------------------------------+
|                                    EcomLap Server                                       |
|                                 (https://ecomlap.com)                                   |
+-----------------------------------------------------------------------------------------+
       ^ claimNextDesignIdea          | design idea data               | upload design
       |                              v                                v
+-----------------------------------------------------------------------------------------+
|                               Background Service Worker                                 |
|                                (scripts/background.js)                                  |
+-----------------------------------------------------------------------------------------+
       ^                              |                                ^
       | IPC Message                  | IPC Response                   | IPC Message
       v                              v                                v
+-----------------------------------------------------------------------------------------+
|                               Content Script (Gemini Web)                               |
|                           (scripts/content/gemini-content.js)                           |
+-----------------------------------------------------------------------------------------+
       |                                                               ^
       | 1. Injects prompt & reference image into editor               | 3. Detects generated
       | 2. Simulates user submission                                  |    image & extracts URL
       v                                                               |
+-----------------------------------------------------------------------------------------+
|                               Google Gemini Web UI                                      |
|                               (gemini.google.com)                                       |
+-----------------------------------------------------------------------------------------+
```

### Detailed Automation Steps:
1. **Claim Task**: Content script requests `claimNextDesignIdea` via background service worker from `/api/design-ideas/extension/claim-next`.
2. **Formulate Prompt**: Downloads reference image as Base64/Blob if applicable, prepends system instructions, keywords, and styling prompts.
3. **Inject & Submit**:
   - Injects reference image into Gemini's file attachment input/paste event.
   - Sets prompt text into Gemini's contenteditable/textarea prompt container.
   - Waits for prompt stabilization delay (`c.PROMPT_DELAY`), then triggers submit button.
4. **Monitor Response**:
   - Polls Gemini DOM for completion and watches for rejection keywords (policy flags, safety filter blocks).
   - Extracts generation response text or structured JSON from markdown code blocks.
5. **Capture & Upload Result**:
   - Locates `generated-image` / `single-image` / `.generated-image` DOM nodes.
   - Displays real-time status overlay (`ecomlap-status-overlay`: Success or Failed with Retry).
   - Sends image URL to background worker via `uploadImageToServer` (`/api/designs/upload-from-extension`).
6. **Finalize Queue Status**:
   - Success: Calls `completeDesignIdea` (`/api/design-ideas/extension/:id/complete`).
   - Failure: Calls `failDesignIdea` (`/api/design-ideas/extension/:id/fail`).
   - Timeout/Cancel: Calls `releaseDesignIdea` (`/api/design-ideas/extension/:id/release`).

---

## 📡 Message Passing & IPC Contract

Communication between **Content Scripts**, **Popup**, and **Background Service Worker** relies on `chrome.runtime.sendMessage({ action, data })`:

| Action | Direction | Payload (`data`) | Description |
|---|---|---|---|
| `getAuthStatus` | CS/Popup -> BG | *(none)* | Returns `{ authenticated: boolean, token }` |
| `claimNextDesignIdea` | CS -> BG | `{ tags, creator, extension_id, serverUrl }` | Claims next pending idea from EcomLap queue |
| `completeDesignIdea` | CS -> BG | `{ idea_id, design_id, serverUrl }` | Marks claimed idea completed with design ID |
| `failDesignIdea` | CS -> BG | `{ idea_id, error_message, serverUrl }` | Marks idea failed with error cause |
| `releaseDesignIdea` | CS -> BG | `{ idea_id, serverUrl }` | Releases claim lock so another worker can process |
| `releaseStaleDesignIdeas` | CS/BG -> BG | `{ timeout, serverUrl }` | Releases claims older than timeout (mins) |
| `uploadImage` | CS -> BG | `{ imageUrl, fileName, serverUrl }` | Fetches image & POSTs to `/api/images/upload` |
| `uploadImageToServer` | CS -> BG | `{ imageUrl, design_idea_id, background_color_compatibility, design_category, is_trademark, serverUrl }` | Saves generated design to `/api/designs/upload-from-extension` |
| `getDesignIdeas` | CS/Popup -> BG | `{ page, limit, is_used, is_merch, search, serverUrl }` | Fetches paginated design ideas list & stats |
| `saveDesignIdea` | CS/Popup -> BG | `{ ideaData, serverUrl }` | Creates new design idea via `/api/design-ideas` |
| `markDesignIdeaAsUsed` | CS -> BG | `{ idea_id, serverUrl }` | Marks idea as used (`PUT /api/design-ideas/:id/mark-used`) |
| `markDesignIdeaAsSkipped` | CS -> BG | `{ idea_id, serverUrl }` | Marks idea skipped (`PUT /api/design-ideas/:id/mark-skipped`) |
| `analyzeDesignIdea` | CS/Popup -> BG | `{ idea_id, prompt, cropped_image, ai_provider, api_token, serverUrl }` | Calls `/api/design-ideas/analyze` |
| `downloadImageAsBase64` | CS -> BG | `{ imageUrl }` | Converts remote image URL to Base64 data URI |
| `getDesignCategories` | CS/Popup -> BG | `{ serverUrl }` | Fetches design categories (`/api/designs/categories/all`) |
| `getExtensionStats` | CS/Popup -> BG | `{ serverUrl }` | Fetches extension workload statistics |
| `activateTab` | CS -> BG | *(none)* | Focuses the current tab and browser window |
| `openPopup` | CS -> BG | *(none)* | Programmatically opens the extension action popup |

---

## 🔐 Storage & Security Model

The extension uses `chrome.storage.local` to store state and credentials:

- **`hmt-token`**: JWT Bearer token sent in HTTP headers (`hmt-token: <jwt>`).
- **`user-id`**: Identifier of the authenticated user.
- **`user-info`**: Cached user profile object.
- **`saved-email` & `saved-password`**: Optional cached credentials if "Remember Me" is enabled.
- **`remember-me`**: Boolean indicating whether credentials should persist across sessions.

### Security Principles:
1. **Host Permissions Guard**: Only authorized domains declared in `manifest.json` (`gemini.google.com`, `ai.google.dev`, `*.googleusercontent.com`, `*.amazonaws.com`) are accessible.
2. **Token Invalidation**: Any 401/403 response automatically invokes `removeToken()`, prompting re-authentication.
3. **No Direct Secret Embedding**: Service workers read tokens exclusively from `chrome.storage.local`.

---

## ⚙️ Environment Configuration (.env)

The extension supports dynamic environment configuration via `.env` file at the root:

```env
# Frontend URL where extension is injected and active
FRONTEND_URL=http://localhost:3000

# Backend API server URL for saving data & queue management
BACKEND_URL=http://localhost:9000
```

- **Runtime Loading**: `scripts/background.js` and `scripts/config.js` load `.env` via `chrome.runtime.getURL('.env')`.
- **Modifying URLs**: To change the backend or frontend target, simply update `.env` and reload the extension in `chrome://extensions/`.
- **Supported Hosts**: `manifest.json` permits `http://localhost/*`, `http://127.0.0.1/*`, `http://localhost:3000/*`, and `http://localhost:9000/*`.

---

## 📡 API Call Monitor Widget

When authenticated (`hmt-token` present in `chrome.storage.local`), the extension renders an API monitoring widget:
- **Location**: Anchored vertically at the middle of the right screen edge (`top: 50%; right: 0; transform: translateY(-50%)`).
- **Target URL**: Monitors whether the active page is calling `https://ecomlap.com/api/products` (or `/api/products`).
- **Dual Detection Engine**:
  1. **Background Service Worker**: Uses `chrome.webRequest.onBeforeRequest`, `onCompleted`, and `onErrorOccurred` to intercept network traffic without page overhead.
  2. **Content Script (`api-monitor.js`)**: Injects an in-page interceptor monkey-patching `window.fetch` and `XMLHttpRequest` with `CustomEvent('16vibe-api-detect')` for immediate, real-time UI feedback.
- **States**: `Idle` (waiting), `Calling` (in-flight request with pulsing amber indicator), `Detected / 200 OK` (glowing emerald badge with call counter & timestamp), `Error` (red indicator).
- **Features**: Collapsible handle, call history list, reset log action.

---



## ⚡ Core Rules & Best Practices for AI Agents

1. **Manifest V3 Ephemeral Service Worker**:
   - The background service worker can terminate when idle. **Never** keep in-memory global state across asynchronous message calls. Always persist state to `chrome.storage.local` or database.
   - Background worker cannot access DOM APIs (`window`, `document`). All DOM manipulations must be performed inside `scripts/content/gemini-content.js`.

2. **DOM Selectors Robustness for Gemini Web**:
   - Google Gemini updates its frontend frequently. Do not rely exclusively on brittle class names like `.send-button`.
   - Prefer fallback chains: `[data-message-author-role="assistant"]`, `.conversation-container`, `rich-textarea`, `p[data-placeholder]`.
   - Always verify element presence before executing synthetic click or keyboard events.

3. **Rate Limiting & Anti-Bot Delays**:
   - Ensure a human-like delay (`PROMPT_DELAY` ~ 1500ms - 3000ms) between prompt insertion, image attachment, and clicking submit.
   - Do not trigger rapid consecutive requests to prevent Google account flagging or temporary Gemini bans.

4. **Claim Lock Hygiene**:
   - When an idea is claimed via `claimNextDesignIdea`, the backend locks the item to prevent duplicate generation.
   - Agents must guarantee that on error or abort, `releaseDesignIdea` or `failDesignIdea` is dispatched so queue items are never permanently orphaned.

5. **Cross-Origin Image Handling**:
   - Google Gemini generates images hosted on `*.googleusercontent.com`.
   - Fetching and uploading must handle CORS appropriately using background service worker fetch, leveraging permissions defined in `manifest.json`.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **extension-gemini** (6693 symbols, 13217 relationships, 431 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/extension-gemini/context` | Codebase overview, check index freshness |
| `gitnexus://repo/extension-gemini/clusters` | All functional areas |
| `gitnexus://repo/extension-gemini/processes` | All execution flows |
| `gitnexus://repo/extension-gemini/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->
