# AI Image Overlay Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an AI paintbrush button above the GIF button that lets players generate images from text prompts via Hugging Face Spaces (FLUX.1-schnell), broadcasting them as flying animations to all players in the lobby.

**Architecture:** Server-authoritative proxy matching the GIF system. Client sends prompt via socket, server calls HF Spaces Gradio API, converts response to base64, broadcasts to lobby. New `AiImageOverlay` component rendered inside `EmoteOverlay` with mutual exclusivity across all three panels (emote, GIF, AI).

**Tech Stack:** React 19, Socket.IO, HF Spaces Gradio REST API (evalstate/flux1_schnell), CSS modules, base64 data URLs

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `client/src/components/AiImageOverlay.jsx` | AI button, prompt panel, generation state, flying images |
| Create | `client/src/components/AiImageOverlay.module.css` | Button, panel, spinner, flying animation styles |
| Modify | `shared/events.js` | Add 3 new socket events |
| Modify | `shared/version.js` | Bump to 1.6.0 |
| Modify | `server/src/index.js` | AI image socket handler + HF Spaces API call |
| Modify | `client/src/components/EmoteOverlay.jsx` | Render AiImageOverlay, add aiOpen state, mutual exclusivity |

---

### Task 1: Add Socket Events

**Files:**
- Modify: `shared/events.js:50-54`
- Modify: `shared/version.js:1`

- [ ] **Step 1: Add AI image events to shared/events.js**

Open `shared/events.js` and add these 3 events before the closing `};`:

```js
  GIF_SEND: 'gif:send',
  GIF_BROADCAST: 'gif:broadcast',
  AI_IMAGE_SEND: 'ai-image:send',
  AI_IMAGE_BROADCAST: 'ai-image:broadcast',
  AI_IMAGE_ERROR: 'ai-image:error',
};
```

- [ ] **Step 2: Bump version to 1.6.0**

In `shared/version.js`, change:
```js
export const VERSION = '1.6.0';
```

- [ ] **Step 3: Commit**

```bash
git add shared/events.js shared/version.js
git commit -m "feat: add AI image socket events and bump to v1.6.0"
```

---

### Task 2: Server-Side AI Image Handler

**Files:**
- Modify: `server/src/index.js` (after the GIF_SEND handler at ~line 242)

- [ ] **Step 1: Add the AI image socket handler**

In `server/src/index.js`, after the `GIF_SEND` handler block (after line 242), add:

```js
  // --- AI Image Generation ---
  socket.on(EVENTS.AI_IMAGE_SEND, async (data) => {
    const lobbyId = lobbyManager.getPlayerLobby(socket.id);
    if (!lobbyId) return;
    const prompt = data?.prompt;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length === 0) return;
    const sanitized = prompt.trim().slice(0, 200);
    // Rate-limit: 30 seconds between AI image requests per player
    const now = Date.now();
    if (socket.data._lastAiImage && now - socket.data._lastAiImage < 30000) return;
    socket.data._lastAiImage = now;

    try {
      // Step 1: Enqueue the generation request
      const hfToken = process.env.HF_TOKEN || '';
      const headers = { 'Content-Type': 'application/json' };
      if (hfToken) headers['Authorization'] = `Bearer ${hfToken}`;

      const enqueueResp = await fetch('https://evalstate-flux1-schnell.hf.space/call/flux1_schnell_infer', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          data: [sanitized, 0, true, 512, 512, 4],
        }),
      });

      if (!enqueueResp.ok) {
        socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Image generation service unavailable' });
        socket.data._lastAiImage = 0; // Reset cooldown on failure
        return;
      }

      const { event_id } = await enqueueResp.json();
      if (!event_id) {
        socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Failed to queue image generation' });
        socket.data._lastAiImage = 0;
        return;
      }

      // Step 2: Poll for result via SSE endpoint
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 60000); // 60s timeout

      const resultResp = await fetch(
        `https://evalstate-flux1-schnell.hf.space/call/flux1_schnell_infer/${event_id}`,
        { headers, signal: controller.signal }
      );
      clearTimeout(timeout);

      const text = await resultResp.text();
      // Parse SSE — find the "complete" event's data line
      const lines = text.split('\n');
      let resultData = null;
      for (let i = 0; i < lines.length; i++) {
        if (lines[i].startsWith('event: complete')) {
          // Next line is "data: ..."
          const dataLine = lines[i + 1];
          if (dataLine && dataLine.startsWith('data: ')) {
            resultData = JSON.parse(dataLine.slice(6));
          }
          break;
        }
        if (lines[i].startsWith('event: error')) {
          const dataLine = lines[i + 1];
          socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Generation failed' });
          socket.data._lastAiImage = 0;
          return;
        }
      }

      if (!resultData || !resultData[0]?.url) {
        socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'No image in response' });
        socket.data._lastAiImage = 0;
        return;
      }

      // Step 3: Fetch the generated image file and convert to base64
      const imageUrl = resultData[0].url;
      const imgResp = await fetch(imageUrl);
      if (!imgResp.ok) {
        socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Failed to retrieve generated image' });
        socket.data._lastAiImage = 0;
        return;
      }
      const arrayBuf = await imgResp.arrayBuffer();
      const base64 = Buffer.from(arrayBuf).toString('base64');
      const dataUrl = `data:image/webp;base64,${base64}`;

      // Step 4: Broadcast to everyone in the lobby
      io.to(lobbyId).emit(EVENTS.AI_IMAGE_BROADCAST, {
        imageUrl: dataUrl,
        nickname: socket.data.nickname || socket.id,
      });
    } catch (err) {
      socket.emit(EVENTS.AI_IMAGE_ERROR, { error: 'Image generation timed out or failed' });
      socket.data._lastAiImage = 0;
    }
  });
