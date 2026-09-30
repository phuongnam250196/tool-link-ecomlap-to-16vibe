# EcomLap Gemini Assistant - AI Agent & Developer Skills

This document details practical operational skills, recipes, debugging workflows, and maintenance guides for AI agents and human developers working on **EcomLap Gemini Assistant** (`d:\workspace\tools\extension-gemini\extension-gemini`).

---

## 🛠️ Skill 1: Gemini Web DOM Maintenance & Selector Updates

Google Gemini (`gemini.google.com`) frequently changes its CSS classes, DOM hierarchy, and custom elements. When automation fails to input text, attach images, or detect generated results, apply this skill.

### 1. Key Gemini DOM Selectors Reference

| Functionality | Primary Selectors | Fallback Selectors |
|---|---|---|
| **Chat Input Container** | `rich-textarea` | `div[contenteditable="true"]`, `p[data-placeholder]` |
| **Send Button** | `button[aria-label*="Send"]` | `button.send-button`, `button[data-test-id="send-button"]` |
| **Response Container** | `.conversation-container` | `[data-message-author-role="assistant"]`, `.response-content` |
| **Model Response Text** | `.model-response-text` | `.markdown`, `[data-message-author-role="assistant"] p` |
| **Generated Image** | `generated-image`, `single-image` | `.generated-image img`, `img[src*="googleusercontent.com"]` |
| **File Attachment Input**| `input[type="file"]` | `button[aria-label*="Upload"]`, `button[aria-label*="image"]` |

### 2. Updating Selectors in `scripts/content/gemini-content.js`
When Gemini updates its DOM:
1. Open Chrome DevTools on `gemini.google.com`.
2. Inspect the modified element (e.g., input area or image card).
3. Update `gemini-content.js` with defensive query patterns (checking array of candidate selectors).
4. Verify event dispatch:
   - For `contenteditable`, dispatch `input`, `change`, and `keydown` events:
     ```javascript
     editor.dispatchEvent(new Event('input', { bubbles: true }));
     editor.dispatchEvent(new Event('change', { bubbles: true }));
     ```

---

## 🛠️ Skill 2: Extension IPC & Message Handling

All inter-process communication in Manifest V3 goes through Chrome runtime messages.

### Adding a New Message Action:
1. **Define Action in Service Worker (`scripts/background.js`)**:
   Add a case inside the `chrome.runtime.onMessage.addListener` switch statement:
   ```javascript
   case "myNewAction":
       return handleMyNewAction(message.data)
           .then(result => sendResponse({ success: true, data: result }))
           .catch(err => sendResponse({ success: false, error: err.message })), true; // true keeps channel open
   ```
2. **Implement Async Handler**:
   Ensure `hmt-token` is pulled from storage if authenticated requests are needed:
   ```javascript
   async function handleMyNewAction(data) {
       const token = await getStorageKey("hmt-token");
       if (!token) throw new Error("Not authenticated");
       const res = await fetch(`${SERVER_URL}/api/...`, {
           headers: { "hmt-token": token, "Content-Type": "application/json" }
       });
       return await res.json();
   }
   ```
3. **Dispatch from Content Script or Popup**:
   ```javascript
   chrome.runtime.sendMessage({
       action: "myNewAction",
       data: { param1: "value" }
   }, response => {
       if (response?.success) {
           console.log("Success:", response.data);
       } else {
           console.error("Failed:", response?.error);
       }
   });
   ```

---

## 🛠️ Skill 3: Queue Automation & Claim Cycle Debugging

The extension automates processing items from the EcomLap backend queue.

### Automation State Machine:
```
[IDLE / WAITING] 
       │
       ▼ (claimNextDesignIdea)
[CLAIMED / IN_PROGRESS] ──(Gemini Reject / Safety Block)──► [FAIL / RETRY]
       │                                                          │
       ▼ (Image Generated & Validated)                            │ (failDesignIdea)
[UPLOADING TO ECOMLAP]                                            ▼
       │                                                   [LOGGED ERROR]
       ▼ (uploadImageToServer)
[COMPLETED] ──(completeDesignIdea)──► [CLAIM NEXT / IDLE]
```

### Stale Claim Resolution:
- If the browser crashes, tab is closed, or generation hangs, claims can become orphaned.
- Use `releaseStaleDesignIdeas`:
  ```javascript
  chrome.runtime.sendMessage({
      action: "releaseStaleDesignIdeas",
      data: { timeout: 10 } // releases claims older than 10 minutes
  });
  ```
- Always implement `try ... catch ... finally` blocks in content script loops to ensure `releaseDesignIdea` is called if an uncaught exception occurs during submission.

---

## 🛠️ Skill 4: Image Pipeline & Cross-Origin Uploads

Gemini returns images via temporary Google CDN URLs (`lh3.googleusercontent.com` / `*.googleusercontent.com`).

### 1. Downloading Remote Image as Blob:
```javascript
const response = await fetch(googleImageUrl);
const blob = await response.blob();
```

### 2. Converting Blob to Base64 (for In-Memory / Clipboard Injection):
```javascript
const reader = new FileReader();
reader.onloadend = () => {
    const base64Data = reader.result;
    // use base64Data
};
reader.readAsDataURL(blob);
```

### 3. Server Upload via Service Worker:
Content scripts should **not** perform multipart uploads directly if cross-origin cookies or specific headers are blocked. Delegate to the service worker via `uploadImageToServer`:
```javascript
chrome.runtime.sendMessage({
    action: "uploadImageToServer",
    data: {
        imageUrl: generatedImageUrl,
        design_idea_id: ideaId,
        background_color_compatibility: "all",
        design_category: null,
        is_trademark: false
    }
});
```

---

## 🛠️ Skill 5: Authentication & Storage Troubleshooting

The extension stores user state in `chrome.storage.local`.

### 1. Inspect Storage State in Browser Console:
Open DevTools on the Gemini page or Service Worker and run:
```javascript
chrome.storage.local.get(null, items => console.log("Current Extension Storage:", items));
```

### 2. Key Values:
- `hmt-token`: JWT authentication string.
- `user-id`: Current user identifier.
- `remember-me`: If `true`, credentials will be auto-filled upon expiry.

### 3. Handling 401 / Token Expiry:
When backend returns status `401` or `403`:
1. `removeToken()` is executed automatically.
2. Content script detects `authStatusChanged`.
3. Existing floating manager controls are removed and login prompt is displayed.

---

## 🛠️ Skill 6: Testing & Loading Unpacked Extension

### Step-by-Step Setup:
1. Open Google Chrome, Brave, or Edge.
2. Navigate to `chrome://extensions/`.
3. Enable **Developer mode** toggle in the top-right corner.
4. Click **Load unpacked** button.
5. Select the folder: `d:\workspace\tools\extension-gemini\extension-gemini`.
6. Verify:
   - Name: `EcomLap Gemini Assistant`
   - Version: `1.0.0`
   - Service worker status: **active** (click "service worker" to open background DevTools).
7. Navigate to `https://gemini.google.com/` and confirm that `#ecomlap-control-panel` loads at the bottom-right corner.
