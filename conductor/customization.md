# Tab Out Customization Implementation Plan

## Objective
Add two new customization features to the "Tab Out" extension's settings menu:
1. **Background Image Upload**: Allow the user to upload a custom background image. To avoid exceeding the 10MB `chrome.storage.local` quota and prevent new permission warnings, the image will be resized (max 1920x1080) and compressed as a WebP/JPEG using the HTML5 Canvas API before being saved.
2. **Card Styles**: Add options to change the look of the "mission cards" (e.g., Default, Sticky Note, Hand-drawn). This will be achieved via new CSS rules triggered by a `data-card-style` attribute on the `<html>` root.

## Key Files & Context
- `extension/index.html`: Update the settings modal to include a file input for the background image, a "Remove" button, and radio buttons/select for "Card Style". Add an overlay layer so text remains legible over custom backgrounds.
- `extension/style.css`: 
  - Add variables for `--bg-image` and `--bg-overlay` to `:root`.
  - Apply the background image to the `body` or a fixed background `div`. Add an overlay to ensure contrast.
  - Define CSS rules for `[data-card-style="sticky"]` (yellowish post-it look with slight drop shadow and a folded corner) and `[data-card-style="drawn"]` (wobbly/jagged borders).
- `extension/app.js`: 
  - Add logic to read/write `bgImage` and `cardStyle` to `chrome.storage.local`.
  - Add a file `change` listener that loads the selected image into an `Image` object, draws it to a `Canvas` to resize it to a maximum of 1920x1080, and calls `.toDataURL('image/jpeg', 0.8)` to save a compressed string.
  - Apply changes dynamically when `chrome.storage.onChanged` fires.

## Implementation Steps

### 1. Update HTML (`extension/index.html`)
- **Background Upload**: Add a `<div class="settings-group">` with a file input (accept `image/*`) and a "Clear Background" button.
- **Card Style**: Add a `<div class="settings-group">` with options for "Default", "Sticky", and "Hand-drawn".
- **Background Overlay**: Ensure there is a CSS pseudo-element or a background wrapper `div` to hold the image and a slight darkening overlay to keep the white/dark text readable.

### 2. Update Styles (`extension/style.css`)
- **Background**:
  - Add CSS variables: `--bg-image: none;`, `--bg-overlay: transparent;`.
  - Set `body::before` or the main wrapper to render `var(--bg-image)` with `background-size: cover` and `background-attachment: fixed`.
- **Card Styles**:
  - `[data-card-style="sticky"] .mission-card`: Give it a post-it look (`background: #fdf5c9` in light mode, `border: none`, `border-radius: 0`, and a folded corner effect using an `::after` pseudo-element with transparent borders). Remove the colored top bar.
  - `[data-card-style="drawn"] .mission-card`: Use `border-radius: 255px 15px 225px 15px/15px 225px 15px 255px;` for a hand-drawn wavy border. `border: 2px solid var(--ink)`. Remove the colored top bar.

### 3. Update JavaScript (`extension/app.js`)
- **Storage**: Add `bgImage` and `cardStyle` to `DEFAULT_SETTINGS`.
- **Apply Settings**: Update `applySettings()` to set `document.documentElement.setAttribute('data-card-style', cardStyle)` and `document.documentElement.style.setProperty('--bg-image', bgImage ? \`url("\${bgImage}")\` : 'none')`.
- **Upload Logic**:
  - Add an event listener to the file input.
  - Read the file using `FileReader`, load it into an `Image`.
  - Draw to a `<canvas>` scaling down if the width or height exceeds 1920px.
  - Save the resulting base64 string to `chrome.storage.local` under the key `bgImage`.
- **Clear Logic**: Remove `bgImage` from storage when the user clicks "Clear Background".
- **Style Listener**: Add click listeners for the Card Style options to update `chrome.storage.local`.

## Verification & Testing
- Open the settings modal.
- Upload a large image and verify it is resized/compressed and applied to the background immediately.
- Test the "Clear" button.
- Toggle between Card Styles and observe the `.mission-card` elements changing instantly.
- Refresh the page to verify preferences persist.