```

- [ ] **Step 2: Verify server starts without errors**

```bash
cd server && npm run dev
```

Expected: Server starts, no syntax or import errors. Stop it after confirming.

- [ ] **Step 3: Commit**

```bash
git add server/src/index.js
git commit -m "feat: add server-side AI image generation handler via HF Spaces"
```

---

### Task 3: Create AiImageOverlay CSS Module

**Files:**
- Create: `client/src/components/AiImageOverlay.module.css`

- [ ] **Step 1: Create the CSS module**

Create `client/src/components/AiImageOverlay.module.css`:

```css
/* --- AI Image Trigger Button --- */
.aiTrigger {
  position: absolute;
  bottom: calc(1rem + 52px);
  right: 1rem;
  z-index: 102;
  width: 44px;
  height: 44px;
  border-radius: 50%;
  border: 2px solid var(--gold-dim, #8a7230);
  background: var(--bg-panel, #2a1515);
  color: var(--gold, #d4a843);
  font-size: 1.2rem;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 0.2s, border-color 0.2s, transform 0.15s;
  pointer-events: auto;
}

.aiTrigger:hover {
  background: #3a2020;
  border-color: var(--gold, #d4a843);
  transform: scale(1.05);
}

.aiTriggerOpen {
  background: #3a2020;
  border-color: var(--gold, #d4a843);
}

.cooldownText {
  font-size: 0.85rem;
  color: #e53935;
  font-weight: 700;
}

/* --- Prompt Panel --- */
.aiPanel {
  position: absolute;
  bottom: calc(1rem + 104px);
  right: 1rem;
  z-index: 103;
  width: 300px;
  background: var(--bg-panel, #2a1515);
  border: 2px solid var(--gold-dim, #8a7230);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  pointer-events: auto;
}

.aiPromptInput {
  width: 100%;
  padding: 0.6rem 0.8rem;
  border: none;
  border-bottom: 1px solid var(--gold-dim, #8a7230);
  background: #1a0e0e;
  color: var(--text-primary, #f0e6d3);
  font-family: var(--font-body, 'Raleway', sans-serif);
  font-size: 0.85rem;
  outline: none;
  box-sizing: border-box;
  resize: none;
  min-height: 60px;
}

.aiPromptInput::placeholder {
  color: var(--text-secondary, #b8a88a);
  opacity: 0.6;
}

.aiPromptInput:focus {
  background: #231414;
}

.aiActions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0.5rem 0.6rem;
}

.generateBtn {
  background: linear-gradient(135deg, var(--gold-dim, #8a7230), var(--gold, #d4a843));
  color: #1a0e0e;
  border: none;
  border-radius: 8px;
  padding: 0.4rem 1rem;
  font-family: var(--font-body, 'Raleway', sans-serif);
  font-size: 0.8rem;
  font-weight: 700;
  cursor: pointer;
  transition: opacity 0.2s, transform 0.15s;
}

.generateBtn:hover:not(:disabled) {
  transform: scale(1.05);
  opacity: 0.9;
}

.generateBtn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.generating {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  color: var(--gold, #d4a843);
  font-size: 0.75rem;
  font-family: var(--font-body, 'Raleway', sans-serif);
}

.spinner {
  width: 14px;
  height: 14px;
  border: 2px solid var(--gold-dim, #8a7230);
  border-top-color: var(--gold, #d4a843);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.aiAttribution {
  text-align: center;
  padding: 0.3rem;
  font-size: 0.6rem;
  color: var(--text-secondary, #b8a88a);
  opacity: 0.5;
  border-top: 1px solid var(--gold-dim, #8a7230);
}

.errorText {
  color: #e53935;
  font-size: 0.7rem;
  font-family: var(--font-body, 'Raleway', sans-serif);
  padding: 0 0.6rem 0.4rem;
}

.charCount {
  font-size: 0.65rem;
  color: var(--text-secondary, #b8a88a);
  opacity: 0.6;
}

/* --- Flying AI Image Animation --- */
/* Reuses the same keyframes as GIF overlay */
.flyingAiImage {
  position: fixed;
  z-index: 200;
  pointer-events: none;
  display: flex;
  flex-direction: column;
  align-items: center;
  will-change: transform, opacity;
}

.flyingAiImg {
  max-height: 180px;
  max-width: 240px;
  border-radius: 8px;
  box-shadow: 0 4px 20px rgba(0, 0, 0, 0.5);
  border: 2px solid var(--gold-dim, #8a7230);
}

.flyingAiName {
  margin-top: 4px;
  font-size: 0.7rem;
  font-family: var(--font-body, 'Raleway', sans-serif);
  color: var(--gold, #d4a843);
  background: rgba(0, 0, 0, 0.6);
  padding: 1px 8px;
  border-radius: 8px;
  white-space: nowrap;
}

/* Left-to-Right fly */
.flyLTR {
  animation: aiFlyLTR 3.5s ease-in-out forwards;
}

@keyframes aiFlyLTR {
  0% {
    transform: translateX(-280px) translateY(0) scale(0.6);
    opacity: 0;
  }
  10% {
    opacity: 1;
    transform: translateX(5vw) translateY(-10px) scale(1);
  }
  50% {
    transform: translateX(45vw) translateY(-30px) scale(1);
    opacity: 1;
  }
  90% {
    opacity: 1;
    transform: translateX(85vw) translateY(-10px) scale(1);
  }
  100% {
    transform: translateX(calc(100vw + 280px)) translateY(0) scale(0.6);
    opacity: 0;
  }
}

/* Right-to-Left fly */
.flyRTL {
  animation: aiFlyRTL 3.5s ease-in-out forwards;
}

@keyframes aiFlyRTL {
  0% {
    transform: translateX(calc(100vw + 280px)) translateY(0) scale(0.6);
    opacity: 0;
  }
  10% {
    opacity: 1;
    transform: translateX(85vw) translateY(-10px) scale(1);
  }
  50% {
    transform: translateX(45vw) translateY(-30px) scale(1);
    opacity: 1;
  }
  90% {
    opacity: 1;
    transform: translateX(5vw) translateY(-10px) scale(1);
  }
  100% {
    transform: translateX(-280px) translateY(0) scale(0.6);
    opacity: 0;
  }
}

/* --- Mobile --- */
@media (max-width: 600px) {
  .aiPanel {
    right: 0.5rem;
    left: 0.5rem;
    width: auto;
    bottom: calc(1rem + 96px);
  }

  .aiTrigger {
    right: 0.5rem;
    bottom: calc(0.5rem + 48px);
    width: 40px;
    height: 40px;
  }

  .flyingAiImg {
    max-height: 120px;
    max-width: 160px;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/AiImageOverlay.module.css
git commit -m "feat: add AI image overlay CSS module"
```

---

### Task 4: Create AiImageOverlay Component

**Files:**
- Create: `client/src/components/AiImageOverlay.jsx`

- [ ] **Step 1: Create the component**

Create `client/src/components/AiImageOverlay.jsx`:

```jsx
import { useState, useEffect, useCallback, useRef } from 'react';
import { useSocketContext } from '../context/SocketContext.jsx';
import { EVENTS } from '../../../shared/events.js';
import styles from './AiImageOverlay.module.css';

const AI_COOLDOWN = 30; // seconds — matches server rate limit
let flyIdCounter = 0;

export default function AiImageOverlay({ isOpen, onToggle, onRequestClose }) {
  const { socket } = useSocketContext();
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const [flyingImages, setFlyingImages] = useState([]);
  const cooldownRef = useRef(null);
  const errorTimeoutRef = useRef(null);

  // Cooldown timer
  useEffect(() => {
    if (cooldown <= 0) { clearInterval(cooldownRef.current); return; }
    cooldownRef.current = setInterval(() => {
      setCooldown((c) => Math.max(0, c - 1));
    }, 1000);
    return () => clearInterval(cooldownRef.current);
  }, [cooldown > 0]);

  // Listen for AI image broadcasts from all players
  useEffect(() => {
    if (!socket) return;
    function onAiBroadcast(data) {
      const direction = Math.random() > 0.5 ? 'ltr' : 'rtl';
      const top = 15 + Math.random() * 50; // 15-65% from top
      setFlyingImages((prev) => [...prev, {
        id: ++flyIdCounter,
        url: data.imageUrl,
        nickname: data.nickname,
        direction,
        top,
      }]);
      // If we were the one generating, clear the generating state
      setGenerating(false);
    }
    socket.on(EVENTS.AI_IMAGE_BROADCAST, onAiBroadcast);
    return () => socket.off(EVENTS.AI_IMAGE_BROADCAST, onAiBroadcast);
  }, [socket]);

  // Listen for errors (only sent to the requesting player)
  useEffect(() => {
    if (!socket) return;
    function onAiError(data) {
      setGenerating(false);
      setError(data?.error || 'Generation failed');
      setCooldown(0); // Allow retry on failure
      clearTimeout(errorTimeoutRef.current);
      errorTimeoutRef.current = setTimeout(() => setError(''), 10000);
    }
    socket.on(EVENTS.AI_IMAGE_ERROR, onAiError);
    return () => {
      socket.off(EVENTS.AI_IMAGE_ERROR, onAiError);
      clearTimeout(errorTimeoutRef.current);
    };
  }, [socket]);

  const removeFlyingImage = useCallback((id) => {
    setFlyingImages((prev) => prev.filter((img) => img.id !== id));
  }, []);

  function handleGenerate() {
    if (generating || cooldown > 0 || !prompt.trim()) return;
    socket?.emit(EVENTS.AI_IMAGE_SEND, { prompt: prompt.trim() });
    setGenerating(true);
    setError('');
    setCooldown(AI_COOLDOWN);
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleGenerate();
    }
  }

  return (
    <>
      {/* AI trigger button */}
      <button
        className={`${styles.aiTrigger} ${isOpen ? styles.aiTriggerOpen : ''}`}
        onClick={onToggle}
        title={cooldown > 0 ? `Wait ${cooldown}s` : 'Generate AI image'}
      >
        {cooldown > 0 ? (
          <span className={styles.cooldownText}>{cooldown}</span>
        ) : (
          <span>🎨</span>
        )}
      </button>

      {/* Prompt panel */}
      {isOpen && (
        <div className={styles.aiPanel}>
          <textarea
            className={styles.aiPromptInput}
            placeholder="Describe an image..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value.slice(0, 200))}
            onKeyDown={handleKeyDown}
            maxLength={200}
            autoFocus
            disabled={generating}
          />
          {error && <div className={styles.errorText}>{error}</div>}
          <div className={styles.aiActions}>
            <span className={styles.charCount}>{prompt.length}/200</span>
            {generating ? (
              <div className={styles.generating}>
                <div className={styles.spinner} />
                Generating...
              </div>
            ) : (
              <button
                className={styles.generateBtn}
                onClick={handleGenerate}
                disabled={!prompt.trim() || cooldown > 0}
              >
                Generate
              </button>
            )}
          </div>
          <div className={styles.aiAttribution}>Powered by FLUX</div>
        </div>
      )}

      {/* Flying AI images across the screen */}
      {flyingImages.map((img) => (
        <div
          key={img.id}
          className={`${styles.flyingAiImage} ${img.direction === 'ltr' ? styles.flyLTR : styles.flyRTL}`}
          style={{ top: `${img.top}%` }}
          onAnimationEnd={() => removeFlyingImage(img.id)}
        >
          <img src={img.url} alt="AI Generated" className={styles.flyingAiImg} />
          <span className={styles.flyingAiName}>{img.nickname}</span>
        </div>
      ))}
    </>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add client/src/components/AiImageOverlay.jsx
git commit -m "feat: add AiImageOverlay component with prompt panel and flying animation"
```

---

### Task 5: Integrate into EmoteOverlay with Mutual Exclusivity

**Files:**
- Modify: `client/src/components/EmoteOverlay.jsx`

- [ ] **Step 1: Add import for AiImageOverlay**

At the top of `client/src/components/EmoteOverlay.jsx`, after the GifOverlay import (line 5), add:

```js
import AiImageOverlay from './AiImageOverlay.jsx';
```

- [ ] **Step 2: Add aiOpen state**

Inside the component, after the `gifOpen` state declaration (line 17), add:

```js
const [aiOpen, setAiOpen] = useState(false);
```

- [ ] **Step 3: Update toggleEmoteMenu to close AI panel**

Replace the existing `toggleEmoteMenu` function:

```js
  function toggleEmoteMenu() {
    setMenuOpen((o) => !o);
    setGifOpen(false);
    setAiOpen(false);
    playSound('menuOpen');
  }
```

- [ ] **Step 4: Update toggleGifPanel to close AI panel**

Replace the existing `toggleGifPanel` function:

```js
  function toggleGifPanel() {
    setGifOpen((o) => !o);
    setMenuOpen(false);
    setAiOpen(false);
    playSound('menuOpen');
  }
```

- [ ] **Step 5: Add toggleAiPanel function**

After `toggleGifPanel`, add:

```js
  function toggleAiPanel() {
    setAiOpen((o) => !o);
    setMenuOpen(false);
    setGifOpen(false);
    playSound('menuOpen');
  }
```

- [ ] **Step 6: Render AiImageOverlay in JSX**

In the return JSX, after the `<GifOverlay ... />` block and before the floating emojis comment, add:

```jsx
      {/* AI Image overlay (button + panel + flying images) */}
      <AiImageOverlay
        isOpen={aiOpen}
        onToggle={toggleAiPanel}
        onRequestClose={() => setAiOpen(false)}
      />
```

- [ ] **Step 7: Verify client builds without errors**

```bash
cd client && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 8: Commit**

```bash
git add client/src/components/EmoteOverlay.jsx
git commit -m "feat: integrate AI image overlay with mutual exclusivity"
```

---

### Task 6: Manual Integration Test

- [ ] **Step 1: Add HF_TOKEN to server .env (optional but recommended)**

If not already present, add to `server/.env`:

```
HF_TOKEN=hf_your_free_token_here
```

Get a free token from https://huggingface.co/settings/tokens. This is optional — the feature works without it but may hit rate limits faster.

- [ ] **Step 2: Start server and client**

```bash
cd server && npm run dev &
cd client && npm run dev
```

- [ ] **Step 3: Test the feature**

1. Open the game in browser, join a lobby
2. Verify the 🎨 button appears above the GIF button (bottom-right)
3. Click 🎨 — prompt panel opens, GIF/emote menus close
4. Click GIF — GIF panel opens, AI panel closes
5. Type a prompt (e.g. "a cute red panda"), hit Generate
6. Verify spinner appears with "Generating..."
7. Close the panel while generating — reopen to see spinner still going
8. After 10-30s, verify the image flies across the screen
9. Verify 30s cooldown countdown appears on the button
10. Test error case: disconnect server during generation, verify error message appears

- [ ] **Step 4: Final commit with version bump confirmation**

```bash
git add -A
git commit -m "feat: AI image generation overlay with HF Spaces FLUX.1-schnell (v1.6.0)"
```
