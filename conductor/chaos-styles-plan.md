# Tab Out Chaos Layout, Patterns, and Card Styles

## Objective
1. **Fix Background Upload**: Resolve the Manifest V3 CSP issue blocking the inline `onclick` handler for the background image upload button.
2. **Background Patterns**: Add built-in background pattern options (Grid, Dots, Waves, Blueprint) alongside custom image upload.
3. **Layout Modes**: Add a "Structured" (color-coded, organized) and "Chaos" (scattered, rotated, messy desk) layout mode.
4. **6 New Card Styles**: Add Glassmorphism, Neo-Brutalism, Terminal, Polaroid, Receipt, and Cyberpunk.

## Key Files & Context
- `extension/index.html`: Remove inline `onclick` from the background upload button and give it an ID. Add dropdowns/buttons for Layout Mode, new Card Styles, and Background Patterns.
- `extension/style.css`:
  - Add CSS definitions for the 6 new `[data-card-style="..."]` attributes.
  - Define CSS patterns for the `--bg-image` when a built-in pattern is selected.
  - Add styling rules for `[data-layout-mode="chaos"]` (animations, transitions, overlap allowances) and `[data-layout-mode="structured"]`.
- `extension/app.js`:
  - Add a proper event listener for the upload button to fix the CSP block.
  - Add JS logic to assign random CSS variables (e.g., `--chaos-rotate`, `--chaos-x`, `--chaos-y`) to each `.mission-card` during render if the layout mode is "Chaos".
  - Add JS logic to generate a unique `--domain-color` from the domain string if the layout mode is "Structured", allowing cards to be color-coded automatically.
  - Store `backgroundType` (none/custom/grid/dots/waves/blueprint) and `layoutMode` (default/structured/chaos) in `chrome.storage.local`.

## Implementation Steps

### 1. Fix Background Upload & Add Patterns
- **HTML**: Change `<button onclick="...">` to `<button id="uploadBgBtn">`. Add a `<select id="bgTypeSelect">` or buttons for the background types.
- **JS**: In `initSettings` or global listeners, add `document.getElementById('uploadBgBtn').addEventListener('click', () => document.getElementById('bgImageInput').click());`. Update `applySettings` to handle `bgType`.
- **CSS Patterns**:
  - Grid: `linear-gradient`, `background-size: 20px 20px`.
  - Dots: `radial-gradient`.
  - Blueprint: Blue background with white grid and faint drafting lines.
  - Waves: Repeating linear gradients or SVGs.

### 2. Layout Modes (Structured vs. Chaos)
- **JS Render Update**: In `renderDomainCard(group)`, determine the layout mode.
  - If `structured`: Hash the `group.domain` to pick an HSL color, e.g., `hsl(hash % 360, 70%, 85%)`. Set it as `style="--domain-color: ..."` on the card.
  - If `chaos`: Generate random floats for rotation (-10 to 10 deg) and translation (-15px to 15px). Set them as `style="--chaos-rotate: ...; --chaos-x: ...; --chaos-y: ...;"`.
- **CSS Update**:
  - `[data-layout-mode="structured"] .mission-card`: Use `var(--domain-color)` for borders, top bars, or backgrounds.
  - `[data-layout-mode="chaos"] .mission-card`: Apply `transform: translate(var(--chaos-x), var(--chaos-y)) rotate(var(--chaos-rotate)); z-index: random;` and disable strict column breaks to allow overlapping.

### 3. 6 New Card Styles
Add CSS classes in `style.css` for:
- `[data-card-style="glass"]`: `background: rgba(255,255,255,0.05); backdrop-filter: blur(16px); border: 1px solid rgba(255,255,255,0.2); color: #fff;`
- `[data-card-style="brutalism"]`: `border: 3px solid #000; box-shadow: 6px 6px 0 #000; background: #fff; border-radius: 0;`
- `[data-card-style="terminal"]`: `background: #0c0c0c; color: #0f0; font-family: monospace; border: 1px solid #0f0; border-radius: 0;`
- `[data-card-style="polaroid"]`: `background: #fff; padding: 10px 10px 40px 10px; box-shadow: 0 4px 6px rgba(0,0,0,0.3); border: 1px solid #ddd;`
- `[data-card-style="receipt"]`: `background: #fffbfa; font-family: monospace; border-top: 4px dashed #ddd; border-bottom: 4px dashed #ddd; border-left: none; border-right: none; border-radius: 0; color: #333;`
- `[data-card-style="cyberpunk"]`: `background: #050505; border: 1px solid #f0f; box-shadow: 0 0 10px #f0f, inset 0 0 10px #f0f; color: #0ff; font-family: monospace; text-shadow: 0 0 5px #0ff;`

### 4. Settings UI Update
- Add `<select>` or radio buttons for the new Layout Mode and Card Styles in the Settings Modal. Make sure `DEFAULT_SETTINGS` covers `layoutMode`.

## Verification
- Test clicking "Upload Background" to ensure it opens the file picker (verifying the CSP fix).
- Toggle between built-in background patterns and confirm they render correctly.
- Switch Layout Mode to "Chaos" and observe cards scattered across the dashboard.
- Switch Layout Mode to "Structured" and observe domain-based color coding.
- Cycle through all 6 new card styles and verify CSS rendering matches the descriptions.