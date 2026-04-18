# Tab Out Sticky and Hand-drawn Customizations & Fixes

## Objective
1. **Fix Background Upload**: The background upload feature occasionally fails because large images exceed the 5MB `chrome.storage.local` quota limit. We will add the `unlimitedStorage` permission and ensure the file input is reset after upload.
2. **Sticky Variations & Text Color**: Add multiple sticky note color variations and allow the user to select a custom text color specifically for sticky notes.
3. **Hand-drawn Variations**: Add a custom handwriting font for the hand-drawn style and introduce subtle randomized skews to make the cards look truly hand-drawn.

## Key Files & Context
- `extension/manifest.json`: Add `unlimitedStorage` to permissions to allow large background images.
- `extension/index.html`: Update Google Fonts to include `Caveat` (a handwriting font). Add a new settings control for "Sticky Text Color".
- `extension/style.css`:
  - Define `--sticky-text` root variable.
  - Add 3 distinct sticky colors (yellow, pink, blue) using `:nth-child` logic to give variety. Add corresponding dark mode colors.
  - Update `[data-card-style="drawn"] .mission-card` to use the `Caveat` font, increase font sizes slightly to compensate, and add randomized-looking skews and border radii via `:nth-child(even)` / `:nth-child(odd)` for a true hand-drawn feel.
- `extension/app.js`: 
  - Add logic to store and apply `stickyTextColor`.
  - Fix background input handling by clearing the value after read.

## Implementation Steps

### 1. Fix Background Upload
- **Manifest**: In `extension/manifest.json`, add `"unlimitedStorage"` to the `"permissions"` array.
- **App.js**: In the `change` listener for `bgImageInput`, add `e.target.value = '';` at the end to ensure selecting the same file twice triggers the event. Let's also add a UI toast indicating success or failure.

### 2. Update HTML (`extension/index.html`)
- **Fonts**: Append `&family=Caveat:wght@400;500;600;700` to the Google Fonts link.
- **Settings Modal**: Add a new settings group for "Sticky Text Color" with an `<input type="color" id="stickyTextColorPicker" value="#1a1613">`.

### 3. Update Styles (`extension/style.css`)
- **Variables**: Add `--sticky-text: #1a1613;` to `:root`. For `[data-theme="dark"]`, set `--sticky-text: #f8f5f0;`.
- **Sticky Variations**:
  - `[data-card-style="sticky"] .mission-card:nth-child(3n+1)` (Yellow: `#fdf5c9` / Dark: `#4a452a`)
  - `[data-card-style="sticky"] .mission-card:nth-child(3n+2)` (Soft Pink: `#fce7f3` / Dark: `#503140`)
  - `[data-card-style="sticky"] .mission-card:nth-child(3n+3)` (Soft Blue: `#e0f2fe` / Dark: `#2b3e5a`)
  - Apply `color: var(--sticky-text)` to `.mission-card`, `.mission-name`, `.chip-text`, `.section-header h2` inside `[data-card-style="sticky"]`.
- **Drawn Variations**:
  - Apply `font-family: 'Caveat', cursive;` and `font-size: 110%;` to `.mission-card`, `.mission-name`, `.chip-text`, `.action-btn` when `[data-card-style="drawn"]`.
  - Add varying border radii and rotations using `:nth-child(2n)` vs `:nth-child(2n+1)`.
  - e.g., `:nth-child(2n)`: `transform: rotate(-1deg); border-radius: 255px 15px 225px 15px/15px 225px 15px 255px;`
  - e.g., `:nth-child(2n+1)`: `transform: rotate(1deg); border-radius: 15px 255px 15px 225px/255px 15px 225px 15px;`

### 4. Update JavaScript (`extension/app.js`)
- Add `stickyTextColor` (default `#1a1613`) to `DEFAULT_SETTINGS`.
- Update `applySettings()` to apply `document.documentElement.style.setProperty('--sticky-text', stickyTextColor);` and update the picker display.
- Add an `input` event listener for the new `stickyTextColorPicker` to save to `chrome.storage.local`.

## Verification
- Select a background image. It should now upload successfully without quota errors.
- Select the Sticky Note style. Observe 3 different background colors cycling through the grid.
- Change the Sticky Text Color in settings. Verify the text inside the stickies updates immediately.
- Select the Hand-drawn style. Verify the font changes to Caveat and the cards have varied, slightly skewed borders and rotations.