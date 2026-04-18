# Tab Out Multiple Accent Colors Implementation Plan

## Objective
Enhance the Accent Color setting by providing a palette of 10 predefined, visually appealing colors, while still retaining a custom color picker option. This replaces the single color input with an intuitive, clickable swatch grid.

## Key Files & Context
- `extension/index.html`: Replace the current `.color-picker-wrapper` for Accent Color with a new `.color-palette` container holding 10 `<button class="color-swatch">` elements and a styled `.custom-color-wrapper` holding the actual `<input type="color">`.
- `extension/style.css`: Add styling for `.color-palette`, `.color-swatch`, and `.custom-color-wrapper`. The swatches will be circular with a border/box-shadow "active" state indicator when selected.
- `extension/app.js`: 
  - Update `applySettings()` to loop through the `.color-swatch` elements. If the active `accentColor` matches a swatch, mark it active. If it doesn't match any swatch, mark the custom color wrapper as active.
  - Update click listeners to capture clicks on `.color-swatch` buttons and save the selected color to `chrome.storage.local`.

## Implementation Steps

### 1. Update HTML (`extension/index.html`)
- In the "Accent Color" `.settings-group`, replace the contents with:
  ```html
  <div class="color-palette" id="accentPalette">
    <button class="color-swatch" data-color="#c8713a" style="background: #c8713a;" title="Amber"></button>
    <button class="color-swatch" data-color="#5a7a62" style="background: #5a7a62;" title="Sage"></button>
    <button class="color-swatch" data-color="#5a6b7a" style="background: #5a6b7a;" title="Slate"></button>
    <button class="color-swatch" data-color="#b35a5a" style="background: #b35a5a;" title="Rose"></button>
    <button class="color-swatch" data-color="#eab308" style="background: #eab308;" title="Gold"></button>
    <button class="color-swatch" data-color="#3b82f6" style="background: #3b82f6;" title="Blue"></button>
    <button class="color-swatch" data-color="#8b5cf6" style="background: #8b5cf6;" title="Violet"></button>
    <button class="color-swatch" data-color="#ec4899" style="background: #ec4899;" title="Pink"></button>
    <button class="color-swatch" data-color="#14b8a6" style="background: #14b8a6;" title="Teal"></button>
    <button class="color-swatch" data-color="#22c55e" style="background: #22c55e;" title="Green"></button>
    
    <div class="custom-color-wrapper" id="customAccentWrapper" title="Custom Color">
      <input type="color" id="accentColorPicker" value="#c8713a">
    </div>
  </div>
  ```

### 2. Update CSS (`extension/style.css`)
- Add `.color-palette`, `.color-swatch`, and `.custom-color-wrapper` classes.
- Ensure `.color-swatch` and `.custom-color-wrapper` are round (e.g., 24px/28px) with hover effects (scaling up slightly).
- Add `.active` states that apply a double box-shadow (e.g., `0 0 0 2px var(--paper), 0 0 0 4px var(--ink)`) to highlight the selected color.
- Remove the old styling for `#accentColorPicker` and replace it with absolute positioning to hide browser default UI inside `.custom-color-wrapper`.

### 3. Update JavaScript (`extension/app.js`)
- **applySettings**: 
  - Compare `accentColor` (lowercase) against the `data-color` of all swatches.
  - If a match is found, add `.active` to the matching swatch and remove `.active` from the custom wrapper.
  - If no match is found, remove `.active` from all swatches and add `.active` to the custom wrapper. Update the `<input type="color">` value.
- **Listeners**:
  - In the document `click` listener, check if `e.target.closest('.color-swatch')`. If so, set `chrome.storage.local.set({ accentColor: e.target.dataset.color })`.
  - The `input` listener for `accentColorPicker` remains mostly the same, but it naturally selects the custom color when used.

## Verification
- Open Settings. Verify 10 distinct color circles and 1 custom color circle are present.
- Click a predefined color. The active ring should highlight the selected color. The app's accent color (confetti, hover states) should change immediately.
- Use the custom color picker. The active ring should move to the custom wrapper, and the selected color should apply immediately.