# Tab Out Settings Menu Implementation Plan

## Objective
Add a settings menu to customize the "Tab Out" extension's look and feel directly within the dashboard. The user will be able to customize the theme (light/dark/system), accent color, and layout density. These preferences will be saved via `chrome.storage.local` and applied dynamically.

## Key Files & Context
- `extension/manifest.json`: Register `options_ui` so right-clicking the extension icon can open the settings.
- `extension/index.html`: Add the "Settings" gear icon to the top right of the header and the modal dialog markup.
- `extension/style.css`: Define CSS variables for dark mode, layout densities, and modal styling. Add CSS variables for the accent color.
- `extension/app.js`: Add logic to open/close the modal, read/write settings to `chrome.storage.local`, and listen to `chrome.storage.onChanged` to instantly update the UI.

## Implementation Steps

### 1. Update Manifest
- Modify `extension/manifest.json` to include `"options_page": "index.html#settings"`. The "storage" permission is already present. 

### 2. Update HTML (`extension/index.html`)
- Add a settings gear icon ⚙️ in the `<header>` element (on the right side).
- Add a hidden settings modal overlay `<div>` containing:
  - **Theme Toggle**: Radio buttons or a `<select>` for Light, Dark, and System Default.
  - **Accent Color Picker**: An `<input type="color">` or a set of predefined color swatches. This will override the `--accent-amber` (used for confetti, active states, etc.).
  - **Layout Density**: Radio buttons or `<select>` for "Compact" vs. "Comfortable" spacing.
- Add a close button for the modal.

### 3. Update Styles (`extension/style.css`)
- **Themes**: Add a `[data-theme="dark"]` attribute selector to redefine root color variables (`--paper`, `--ink`, `--card-bg`, etc.). Add a `[data-theme="light"]` (explicit light). Also rely on `@media (prefers-color-scheme: dark)` if `data-theme="system"` is set.
- **Density**: Add a `[data-density="compact"]` selector to reduce padding in `.mission-card`, `.container`, and `.page-chip`.
- **Modal Styling**: Add styles for the settings modal overlay (`position: fixed`, `z-index: 1000`, `backdrop-filter: blur`, etc.).

### 4. Update JavaScript (`extension/app.js`)
- **Initialization**: Read `theme`, `accentColor`, and `density` from `chrome.storage.local` when the script loads. Apply them by setting `data-*` attributes on `document.documentElement` and inline CSS variables for the accent color.
- **Listeners**:
  - Add a click listener to open the settings modal.
  - Add change listeners to the settings inputs to write new values to `chrome.storage.local`.
- **State Management**: Add a `chrome.storage.onChanged` listener to instantly apply changes when a setting is updated (this ensures sync across multiple new tabs without refreshing).
- **Confetti Updates**: Modify `shootConfetti` to use the new dynamic accent color, or a palette including the custom color.

## Verification & Testing
- Open the extension's new tab page.
- Click the gear icon to open settings.
- Change the theme and verify the background/text colors update immediately.
- Change the accent color and close a tab to verify the confetti and hover states match the new color.
- Change layout density and verify the grid padding adjusts instantly.
- Refresh the page and ensure all settings persist correctly.