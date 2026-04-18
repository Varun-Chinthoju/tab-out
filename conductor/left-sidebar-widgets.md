# Add Left Sidebar and Templates/Widgets System

This plan outlines the addition of a left sidebar to the Tab Out dashboard and a background service worker to support persistent timers. This introduces a new "Templates/Widgets" system allowing users to arrange interactive modules.

## User Review Required
**WARNING**

API Constraints for certain Widgets: You requested several advanced widgets (Calendar, Unread Email, Weather).

*   Weather (Precipitation, UV, AQI): Requires a 3rd party API key (like OpenWeatherMap or Apple WeatherKit).
*   Calendar & Unread Emails: Requires Google OAuth integration and API permissions.

Proposed approach for Version 1: I will build the widget architecture and the fully local widgets first:

*   Digital Clock & Date
*   World Clock
*   Active Stopwatches & Timers (with background process!)
*   Visual Countdowns (X days until Event)
*   Daily To-Do List

Once these are working smoothly in the new sidebar, we can tackle adding the necessary API integrations for Weather and Emails in a follow-up task. Does this sound like a solid plan?

## Proposed Changes

**extension/manifest.json**
*   [MODIFY]: Add a `"background": { "service_worker": "background.js" }` entry.
*   [MODIFY]: Add necessary permissions (e.g., `alarms`, `notifications` if we want a sound when a timer finishes, and `storage`).

**extension/background.js**
*   [NEW]: Create the background service worker.
*   [NEW]: Implement `chrome.alarms` to track active timers and stopwatches.
*   [NEW]: Listen for alarm completions and show a basic browser notification when a timer is up, so it alerts the user even if Tab Out isn't currently open.

**extension/index.html**
*   [MODIFY]: Re-structure `<div class="container">` into a two-column layout: `.sidebar` and `.main-content`.
*   [NEW]: Build the HTML skeleton for the left sidebar. Move Settings and New Note icons here.
*   [NEW]: Add a Widgets container in the sidebar.
*   [NEW]: Add a "Widget Drawer/Picker" overlay to select new widgets (Clock, Timer, To-Do, Countdown).

**extension/style.css**
*   [NEW]: Base styling for the sidebar (glass-like or dark opaque background depending on the theme), width set to ~320px.
*   [NEW]: Widget container styling inside the sidebar.
*   [NEW]: Individual widget styles:
    *   Time/World Clock: Large typography.
    *   Timers: Circular progress rings or minimal digital readouts.
    *   To-Do: Compact checklist items.
    *   Countdowns: Visual progress bars or "X Days" badges.

**extension/app.js & extension/widgets.js**
*   [NEW]: Create `widgets.js` to separate the widget logic from the main tab management. (Add `<script src="widgets.js"></script>` to `index.html`).
*   [NEW]: Create a Widget Registry that maps widget types (e.g., timer, todo) to their UI rendering functions.
*   [NEW]: Implement Save/Load system syncing widget state to `chrome.storage.local`.
*   [NEW]: Implement the UI logic to update the DOM periodically for clocks/timers based on the timestamps stored in the background script.

## Verification Plan

**Automated/Manual Verification**
*   **Sidebar UI**: Verify it aligns correctly and doesn't break the masonry tab grid.
*   **Widgets Engine**: Open the Widget Picker, add a Timer, a To-Do list, and a Countdown.
*   **Background Process**: Start a 1-minute timer, close all tabs. Wait 1 minute. A notification should fire from the background worker.
*   **Persistence**: Open a new tab, ensure the exact widget configuration (and To-Do items) loads perfectly.