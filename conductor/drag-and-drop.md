# Tab Out Drag and Drop Implementation Plan

## Objective
Implement drag-and-drop functionality to allow users to reorder the main domain cards and the individual tabs within those cards. 
- **Card Reordering**: Users can drag the large `.mission-card` elements to reorder domains. This order will be saved to `chrome.storage.local` so it persists across refreshes.
- **Tab Reordering**: Users can drag `.page-chip` elements within a card. Dropping a tab will physically move the tab in the Chrome browser using `chrome.tabs.move()`, keeping the visual dashboard perfectly in sync with the actual browser state.

## Key Files & Context
- `extension/style.css`: Add styles for draggable elements, including visual feedback for the dragged item (`opacity`, `cursor: grab`, `cursor: grabbing`) and drop targets (e.g., a bottom border or background highlight when hovering over a valid drop zone).
- `extension/app.js`: 
  - Add HTML5 Drag and Drop attributes (`draggable="true"`) to cards and tabs during render.
  - Implement event listeners for `dragstart`, `dragover`, `dragenter`, `dragleave`, `drop`, and `dragend`.
  - **Cards**: Save custom domain ordering to `chrome.storage.local` and use it to sort `domainGroups` before rendering.
  - **Tabs**: Call `chrome.tabs.move(tabId, { index: newIndex })` when a tab is dropped in a new position, then re-render.

## Implementation Steps

### 1. Update Styles (`extension/style.css`)
- Add a `.draggable` class with `cursor: grab`.
- Add an `.is-dragging` class (opacity 0.5, `cursor: grabbing`).
- Add a `.drag-over-card` class (highlighting the card or showing a gap where the card will drop).
- Add a `.drag-over-tab` class (highlighting the tab or showing a top/bottom border where the tab will drop).
- Add a visual grab handle (optional, or just make the whole card header/tab draggable).

### 2. Update HTML Generation (`extension/app.js`)
- In `renderDomainCard`, add `draggable="true"` to the `.mission-card` wrapper. Ensure `data-domain-id` is present.
- In the `pageChips` mapping, add `draggable="true"` to `.page-chip` and add a `data-tab-id="${tab.id}"` attribute to identify which Chrome tab is being moved.

### 3. State Management for Card Order
- Add `domainOrder: []` to `DEFAULT_SETTINGS`.
- When rendering the dashboard, after sorting the `domainGroups` by their default logic, sort them again based on `settings.domainOrder` if it exists.
- When a card is dropped, calculate the new order by mapping the `data-domain-id` of all `.mission-card` elements in the DOM, then save this array to `chrome.storage.local`.

### 4. Implement Drag and Drop Listeners (`extension/app.js`)
- **Drag Start**: 
  - Determine if a card or tab is being dragged. 
  - Set `e.dataTransfer.setData('text/plain', type + ':' + id)` (e.g., `card:domain-github` or `tab:123`).
  - Add `.is-dragging` class to the target.
- **Drag Over**: 
  - Prevent default behavior to allow dropping.
  - Add visual indicators (`.drag-over-card` or `.drag-over-tab`) based on where the mouse is relative to the target's bounding box.
- **Drop**:
  - Prevent default.
  - Extract the dragged type and ID.
  - If a **card** is dropped on another card: Reorder the DOM nodes, rebuild the `domainOrder` array, and save to storage.
  - If a **tab** is dropped on another tab: Identify the target tab's Chrome `id` and `windowId`. Call `chrome.tabs.move(draggedTabId, { index: targetTabIndex, windowId: targetWindowId })`. Re-fetch tabs and re-render to ensure consistency.
- **Drag End**: Remove all dragging and drop-target indicator classes.

## Verification & Testing
- Drag a domain card and drop it before another card. Verify the order changes and persists on refresh.
- Drag a tab within a card and drop it above another tab. Verify the visual order updates and the actual Chrome tab shifts its position in the browser tab strip.
- Ensure dragging a tab between *different* cards (windows) also works by passing the correct `windowId` and `index`.