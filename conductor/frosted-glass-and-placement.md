# Frosted Glass Background & Smart Card Placement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a large frosted glass rectangle behind all dashboard content and implement a smart, non-overlapping random placement algorithm for new cards in Chaos mode.

**Architecture:** 
1.  **Visuals**: Add a `.glass-board` element to the main container with `backdrop-filter: blur` and a translucent white/dark background.
2.  **Logic**: Update the Chaos mode placement algorithm to scan for unoccupied space when a card has no saved position.
3.  **Persistence**: Ensure that once a "smart" position is picked, it is saved to `chrome.storage` to prevent cards from jumping on refresh.

**Tech Stack:** HTML5, CSS3 (Backdrop Filter), JavaScript (Chrome Extension API)

---

### Task 1: Add the Frosted Glass Board

**Files:**
- Modify: `extension/index.html`
- Modify: `extension/style.css`

- [ ] **Step 1: Add the `.glass-board` element to `index.html`**

Add it as the first child of `.container` so it stays behind all other content.

```html
<!-- extension/index.html -->
<div class="container">
  <div class="glass-board"></div>
  <header>
    ...
```

- [ ] **Step 2: Define `.glass-board` styles in `style.css`**

Add styles to create the frosted glass effect. It should cover the whole container area.

```css
/* extension/style.css */
.glass-board {
  position: absolute;
  inset: 12px; /* Small margin from the very edge of the container */
  background: rgba(255, 255, 255, 0.05); /* Very light translucent white */
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
  border: 1px solid rgba(255, 255, 255, 0.1);
  border-radius: 24px;
  z-index: -1; /* Behind the text and cards, but above body::after */
  pointer-events: none; /* Don't block clicks to cards/header */
}

/* Dark mode adjustment */
[data-theme="dark"] .glass-board {
  background: rgba(0, 0, 0, 0.2);
  border: 1px solid rgba(255, 255, 255, 0.05);
}
```

- [ ] **Step 3: Commit UI changes**

```bash
git add extension/index.html extension/style.css
git commit -m "feat: add frosted glass board background"
```

---

### Task 2: Implement Smart Placement Logic in `app.js`

**Files:**
- Modify: `extension/app.js`

- [ ] **Step 1: Add `findSmartSpot` utility function**

This function will scan the current board and return a spot with minimal overlap.

```javascript
// extension/app.js (Add near findEmptySpot or similar utilities)

/**
 * findSmartSpot(cardWidth, cardHeight, settings)
 * 
 * Generates a random spot and checks for overlaps, retrying to find the clearest space.
 */
function findSmartSpot(cardWidth, cardHeight, settings) {
  const container = document.getElementById('openTabsMissions');
  // Use window dimensions if container isn't ready, but with healthy margins
  const boardWidth = container ? container.offsetWidth : window.innerWidth - 120;
  const boardHeight = window.innerHeight - 250;

  const maxX = Math.max(boardWidth - cardWidth, 100);
  const maxY = Math.max(boardHeight - cardHeight, 100);

  // Get existing card rects to avoid
  const existingRects = [...document.querySelectorAll('.mission-card')].map(el => ({
    x: el.offsetLeft,
    y: el.offsetTop,
    w: el.offsetWidth,
    h: el.offsetHeight
  }));

  let bestSpot = { x: 40, y: 150 };
  let minOverlap = Infinity;

  // Try 25 random samples to find the best one
  for (let i = 0; i < 25; i++) {
    const x = 40 + Math.random() * (maxX - 40);
    const y = 150 + Math.random() * (maxY - 150);
    
    let currentOverlap = 0;
    for (const r of existingRects) {
      const overlapX = Math.max(0, Math.min(x + cardWidth, r.x + r.w) - Math.max(x, r.x));
      const overlapY = Math.max(0, Math.min(y + cardHeight, r.y + r.h) - Math.max(y, r.y));
      currentOverlap += overlapX * overlapY;
    }
    
    if (currentOverlap < minOverlap) {
      minOverlap = currentOverlap;
      bestSpot = { x, y };
    }
    
    if (minOverlap === 0) break; // Found perfect spot
  }
  
  return bestSpot;
}
```

- [ ] **Step 2: Update `renderDomainCard` to use smart placement**

Modify the chaos mode logic to call `findSmartSpot` and then *persist* that position to avoid jumping.

```javascript
// extension/app.js inside renderDomainCard()

  if (layoutMode === 'chaos') {
    const pos = settings.cardPositions?.[stableId];
    if (pos) {
      dynamicStyle = `left: ${pos.x}px; top: ${pos.y}px; --chaos-z: ${pos.z || 1};`;
      if (pos.w) dynamicStyle += `width: ${pos.w}px;`;
      if (pos.h) dynamicStyle += `height: ${pos.h}px;`;
    } else {
      // SMART PLACEMENT for new cards
      const cardWidth = settings.cardSize || 260;
      const spot = findSmartSpot(cardWidth, 200, settings);
      
      dynamicStyle = `left: ${spot.x}px; top: ${spot.y}px;`;
      
      // Save it immediately so it doesn't jump on next re-render
      setTimeout(async () => {
        const { cardPositions = {} } = await chrome.storage.local.get('cardPositions');
        if (!cardPositions[stableId]) {
          cardPositions[stableId] = { x: spot.x, y: spot.y, z: 1 };
          await chrome.storage.local.set({ cardPositions });
        }
      }, 0);
    }
  }
```

- [ ] **Step 3: Update `renderNoteCard` similarly**

Ensure new notes also benefit from smart placement.

```javascript
// extension/app.js inside renderNoteCard()

  if (layoutMode === 'chaos') {
    const pos = settings.cardPositions?.[stableId];
    if (pos) {
      dynamicStyle = `left: ${pos.x}px; top: ${pos.y}px; --chaos-z: ${pos.z || 1};`;
      if (pos.w) dynamicStyle += `width: ${pos.w}px;`;
      if (pos.h) dynamicStyle += `height: ${pos.h}px;`;
    } else {
      const spot = findSmartSpot(260, 200, settings);
      dynamicStyle = `left: ${spot.x}px; top: ${spot.y}px;`;
      
      setTimeout(async () => {
        const { cardPositions = {} } = await chrome.storage.local.get('cardPositions');
        if (!cardPositions[stableId]) {
          cardPositions[stableId] = { x: spot.x, y: spot.y, z: 1 };
          await chrome.storage.local.set({ cardPositions });
        }
      }, 0);
    }
  }
```

- [ ] **Step 4: Commit logic changes**

```bash
git add extension/app.js
git commit -m "feat: implement smart non-overlapping card placement for chaos mode"
```

---

### Task 3: Verification

- [ ] **Step 1: Test Glass Board Visuals**
  *   Open the dashboard.
  *   Verify a subtle frosted blur is visible behind all text and cards.
  *   Check in both Light and Dark themes.

- [ ] **Step 2: Test Smart Placement**
  *   Switch to **Chaos/Freeform** layout in Settings.
  *   Open a new tab in a different domain (e.g. `example.com`).
  *   Return to the dashboard.
  *   Verify the new card appears in a relatively empty spot on the glass board.
  *   Open many tabs and verify they try to find gaps rather than stacking all in the center.

- [ ] **Step 3: Test Standard Mode**
  *   Switch back to **Default** layout.
  *   Verify cards are still placed in a clean grid (next available spot).
