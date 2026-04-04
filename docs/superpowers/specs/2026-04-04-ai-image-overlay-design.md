# AI Image Overlay — Design Spec

## Overview

Add an AI image generation button (paintbrush icon) above the existing GIF button. Players type a prompt, the server generates an image via Hugging Face Spaces (FLUX.1-schnell), and the resulting image flies across all players' screens — same animation as GIF reactions.

## Architecture

Server-authoritative proxy, matching the GIF system pattern:

1. Client sends prompt text via socket event `AI_IMAGE_SEND`
2. Server validates, rate-limits (30s cooldown per player)
3. Server calls HF Spaces Gradio REST API (`evalstate/flux1_schnell`)
4. Server receives generated image, converts to base64 data URL
5. Server broadcasts to entire lobby via `AI_IMAGE_BROADCAST`
6. All clients render the flying image animation

No API details or tokens exposed to clients.

## Socket Events

| Event | Direction | Payload |
|-------|-----------|---------|
| `AI_IMAGE_SEND` | client → server | `{ prompt: string }` |
| `AI_IMAGE_BROADCAST` | server → all in lobby | `{ imageUrl: string (base64 data URL), nickname: string }` |
| `AI_IMAGE_ERROR` | server → requesting client | `{ error: string }` |

Add to `shared/events.js`:
```js
AI_IMAGE_SEND: 'ai-image:send',
AI_IMAGE_BROADCAST: 'ai-image:broadcast',
AI_IMAGE_ERROR: 'ai-image:error',
```

## Server Side

### HF Spaces Integration

- Space: `evalstate/flux1_schnell` (FLUX.1-schnell model)
- Endpoint: Gradio queue API — POST to `https://evalstate-flux1-schnell.hf.space/call/flux1_schnell_infer` to enqueue, then GET `/call/flux1_schnell_infer/{event_id}` to poll for result (SSE stream)
- Parameters: `{ data: [prompt, 0, true, 512, 512, 4] }` (prompt, seed, randomize_seed, width, height, steps)
- Response: SSE stream ending with `event: complete` containing base64 image file path, which is then fetched via the Space's `/file=` endpoint
- Optional `HF_TOKEN` env var for better rate-limit priority (free account token)

### Rate Limiting & Validation

- 30-second cooldown per player, tracked via `socket.data._lastAiImage`
- Prompt: max 200 characters, must be a non-empty string
- Cooldown displayed client-side as red countdown (same pattern as GIF button)

### Error Handling

- If HF Space is down, queued too long, or returns error: emit `AI_IMAGE_ERROR` to requesting socket only
- Timeout: 60 seconds max wait for generation
- Error message: brief human-readable string (e.g., "Image generation failed, try again later")

## Client Side

### New Component: `AiImageOverlay.jsx` + `AiImageOverlay.module.css`

Rendered inside `EmoteOverlay` as a sibling to `GifOverlay`, sharing the same coordination pattern.

### Button

- Icon: paintbrush emoji or "AI" text label (matching GIF button style)
- Size: 44px circle
- Position: `bottom: calc(1rem + 52px); right: 1rem` (directly above GIF button)
- Styling: same as GIF button (gold border, dark panel background, theme vars)
- Z-index: 102 (same layer as GIF/emote buttons)
- Cooldown display: red countdown number replacing icon, same as GIF button

### Panel

- Position: above the AI button, right-aligned
- Width: 300px, similar styling to GIF search panel
- Contents:
  - Text input (placeholder: "Describe an image...")
  - "Generate" button → becomes spinner + "Generating..." while in progress
  - Small attribution text: "Powered by FLUX"
- Z-index: 103 (same as GIF panel)

### Panel Behavior During Generation

- User submits prompt → Generate button shows spinner
- User can **close panel freely** — generation continues server-side
- Reopening panel while generating shows the spinner state
- On success: image flies across screen, panel resets to idle
- On error: panel shows brief error message (clears after 10s or on next open)
- 30s cooldown prevents re-submitting while generation is in flight

### Mutual Exclusivity

- Opening AI panel closes GIF panel and emote menu
- Opening GIF panel or emote menu closes AI panel
- Same coordination pattern already used between GIF and emote panels

### Flying Animation

Reuses the exact same CSS animation as GIF flying:
- Random direction: LTR or RTL (50/50)
- Random vertical position: 15-65% from top
- Duration: 3.5 seconds
- Sender nickname displayed below image (gold text on dark background)
- Max size: 180px height x 240px width
- Border: 2px gold with shadow

The flying image array and animation cleanup is shared with or mirrors the GIF flying logic in `GifOverlay`.

## Files to Create/Modify

### New Files
- `client/src/components/AiImageOverlay.jsx`
- `client/src/components/AiImageOverlay.module.css`

### Modified Files
- `shared/events.js` — add 3 new events
- `shared/version.js` — bump version
- `server/src/index.js` — add AI image socket handler + HF API call
- `client/src/components/EmoteOverlay.jsx` — render AiImageOverlay, add mutual exclusivity state
- `client/src/components/EmoteOverlay.module.css` — adjust if needed for button stacking
- `client/src/components/GifOverlay.jsx` — accept callback to close AI panel when GIF panel opens

## Environment Variables

- `HF_TOKEN` (optional) — free Hugging Face API token for better rate-limit priority
- Added to `server/.env` locally, Render env vars in production

## Cost & Limits

- Free tier: no monthly credit cap (Spaces Gradio API is free for callers)
- Rate limited by IP on HF side + 30s cooldown on our side
- Best-effort: no uptime SLA, queue-dependent latency (10-30s typical)
- 512x512 resolution keeps payload size reasonable (~50-150KB base64)
