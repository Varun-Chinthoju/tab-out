# Tab Out Freeform Dragging and Sticky Updates

## Objective
1. **Freeform Dragging (Absolute Positioning)**: Convert the "Chaos" layout mode (or rename it to "Freeform") into a true canvas where cards can be dragged and dropped anywhere on the screen. Their `x`, `y`, and `z` coordinates will be saved to `chrome.storage.local`.
2. **Sticky Note Enhancements**:
   - Update `[data-card-style="sticky"]` to use the handwritten font (`Caveat`).
   - Add a curved/organic style using CSS border-radius and box-shadow tweaks to make them look like real curling paper.
   - Ensure stickies can overlap beautifully (transparent/soft shadows).

## Key Files & Context
- `extension/index.html`: Update the "Chaos" label to "Freeform Canvas" (or similar) to reflect the new behavior.
- `extension/style.css`:
  - Update `[data-layout-mode="chaos"]` (or freeform) to use `position: absolute` for `.mission-card` elements, allowing them to break out of the `.missions` grid.
  - Ensure the `.container` or `body` can act as a full-height drop zone.
  - Update the Sticky card style to include `font-family: 'Caveat', cursive; font-size: 1.15em;`, and a curved border-radius (e.g., `border-bottom-right-radius: 60px 5px; border-bottom-left-radius: 5px 20px;`).
- `extension/app.js`:
  - **State**: Add `cardPositions: {}` to `DEFAULT_SETTINGS`.
  - **Render**: If in "chaos" mode, apply `left: ${x}px; top: ${y}px; z-index: ${z}; position: absolute;` directly to the card.
  - **Drag Start**: Calculate the offset of the mouse click relative to the top-left of the card: `offsetX = e.clientX - rect.left`, `offsetY = e.clientY - rect.top`. Store this in `e.dataTransfer`.
  - **Drag Over**: Ensure the `document` allows dropping anywhere by preventing default.
  - **Drop**: If dragging a card in "chaos" mode, calculate `newX = e.clientX - offsetX` and `newY = e.clientY - offsetY`. Update the DOM element's inline style, bring the card to the front (highest z-index), and save the new positions dictionary to `chrome.storage.local`.

## Implementation Steps

### 1. Update HTML
- Change the `data-layout="chaos"` button text to "Freeform".

### 2. Update CSS (`extension/style.css`)
- **Sticky Note**: Add `font-family: 'Caveat', cursive;` to `.mission-card` and its text elements when `data-card-style="sticky"`. Add a subtle curve: `border-radius: 255px 15px 225px 15px/15px 225px 15px 255px;` (or similar curling effect) and a peeling shadow.
- **Layout Mode "Chaos"**:
  - `[data-layout-mode="chaos"] .missions` should have `position: relative; min-height: calc(100vh - 200px);`.
  - `[data-layout-mode="chaos"] .mission-card` gets `position: absolute; margin: 0; width: 260px; transition: transform 0.1s;` (remove the `transform: translate` used previously, rely on `left`/`top`).

### 3. Update JavaScript (`extension/app.js`)
- Add `cardPositions: {}` to settings.
- In `renderDomainCard`:
  - If `layoutMode === 'chaos'`, lookup `cardPositions[stableId]`. If it exists, use its `x`, `y`, `z`. If not, generate a random starting `x` and `y` within reasonable bounds.
  - Render with `style="left: ${x}px; top: ${y}px; z-index: ${z}; position: absolute;"`.
- In `dragstart` listener:
  - If dragging a card, calculate the offset from the mouse to the card's top-left corner.
  - Serialize this offset into the `dataTransfer` payload: `card:domainId:offsetX:offsetY`.
- In `drop` listener:
  - If the payload is a card and the layout is 'chaos':
    - Extract `id`, `offsetX`, `offsetY`.
    - Calculate new coordinates based on the drop event's `clientX`/`clientY` and the offsets.
    - Find the highest `z-index` currently in use, add 1, assign to this card.
    - Save `{x, y, z}` to the `cardPositions` dictionary in storage.
  - (If layout is NOT chaos, keep the grid-reordering logic from before).

## Verification
- Switch to "Freeform" layout mode. Verify cards detach from the grid and become absolute.
- Drag a card and drop it anywhere on the screen. Verify it stays exactly where dropped.
- Click/drag another card over the first one. Verify the newly dragged card comes to the front (highest z-index).
- Refresh the page to ensure the absolute positions and z-indexes persist.
- Switch to Sticky style. Verify the handwritten font is used and the card has a curved/organic paper feel.