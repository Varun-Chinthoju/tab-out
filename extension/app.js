/* ================================================================
   Tab Out — Dashboard App (Pure Extension Edition)

   This file is the brain of the dashboard. Now that the dashboard
   IS the extension page (not inside an iframe), it can call
   chrome.tabs and chrome.storage directly — no postMessage bridge needed.

   What this file does:
   1. Reads open browser tabs directly via chrome.tabs.query()
   2. Groups tabs by domain with a landing pages category
   3. Renders domain cards, banners, and stats
   4. Handles all user actions (close tabs, save for later, focus tab)
   5. Stores "Saved for Later" tabs in chrome.storage.local (no server)
   ================================================================ */

'use strict';


/* ----------------------------------------------------------------
   CHROME TABS — Direct API Access

   Since this page IS the extension's new tab page, it has full
   access to chrome.tabs and chrome.storage. No middleman needed.
   ---------------------------------------------------------------- */

// All open tabs — populated by fetchOpenTabs()
let openTabs = [];

/**
 * fetchOpenTabs()
 *
 * Reads all currently open browser tabs directly from Chrome.
 * Sets the extensionId flag so we can identify Tab Out's own pages.
 */
async function fetchOpenTabs() {
  try {
    const extensionId = chrome.runtime.id;
    // The new URL for this page is now index.html (not newtab.html)
    const newtabUrl = `chrome-extension://${extensionId}/index.html`;

    const tabs = await chrome.tabs.query({});
    openTabs = tabs.map(t => ({
      id:       t.id,
      url:      t.url,
      title:    t.title,
      windowId: t.windowId,
      active:   t.active,
      // Flag Tab Out's own pages so we can detect duplicate new tabs
      isTabOut: t.url === newtabUrl || t.url === 'chrome://newtab/',
    }));
  } catch {
    // chrome.tabs API unavailable (shouldn't happen in an extension page)
    openTabs = [];
  }
}

/**
 * closeTabsByUrls(urls)
 *
 * Closes all open tabs whose hostname matches any of the given URLs.
 * After closing, re-fetches the tab list to keep our state accurate.
 *
 * Special case: file:// URLs are matched exactly (they have no hostname).
 */
async function closeTabsByUrls(urls) {
  if (!urls || urls.length === 0) return;

  // Separate file:// URLs (exact match) from regular URLs (hostname match)
  const targetHostnames = [];
  const exactUrls = new Set();

  for (const u of urls) {
    if (u.startsWith('file://')) {
      exactUrls.add(u);
    } else {
      try { targetHostnames.push(new URL(u).hostname); }
      catch { /* skip unparseable */ }
    }
  }

  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs
    .filter(tab => {
      const tabUrl = tab.url || '';
      if (tabUrl.startsWith('file://') && exactUrls.has(tabUrl)) return true;
      try {
        const tabHostname = new URL(tabUrl).hostname;
        return tabHostname && targetHostnames.includes(tabHostname);
      } catch { return false; }
    })
    .map(tab => tab.id);

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabsExact(urls)
 *
 * Closes tabs by exact URL match (not hostname). Used for landing pages
 * so closing "Gmail inbox" doesn't also close individual email threads.
 */
async function closeTabsExact(urls) {
  if (!urls || urls.length === 0) return;
  const urlSet = new Set(urls);
  const allTabs = await chrome.tabs.query({});
  const toClose = allTabs.filter(t => urlSet.has(t.url)).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * focusTab(url)
 *
 * Switches Chrome to the tab with the given URL (exact match first,
 * then hostname fallback). Also brings the window to the front.
 */
async function focusTab(url) {
  if (!url) return;
  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();

  // Try exact URL match first
  let matches = allTabs.filter(t => t.url === url);

  // Fall back to hostname match
  if (matches.length === 0) {
    try {
      const targetHost = new URL(url).hostname;
      matches = allTabs.filter(t => {
        try { return new URL(t.url).hostname === targetHost; }
        catch { return false; }
      });
    } catch {}
  }

  if (matches.length === 0) return;

  // Prefer a match in a different window so it actually switches windows
  const match = matches.find(t => t.windowId !== currentWindow.id) || matches[0];
  await chrome.tabs.update(match.id, { active: true });
  await chrome.windows.update(match.windowId, { focused: true });
}

/**
 * closeDuplicateTabs(urls, keepOne)
 *
 * Closes duplicate tabs for the given list of URLs.
 * keepOne=true → keep one copy of each, close the rest.
 * keepOne=false → close all copies.
 */
async function closeDuplicateTabs(urls, keepOne = true) {
  const allTabs = await chrome.tabs.query({});
  const toClose = [];

  for (const url of urls) {
    const matching = allTabs.filter(t => t.url === url);
    if (keepOne) {
      const keep = matching.find(t => t.active) || matching[0];
      for (const tab of matching) {
        if (tab.id !== keep.id) toClose.push(tab.id);
      }
    } else {
      for (const tab of matching) toClose.push(tab.id);
    }
  }

  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}

/**
 * closeTabOutDupes()
 *
 * Closes all duplicate Tab Out new-tab pages except the current one.
 */
async function closeTabOutDupes() {
  const extensionId = chrome.runtime.id;
  const newtabUrl = `chrome-extension://${extensionId}/index.html`;

  const allTabs = await chrome.tabs.query({});
  const currentWindow = await chrome.windows.getCurrent();
  const tabOutTabs = allTabs.filter(t =>
    t.url === newtabUrl || t.url === 'chrome://newtab/'
  );

  if (tabOutTabs.length <= 1) return;

  // Keep the active Tab Out tab in the CURRENT window — that's the one the
  // user is looking at right now. Falls back to any active one, then the first.
  const keep =
    tabOutTabs.find(t => t.active && t.windowId === currentWindow.id) ||
    tabOutTabs.find(t => t.active) ||
    tabOutTabs[0];
  const toClose = tabOutTabs.filter(t => t.id !== keep.id).map(t => t.id);
  if (toClose.length > 0) await chrome.tabs.remove(toClose);
  await fetchOpenTabs();
}


/* ----------------------------------------------------------------
   UI HELPERS
   ---------------------------------------------------------------- */

/**
 * playCloseSound()
 *
 * Plays a clean "swoosh" sound when tabs are closed.
 * Built entirely with the Web Audio API — no sound files needed.
 * A filtered noise sweep that descends in pitch, like air moving.
 */
function playCloseSound() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const t = ctx.currentTime;

    // Swoosh: shaped white noise through a sweeping bandpass filter
    const duration = 0.25;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * duration, ctx.sampleRate);
    const data = buffer.getChannelData(0);

    // Generate noise with a natural envelope (quick attack, smooth decay)
    for (let i = 0; i < data.length; i++) {
      const pos = i / data.length;
      // Envelope: ramps up fast in first 10%, then fades out smoothly
      const env = pos < 0.1 ? pos / 0.1 : Math.pow(1 - (pos - 0.1) / 0.9, 1.5);
      data[i] = (Math.random() * 2 - 1) * env;
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;

    // Bandpass filter sweeps from high to low — creates the "swoosh" character
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 2.0;
    filter.frequency.setValueAtTime(4000, t);
    filter.frequency.exponentialRampToValueAtTime(400, t + duration);

    // Volume
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.15, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + duration);

    source.connect(filter).connect(gain).connect(ctx.destination);
    source.start(t);

    setTimeout(() => ctx.close(), 500);
  } catch {
    // Audio not supported — fail silently
  }
}

/**
 * shootConfetti(x, y)
 *
 * Shoots a burst of colorful confetti particles from the given screen
 * coordinates (typically the center of a card being closed).
 * Pure CSS + JS, no libraries.
 */
function shootConfetti(x, y) {
  const currentAccent = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#c8713a';
  const colors = [
    currentAccent,
    '#e8a070', // amber light
    '#5a7a62', // sage
    '#8aaa92', // sage light
    '#5a6b7a', // slate
    '#8a9baa', // slate light
    '#d4b896', // warm paper
    '#b35a5a', // rose
  ];

  const particleCount = 17;

  for (let i = 0; i < particleCount; i++) {
    const el = document.createElement('div');

    const isCircle = Math.random() > 0.5;
    const size = 5 + Math.random() * 6; // 5–11px
    const color = colors[Math.floor(Math.random() * colors.length)];

    el.style.cssText = `
      position: fixed;
      left: ${x}px;
      top: ${y}px;
      width: ${size}px;
      height: ${size}px;
      background: ${color};
      border-radius: ${isCircle ? '50%' : '2px'};
      pointer-events: none;
      z-index: 9999;
      transform: translate(-50%, -50%);
      opacity: 1;
    `;
    document.body.appendChild(el);

    // Physics: random angle and speed for the outward burst
    const angle   = Math.random() * Math.PI * 2;
    const speed   = 60 + Math.random() * 120;
    const vx      = Math.cos(angle) * speed;
    const vy      = Math.sin(angle) * speed - 80; // bias upward
    const gravity = 200;

    const startTime = performance.now();
    const duration  = 700 + Math.random() * 200; // 700–900ms

    function frame(now) {
      const elapsed  = (now - startTime) / 1000;
      const progress = elapsed / (duration / 1000);

      if (progress >= 1) { el.remove(); return; }

      const px = vx * elapsed;
      const py = vy * elapsed + 0.5 * gravity * elapsed * elapsed;
      const opacity = progress < 0.5 ? 1 : 1 - (progress - 0.5) * 2;
      const rotate  = elapsed * 200 * (isCircle ? 0 : 1);

      el.style.transform = `translate(calc(-50% + ${px}px), calc(-50% + ${py}px)) rotate(${rotate}deg)`;
      el.style.opacity = opacity;

      requestAnimationFrame(frame);
    }

    requestAnimationFrame(frame);
  }
}

/**
 * animateCardOut(card)
 *
 * Smoothly removes a mission card: fade + scale down, then confetti.
 * After the animation, checks if the grid is now empty.
 */
function animateCardOut(card) {
  if (!card) return;

  const rect = card.getBoundingClientRect();
  shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);

  card.classList.add('closing');
  setTimeout(() => {
    card.remove();
    checkAndShowEmptyState();
  }, 300);
}

/**
 * showToast(message)
 *
 * Brief pop-up notification at the bottom of the screen.
 */
function showToast(message) {
  const toast = document.getElementById('toast');
  document.getElementById('toastText').textContent = message;
  toast.classList.add('visible');
  setTimeout(() => toast.classList.remove('visible'), 2500);
}

/**
 * checkAndShowEmptyState()
 *
 * Shows a cheerful "Inbox zero" message when all domain cards are gone.
 */
function checkAndShowEmptyState() {
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return;

  const remaining = missionsEl.querySelectorAll('.mission-card:not(.closing)').length;
  if (remaining > 0) return;

  missionsEl.innerHTML = `
    <div class="missions-empty-state">
      <div class="empty-checkmark">
        <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="1.5" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" d="m4.5 12.75 6 6 9-13.5" />
        </svg>
      </div>
      <div class="empty-title">Inbox zero, but for tabs.</div>
      <div class="empty-subtitle">You're free.</div>
    </div>
  `;

  const countEl = document.getElementById('openTabsSectionCount');
  if (countEl) countEl.textContent = '0 domains';
}

/**
 * getGreeting() — "Good morning / afternoon / evening"
 */
function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

/**
 * getDateDisplay() — "Friday, April 4, 2026"
 */
function getDateDisplay() {
  return new Date().toLocaleDateString('en-US', {
    weekday: 'long',
    year:    'numeric',
    month:   'long',
    day:     'numeric',
  });
}


/* ----------------------------------------------------------------
   DOMAIN & TITLE CLEANUP HELPERS
   ---------------------------------------------------------------- */

// Map of known hostnames → friendly display names.
const FRIENDLY_DOMAINS = {
  // ── GitHub ──
  'github.com':             'GitHub',
  'www.github.com':         'GitHub',
  'gist.github.com':        'GitHub Gist',
  'github.dev':             'GitHub Dev',
  'copilot.github.com':     'GitHub Copilot',

  // ── Google ──
  'google.com':             'Google',
  'www.google.com':         'Google',
  'mail.google.com':        'Gmail',
  'docs.google.com':        'Google Docs',
  'sheets.google.com':      'Google Sheets',
  'slides.google.com':      'Google Slides',
  'drive.google.com':       'Google Drive',
  'calendar.google.com':    'Google Calendar',
  'meet.google.com':        'Google Meet',
  'chat.google.com':        'Google Chat',
  'photos.google.com':      'Google Photos',
  'maps.google.com':        'Google Maps',
  'translate.google.com':   'Google Translate',
  'news.google.com':        'Google News',
  'play.google.com':        'Google Play',
  'cloud.google.com':       'Google Cloud',
  'console.cloud.google.com':'Google Cloud Console',
  'colab.research.google.com':'Google Colab',
  'gemini.google.com':      'Gemini',
  'ai.google.dev':          'Google AI',
  'analytics.google.com':   'Google Analytics',
  'search.google.com':      'Google Search',
  'accounts.google.com':    'Google Account',
  'earth.google.com':       'Google Earth',
  'fonts.google.com':       'Google Fonts',
  'myaccount.google.com':   'Google Account',
  'keep.google.com':        'Google Keep',

  // ── YouTube ──
  'youtube.com':            'YouTube',
  'www.youtube.com':        'YouTube',
  'music.youtube.com':      'YouTube Music',
  'studio.youtube.com':     'YouTube Studio',
  'tv.youtube.com':         'YouTube TV',

  // ── Social Media ──
  'x.com':                  'X',
  'www.x.com':              'X',
  'twitter.com':            'X',
  'www.twitter.com':        'X',
  'reddit.com':             'Reddit',
  'www.reddit.com':         'Reddit',
  'old.reddit.com':         'Reddit',
  'new.reddit.com':         'Reddit',
  'linkedin.com':           'LinkedIn',
  'www.linkedin.com':       'LinkedIn',
  'instagram.com':          'Instagram',
  'www.instagram.com':      'Instagram',
  'facebook.com':           'Facebook',
  'www.facebook.com':       'Facebook',
  'm.facebook.com':         'Facebook',
  'tiktok.com':             'TikTok',
  'www.tiktok.com':         'TikTok',
  'snapchat.com':           'Snapchat',
  'www.snapchat.com':       'Snapchat',
  'web.snapchat.com':       'Snapchat',
  'threads.net':            'Threads',
  'www.threads.net':        'Threads',
  'bsky.app':               'Bluesky',
  'mastodon.social':        'Mastodon',
  'pinterest.com':          'Pinterest',
  'www.pinterest.com':      'Pinterest',
  'tumblr.com':             'Tumblr',
  'www.tumblr.com':         'Tumblr',
  'xiaohongshu.com':        'RedNote',
  'www.xiaohongshu.com':    'RedNote',

  // ── Publishing & Blogs ──
  'substack.com':           'Substack',
  'www.substack.com':       'Substack',
  'medium.com':             'Medium',
  'www.medium.com':         'Medium',
  'dev.to':                 'DEV Community',
  'hashnode.com':           'Hashnode',
  'ghost.org':              'Ghost',
  'wordpress.com':          'WordPress',
  'www.wordpress.com':      'WordPress',
  'blogger.com':            'Blogger',
  'www.blogger.com':        'Blogger',

  // ── AI & LLMs ──
  'chatgpt.com':            'ChatGPT',
  'www.chatgpt.com':        'ChatGPT',
  'chat.openai.com':        'ChatGPT',
  'openai.com':             'OpenAI',
  'platform.openai.com':    'OpenAI Platform',
  'claude.ai':              'Claude',
  'www.claude.ai':          'Claude',
  'code.claude.com':        'Claude Code',
  'console.anthropic.com':  'Anthropic Console',
  'anthropic.com':          'Anthropic',
  'www.anthropic.com':      'Anthropic',
  'perplexity.ai':          'Perplexity',
  'www.perplexity.ai':      'Perplexity',
  'poe.com':                'Poe',
  'www.poe.com':            'Poe',
  'midjourney.com':         'Midjourney',
  'www.midjourney.com':     'Midjourney',
  'replicate.com':          'Replicate',
  'www.replicate.com':      'Replicate',
  'copilot.microsoft.com':  'Microsoft Copilot',
  'labs.google.com':        'Google Labs',
  'deepmind.google':        'DeepMind',
  'ollama.com':             'Ollama',
  'groq.com':               'Groq',
  'www.groq.com':           'Groq',
  'together.ai':            'Together AI',
  'www.together.ai':        'Together AI',
  'huggingface.co':         'Hugging Face',


  // ── Dev Tools & Code ──
  'stackoverflow.com':      'Stack Overflow',
  'www.stackoverflow.com':  'Stack Overflow',
  'stackexchange.com':      'Stack Exchange',
  'news.ycombinator.com':   'Hacker News',
  'developer.mozilla.org':  'MDN',
  'gitlab.com':             'GitLab',
  'www.gitlab.com':         'GitLab',
  'bitbucket.org':          'Bitbucket',
  'www.bitbucket.org':      'Bitbucket',
  'codepen.io':             'CodePen',
  'jsfiddle.net':           'JSFiddle',
  'codesandbox.io':         'CodeSandbox',
  'replit.com':             'Replit',
  'www.replit.com':         'Replit',
  'glitch.com':             'Glitch',
  'www.glitch.com':         'Glitch',
  'caniuse.com':            'Can I Use',
  'bundlephobia.com':       'Bundlephobia',
  'regex101.com':           'Regex101',
  'jsoncrack.com':          'JSON Crack',
  'excalidraw.com':         'Excalidraw',

  // ── Package Managers & Docs ──
  'npmjs.com':              'npm',
  'www.npmjs.com':          'npm',
  'pypi.org':               'PyPI',
  'crates.io':              'crates.io',
  'pkg.go.dev':             'Go Packages',
  'rubygems.org':           'RubyGems',
  'packagist.org':          'Packagist',
  'docs.rs':                'docs.rs',
  'readthedocs.io':         'Read the Docs',

  // ── Cloud & Hosting ──
  'vercel.com':             'Vercel',
  'www.vercel.com':         'Vercel',
  'netlify.com':            'Netlify',
  'www.netlify.com':        'Netlify',
  'app.netlify.com':        'Netlify',
  'railway.app':            'Railway',
  'render.com':             'Render',
  'www.render.com':         'Render',
  'fly.io':                 'Fly.io',
  'heroku.com':             'Heroku',
  'www.heroku.com':         'Heroku',
  'dashboard.heroku.com':   'Heroku',
  'digitalocean.com':       'DigitalOcean',
  'www.digitalocean.com':   'DigitalOcean',
  'aws.amazon.com':         'AWS',
  'console.aws.amazon.com': 'AWS Console',
  'portal.azure.com':       'Azure',
  'azure.microsoft.com':    'Azure',
  'supabase.com':           'Supabase',
  'www.supabase.com':       'Supabase',
  'app.supabase.com':       'Supabase',
  'firebase.google.com':    'Firebase',
  'console.firebase.google.com': 'Firebase Console',
  'cloudflare.com':         'Cloudflare',
  'www.cloudflare.com':     'Cloudflare',
  'dash.cloudflare.com':    'Cloudflare',
  'pages.dev':              'Cloudflare Pages',
  'workers.dev':            'Cloudflare Workers',

  // ── Project Management & Productivity ──
  'notion.so':              'Notion',
  'www.notion.so':          'Notion',
  'trello.com':             'Trello',
  'www.trello.com':         'Trello',
  'asana.com':              'Asana',
  'www.asana.com':          'Asana',
  'app.asana.com':          'Asana',
  'monday.com':             'Monday',
  'www.monday.com':         'Monday',
  'airtable.com':           'Airtable',
  'www.airtable.com':       'Airtable',
  'miro.com':               'Miro',
  'www.miro.com':           'Miro',
  'coda.io':                'Coda',
  'www.coda.io':            'Coda',
  'clickup.com':            'ClickUp',
  'www.clickup.com':        'ClickUp',
  'app.clickup.com':        'ClickUp',
  'todoist.com':            'Todoist',
  'www.todoist.com':        'Todoist',
  'app.todoist.com':        'Todoist',
  'linear.app':             'Linear',
  'jira.atlassian.com':     'Jira',
  'confluence.atlassian.com':'Confluence',
  'atlassian.com':          'Atlassian',
  'www.atlassian.com':      'Atlassian',
  'calendly.com':           'Calendly',
  'www.calendly.com':       'Calendly',

  // ── Bug Tracking & Monitoring ──
  'sentry.io':              'Sentry',
  'www.sentry.io':          'Sentry',
  'app.datadoghq.com':      'Datadog',
  'newrelic.com':           'New Relic',
  'www.newrelic.com':       'New Relic',
  'pagerduty.com':          'PagerDuty',

  // ── Design & Creative ──
  'figma.com':              'Figma',
  'www.figma.com':          'Figma',
  'canva.com':              'Canva',
  'www.canva.com':          'Canva',
  'dribbble.com':           'Dribbble',
  'www.dribbble.com':       'Dribbble',
  'behance.net':            'Behance',
  'www.behance.net':        'Behance',
  'framer.com':             'Framer',
  'www.framer.com':         'Framer',
  'spline.design':          'Spline',
  'www.spline.design':      'Spline',
  'coolors.co':             'Coolors',
  'unsplash.com':           'Unsplash',
  'www.unsplash.com':       'Unsplash',
  'pexels.com':             'Pexels',
  'www.pexels.com':         'Pexels',

  // ── Communication ──
  'slack.com':              'Slack',
  'app.slack.com':          'Slack',
  'discord.com':            'Discord',
  'www.discord.com':        'Discord',
  'teams.microsoft.com':    'Microsoft Teams',
  'zoom.us':                'Zoom',
  'www.zoom.us':            'Zoom',
  'app.zoom.us':            'Zoom',
  'web.telegram.org':       'Telegram',
  'telegram.org':           'Telegram',
  'www.telegram.org':       'Telegram',
  'web.whatsapp.com':       'WhatsApp',
  'whatsapp.com':           'WhatsApp',
  'www.whatsapp.com':       'WhatsApp',
  'signal.org':             'Signal',
  'www.signal.org':         'Signal',
  'messenger.com':          'Messenger',
  'www.messenger.com':      'Messenger',

  // ── File Storage ──
  'dropbox.com':            'Dropbox',
  'www.dropbox.com':        'Dropbox',
  'box.com':                'Box',
  'www.box.com':            'Box',
  'app.box.com':            'Box',
  'onedrive.live.com':      'OneDrive',
  'evernote.com':           'Evernote',
  'www.evernote.com':       'Evernote',

  // ── Shopping ──
  'amazon.com':             'Amazon',
  'www.amazon.com':         'Amazon',
  'smile.amazon.com':       'Amazon',
  'ebay.com':               'eBay',
  'www.ebay.com':           'eBay',
  'etsy.com':               'Etsy',
  'www.etsy.com':           'Etsy',
  'target.com':             'Target',
  'www.target.com':         'Target',
  'walmart.com':            'Walmart',
  'www.walmart.com':        'Walmart',
  'bestbuy.com':            'Best Buy',
  'www.bestbuy.com':        'Best Buy',
  'shopify.com':            'Shopify',
  'www.shopify.com':        'Shopify',
  'aliexpress.com':         'AliExpress',
  'www.aliexpress.com':     'AliExpress',
  'newegg.com':             'Newegg',
  'www.newegg.com':         'Newegg',

  // ── News & Media ──
  'nytimes.com':            'NY Times',
  'www.nytimes.com':        'NY Times',
  'washingtonpost.com':     'Washington Post',
  'www.washingtonpost.com': 'Washington Post',
  'cnn.com':                'CNN',
  'www.cnn.com':            'CNN',
  'bbc.com':                'BBC',
  'www.bbc.com':            'BBC',
  'bbc.co.uk':              'BBC',
  'www.bbc.co.uk':          'BBC',
  'theguardian.com':        'The Guardian',
  'www.theguardian.com':    'The Guardian',
  'reuters.com':            'Reuters',
  'www.reuters.com':        'Reuters',
  'apnews.com':             'AP News',
  'www.apnews.com':         'AP News',
  'techcrunch.com':         'TechCrunch',
  'www.techcrunch.com':     'TechCrunch',
  'theverge.com':           'The Verge',
  'www.theverge.com':       'The Verge',
  'arstechnica.com':        'Ars Technica',
  'www.arstechnica.com':    'Ars Technica',
  'wired.com':              'Wired',
  'www.wired.com':          'Wired',
  'vice.com':               'Vice',
  'www.vice.com':           'Vice',
  'engadget.com':           'Engadget',
  'www.engadget.com':       'Engadget',
  'mashable.com':           'Mashable',
  'www.mashable.com':       'Mashable',
  'producthunt.com':        'Product Hunt',
  'www.producthunt.com':    'Product Hunt',

  // ── Entertainment & Streaming ──
  'netflix.com':            'Netflix',
  'www.netflix.com':        'Netflix',
  'spotify.com':            'Spotify',
  'open.spotify.com':       'Spotify',
  'hulu.com':               'Hulu',
  'www.hulu.com':           'Hulu',
  'disneyplus.com':         'Disney+',
  'www.disneyplus.com':     'Disney+',
  'max.com':                'Max',
  'www.max.com':            'Max',
  'play.max.com':           'Max',
  'twitch.tv':              'Twitch',
  'www.twitch.tv':          'Twitch',
  'music.apple.com':        'Apple Music',
  'tv.apple.com':           'Apple TV+',
  'soundcloud.com':         'SoundCloud',
  'www.soundcloud.com':     'SoundCloud',
  'crunchyroll.com':        'Crunchyroll',
  'www.crunchyroll.com':    'Crunchyroll',
  'imdb.com':               'IMDb',
  'www.imdb.com':           'IMDb',
  'rottentomatoes.com':     'Rotten Tomatoes',
  'www.rottentomatoes.com': 'Rotten Tomatoes',
  'primevideo.com':         'Prime Video',
  'www.primevideo.com':     'Prime Video',
  'peacocktv.com':          'Peacock',
  'www.peacocktv.com':      'Peacock',
  'paramountplus.com':      'Paramount+',
  'www.paramountplus.com':  'Paramount+',

  // ── Finance ──
  'robinhood.com':          'Robinhood',
  'www.robinhood.com':      'Robinhood',
  'coinbase.com':           'Coinbase',
  'www.coinbase.com':       'Coinbase',
  'stripe.com':             'Stripe',
  'www.stripe.com':         'Stripe',
  'dashboard.stripe.com':   'Stripe Dashboard',
  'paypal.com':             'PayPal',
  'www.paypal.com':         'PayPal',
  'venmo.com':              'Venmo',
  'www.venmo.com':          'Venmo',
  'chase.com':              'Chase',
  'www.chase.com':          'Chase',
  'bankofamerica.com':      'Bank of America',
  'www.bankofamerica.com':  'Bank of America',
  'fidelity.com':           'Fidelity',
  'www.fidelity.com':       'Fidelity',
  'schwab.com':             'Schwab',
  'www.schwab.com':         'Schwab',
  'mint.intuit.com':        'Mint',
  'finance.yahoo.com':      'Yahoo Finance',
  'binance.com':            'Binance',
  'www.binance.com':        'Binance',
  'kraken.com':             'Kraken',
  'www.kraken.com':         'Kraken',

  // ── Education ──
  'coursera.org':           'Coursera',
  'www.coursera.org':       'Coursera',
  'udemy.com':              'Udemy',
  'www.udemy.com':          'Udemy',
  'khanacademy.org':        'Khan Academy',
  'www.khanacademy.org':    'Khan Academy',
  'edx.org':                'edX',
  'www.edx.org':            'edX',
  'w3schools.com':          'W3Schools',
  'www.w3schools.com':      'W3Schools',
  'leetcode.com':           'LeetCode',
  'www.leetcode.com':       'LeetCode',
  'hackerrank.com':         'HackerRank',
  'www.hackerrank.com':     'HackerRank',
  'freecodecamp.org':       'freeCodeCamp',
  'www.freecodecamp.org':   'freeCodeCamp',
  'codecademy.com':         'Codecademy',
  'www.codecademy.com':     'Codecademy',
  'brilliant.org':          'Brilliant',
  'www.brilliant.org':      'Brilliant',
  'duolingo.com':           'Duolingo',
  'www.duolingo.com':       'Duolingo',
  'quizlet.com':            'Quizlet',
  'www.quizlet.com':        'Quizlet',
  'scholar.google.com':     'Google Scholar',

  // ── Research & Reference ──
  'wikipedia.org':          'Wikipedia',
  'en.wikipedia.org':       'Wikipedia',
  'arxiv.org':              'arXiv',
  'www.arxiv.org':          'arXiv',
  'huggingface.co':         'Hugging Face',
  'www.huggingface.co':     'Hugging Face',
  'kaggle.com':             'Kaggle',
  'www.kaggle.com':         'Kaggle',
  'paperswithcode.com':     'Papers with Code',
  'www.paperswithcode.com': 'Papers with Code',
  'semanticscholar.org':    'Semantic Scholar',
  'www.semanticscholar.org':'Semantic Scholar',
  'wolframalpha.com':       'Wolfram Alpha',
  'www.wolframalpha.com':   'Wolfram Alpha',

  // ── Microsoft ──
  'microsoft.com':          'Microsoft',
  'www.microsoft.com':      'Microsoft',
  'outlook.live.com':       'Outlook',
  'outlook.office.com':     'Outlook',
  'office.com':             'Microsoft 365',
  'www.office.com':         'Microsoft 365',
  'live.com':               'Microsoft',
  'login.microsoftonline.com':'Microsoft Login',
  'bing.com':               'Bing',
  'www.bing.com':           'Bing',
  'learn.microsoft.com':    'Microsoft Learn',
  'dev.azure.com':          'Azure DevOps',
  'visualstudio.com':       'Visual Studio',
  'marketplace.visualstudio.com':'VS Marketplace',
  'code.visualstudio.com':  'VS Code',

  // ── Apple ──
  'apple.com':              'Apple',
  'www.apple.com':          'Apple',
  'developer.apple.com':    'Apple Developer',
  'icloud.com':             'iCloud',
  'www.icloud.com':         'iCloud',
  'support.apple.com':      'Apple Support',

  // ── Gaming ──
  'store.steampowered.com': 'Steam',
  'steampowered.com':       'Steam',
  'epicgames.com':          'Epic Games',
  'www.epicgames.com':      'Epic Games',
  'itch.io':                'itch.io',

  // ── Misc ──
  'local-files':            'Local Files',
  'localhost':              'Localhost',
  'archive.org':            'Internet Archive',
  'web.archive.org':        'Wayback Machine',
  'pastebin.com':           'Pastebin',
  'www.pastebin.com':       'Pastebin',
  'docs.new':               'Google Docs',
  'sheets.new':             'Google Sheets',
  'slides.new':             'Google Slides',
  'about.me':               'About.me',
  'linktr.ee':              'Linktree',
  'bitly.com':              'Bitly',
  'tinyurl.com':            'TinyURL',
  'grammarly.com':          'Grammarly',
  'www.grammarly.com':      'Grammarly',
  'app.grammarly.com':      'Grammarly',
  '1password.com':          '1Password',
  'my.1password.com':       '1Password',
  'bitwarden.com':          'Bitwarden',
  'vault.bitwarden.com':    'Bitwarden',
  'lastpass.com':           'LastPass',
  'www.lastpass.com':       'LastPass',
};

function friendlyDomain(hostname) {
  if (!hostname) return '';
  if (FRIENDLY_DOMAINS[hostname]) return FRIENDLY_DOMAINS[hostname];

  if (hostname.endsWith('.substack.com') && hostname !== 'substack.com') {
    return capitalize(hostname.replace('.substack.com', '')) + "'s Substack";
  }
  if (hostname.endsWith('.github.io')) {
    return capitalize(hostname.replace('.github.io', '')) + ' (GitHub Pages)';
  }

  let clean = hostname
    .replace(/^www\./, '')
    .replace(/\.(com|org|net|io|co|ai|dev|app|so|me|xyz|info|us|uk|co\.uk|co\.jp)$/, '');

  return clean.split('.').map(part => capitalize(part)).join(' ');
}

function capitalize(str) {
  if (!str) return '';
  return str.charAt(0).toUpperCase() + str.slice(1);
}

function stripTitleNoise(title) {
  if (!title) return '';
  // Strip leading notification count: "(2) Title"
  title = title.replace(/^\(\d+\+?\)\s*/, '');
  // Strip inline counts like "Inbox (16,359)"
  title = title.replace(/\s*\([\d,]+\+?\)\s*/g, ' ');
  // Strip email addresses (privacy + cleaner display)
  title = title.replace(/\s*[\-\u2010-\u2015]\s*[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  title = title.replace(/[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g, '');
  // Clean X/Twitter format
  title = title.replace(/\s+on X:\s*/, ': ');
  title = title.replace(/\s*\/\s*X\s*$/, '');
  return title.trim();
}

function cleanTitle(title, hostname) {
  if (!title || !hostname) return title || '';

  const friendly = friendlyDomain(hostname);
  const domain   = hostname.replace(/^www\./, '');
  const seps     = [' - ', ' | ', ' — ', ' · ', ' – '];

  for (const sep of seps) {
    const idx = title.lastIndexOf(sep);
    if (idx === -1) continue;
    const suffix     = title.slice(idx + sep.length).trim();
    const suffixLow  = suffix.toLowerCase();
    if (
      suffixLow === domain.toLowerCase() ||
      suffixLow === friendly.toLowerCase() ||
      suffixLow === domain.replace(/\.\w+$/, '').toLowerCase() ||
      domain.toLowerCase().includes(suffixLow) ||
      friendly.toLowerCase().includes(suffixLow)
    ) {
      const cleaned = title.slice(0, idx).trim();
      if (cleaned.length >= 5) return cleaned;
    }
  }
  return title;
}

function smartTitle(title, url) {
  if (!url) return title || '';
  let pathname = '', hostname = '';
  try { const u = new URL(url); pathname = u.pathname; hostname = u.hostname; }
  catch { return title || ''; }

  const titleIsUrl = !title || title === url || title.startsWith(hostname) || title.startsWith('http');

  if ((hostname === 'x.com' || hostname === 'twitter.com' || hostname === 'www.x.com') && pathname.includes('/status/')) {
    const username = pathname.split('/')[1];
    if (username) return titleIsUrl ? `Post by @${username}` : title;
  }

  if (hostname === 'github.com' || hostname === 'www.github.com') {
    const parts = pathname.split('/').filter(Boolean);
    if (parts.length >= 2) {
      const [owner, repo, ...rest] = parts;
      if (rest[0] === 'issues' && rest[1]) return `${owner}/${repo} Issue #${rest[1]}`;
      if (rest[0] === 'pull'   && rest[1]) return `${owner}/${repo} PR #${rest[1]}`;
      if (rest[0] === 'blob' || rest[0] === 'tree') return `${owner}/${repo} — ${rest.slice(2).join('/')}`;
      if (titleIsUrl) return `${owner}/${repo}`;
    }
  }

  if ((hostname === 'www.youtube.com' || hostname === 'youtube.com') && pathname === '/watch') {
    if (titleIsUrl) return 'YouTube Video';
  }

  if ((hostname === 'www.reddit.com' || hostname === 'reddit.com' || hostname === 'old.reddit.com') && pathname.includes('/comments/')) {
    const parts  = pathname.split('/').filter(Boolean);
    const subIdx = parts.indexOf('r');
    if (subIdx !== -1 && parts[subIdx + 1]) {
      if (titleIsUrl) return `r/${parts[subIdx + 1]} post`;
    }
  }

  return title || url;
}


/* ----------------------------------------------------------------
   SVG ICON STRINGS
   ---------------------------------------------------------------- */
const ICONS = {
  tabs:    `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M3 8.25V18a2.25 2.25 0 0 0 2.25 2.25h13.5A2.25 2.25 0 0 0 21 18V8.25m-18 0V6a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 6v2.25m-18 0h18" /></svg>`,
  close:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>`,
  archive: `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M20.25 7.5l-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m6 4.125l2.25 2.25m0 0l2.25 2.25M12 13.875l2.25-2.25M12 13.875l-2.25 2.25M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z" /></svg>`,
  focus:   `<svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="m4.5 19.5 15-15m0 0H8.25m11.25 0v11.25" /></svg>`,
};


/* ----------------------------------------------------------------
   IN-MEMORY STORE FOR OPEN-TAB GROUPS
   ---------------------------------------------------------------- */
let domainGroups = [];


/* ----------------------------------------------------------------
   HELPER: filter out browser-internal pages
   ---------------------------------------------------------------- */

/**
 * getRealTabs()
 *
 * Returns tabs that are real web pages — no chrome://, extension
 * pages, about:blank, etc.
 */
function getRealTabs() {
  return openTabs.filter(t => {
    const url = t.url || '';
    return (
      !url.startsWith('chrome://') &&
      !url.startsWith('chrome-extension://') &&
      !url.startsWith('about:') &&
      !url.startsWith('edge://') &&
      !url.startsWith('brave://')
    );
  });
}

/**
 * checkTabOutDupes()
 *
 * Counts how many Tab Out pages are open. If more than 1,
 * shows a banner offering to close the extras.
 */
function checkTabOutDupes() {
  const tabOutTabs = openTabs.filter(t => t.isTabOut);
  const banner  = document.getElementById('tabOutDupeBanner');
  const countEl = document.getElementById('tabOutDupeCount');
  if (!banner) return;

  if (tabOutTabs.length > 1) {
    if (countEl) countEl.textContent = tabOutTabs.length;
    banner.style.display = 'flex';
  } else {
    banner.style.display = 'none';
  }
}


/* ----------------------------------------------------------------
   OVERFLOW CHIPS ("+N more" expand button in domain cards)
   ---------------------------------------------------------------- */

function buildOverflowChips(hiddenTabs, urlCounts = {}) {
  const hiddenChips = hiddenTabs.map(tab => {
    const label    = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), '');
    const count    = urlCounts[tab.url] || 1;
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip draggable clickable${chipClass}" draggable="true" data-tab-id="${tab.id}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('');

  return `
    <div class="page-chips-overflow" style="display:none">${hiddenChips}</div>
    <div class="page-chip page-chip-overflow clickable" data-action="expand-chips">
      <span class="chip-text">+${hiddenTabs.length} more</span>
    </div>`;
}


/* ----------------------------------------------------------------
   DOMAIN CARD RENDERER
   ---------------------------------------------------------------- */

/**
 * parseMarkdown(text)
 *
 * A lightweight regex-based markdown parser for notes.
 */
function parseMarkdown(text) {
  if (!text) return '<p style="opacity:0.5 italic">Click to edit...</p>';
  
  let html = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  // Headers
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>');
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>');
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>');

  // Bold & Italic
  html = html.replace(/\*\*(.*)\*\*/gim, '<strong>$1</strong>');
  html = html.replace(/\*(.*)\*/gim, '<em>$1</em>');

  // Links
  html = html.replace(/\[(.*?)\]\((.*?)\)/gim, '<a href="$2" target="_blank">$1</a>');

  // Lists
  html = html.replace(/^\s*[\-\*]\s+(.*)$/gim, '<ul><li>$1</li></ul>');
  html = html.replace(/<\/ul>\s*<ul>/gim, ''); // Merge adjacent lists

  // Line breaks to paragraphs (if not already handled by headers/lists)
  const lines = html.split('\n');
  const processedLines = lines.map(line => {
    if (line.startsWith('<h') || line.startsWith('<ul>')) return line;
    return line.trim() ? `<p>${line}</p>` : '';
  });

  return processedLines.join('');
}

/**
 * renderNoteCard(note, settings)
 */
function renderNoteCard(note, settings) {
  const layoutMode = settings.layoutMode || 'default';
  let dynamicStyle = '';
  const stableId = note.id;

  if (layoutMode === 'chaos') {
    const pos = settings.cardPositions?.[stableId];
    if (pos) {
      dynamicStyle = `left: ${pos.x}px; top: ${pos.y}px; --chaos-z: ${pos.z || 1};`;
      if (pos.w) dynamicStyle += `width: ${pos.w}px;`;
      if (pos.h) dynamicStyle += `height: ${pos.h}px;`;
    } else {
      const rx = (window.innerWidth / 2) - 130 + (Math.random() * 100 - 50);
      const ry = (window.innerHeight / 2) - 100 + (Math.random() * 100 - 50);
      dynamicStyle = `left: ${rx}px; top: ${ry}px;`;
    }
  } else {
    const savedPos = settings.cardPositions?.[stableId];
    if (savedPos?.w) dynamicStyle += `width: ${savedPos.w}px;`;
    if (savedPos?.h) dynamicStyle += `height: ${savedPos.h}px;`;
  }

  const renderedHtml = parseMarkdown(note.text);
  const isNew = !note.text;

  return `
    <div class="mission-card note-card draggable ${isNew ? 'editing' : ''}" draggable="true" data-domain-id="${stableId}" style="${dynamicStyle}">
      <div class="status-bar" style="background: var(--accent);"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">Note</span>
          <button class="chip-action chip-close" data-action="delete-note" data-note-id="${stableId}" title="Delete note" style="opacity: 0.5; margin-left: auto;">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
          </button>
        </div>
        <div class="note-preview" data-action="edit-note">${renderedHtml}</div>
        <textarea class="note-textarea" data-note-id="${stableId}" placeholder="Write something...">${note.text || ''}</textarea>
      </div>
      <div class="card-resize-handle"></div>
    </div>`;
}

/**
 * getDomainColor(domain)
 *
 * Generates a stable HSL color based on a string hash.
 */
function getDomainColor(domain) {
  let hash = 0;
  for (let i = 0; i < domain.length; i++) {
    hash = domain.charCodeAt(i) + ((hash << 5) - hash);
  }
  const h = Math.abs(hash) % 360;
  return `hsl(${h}, 50%, 45%)`; // Domain color
}

/**
 * renderDomainCard(group, settings)
 *
 * Builds the HTML for one domain group card.
 */
function renderDomainCard(group, settings = {}) {
  const tabs      = group.tabs || [];
  const tabCount  = tabs.length;
  const isLanding = group.domain === '__landing-pages__';
  const stableId  = 'domain-' + group.domain.replace(/[^a-z0-9]/g, '-');

  // Layout mode logic
  const layoutMode = settings.layoutMode || document.documentElement.getAttribute('data-layout-mode') || 'default';
  let dynamicStyle = '';
  
  if (layoutMode === 'chaos') {
    const pos = settings.cardPositions?.[stableId];
    if (pos) {
      dynamicStyle = `left: ${pos.x}px; top: ${pos.y}px; --chaos-z: ${pos.z || 1};`;
      if (pos.w) dynamicStyle += `width: ${pos.w}px;`;
      if (pos.h) dynamicStyle += `height: ${pos.h}px;`;
    } else {
      // Default to center of screen (with a bit of random jitter)
      const cardWidth = settings.cardSize || 260;
      const centerX = (window.innerWidth / 2) - (cardWidth / 2);
      const centerY = (window.innerHeight / 2) - 150;
      const rx = centerX + (Math.random() * 100 - 50);
      const ry = centerY + (Math.random() * 100 - 50);
      dynamicStyle = `left: ${rx}px; top: ${ry}px;`;
    }
  } else if (layoutMode === 'structured') {
    const color = getDomainColor(group.domain);
    dynamicStyle = `--domain-color: ${color};`;
  }

  // Apply custom dimensions if they exist for this specific card
  const savedPos = settings.cardPositions?.[stableId];
  if (savedPos?.w) dynamicStyle += `width: ${savedPos.w}px;`;
  if (savedPos?.h) dynamicStyle += `height: ${savedPos.h}px;`;

  // Count duplicates (exact URL match)
  const urlCounts = {};
  for (const tab of tabs) urlCounts[tab.url] = (urlCounts[tab.url] || 0) + 1;
  const dupeUrls   = Object.entries(urlCounts).filter(([, c]) => c > 1);
  const hasDupes   = dupeUrls.length > 0;
  const totalExtras = dupeUrls.reduce((s, [, c]) => s + c - 1, 0);

  const tabBadge = `<span class="open-tabs-badge">
    ${ICONS.tabs}
    ${tabCount} tab${tabCount !== 1 ? 's' : ''} open
  </span>`;

  const dupeBadge = hasDupes
    ? `<span class="open-tabs-badge" style="color:var(--accent);background:rgba(200,113,58,0.08);">
        ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </span>`
    : '';

  // Deduplicate for display: show each URL once, with (Nx) badge if duped
  const seen = new Set();
  const uniqueTabs = [];
  for (const tab of tabs) {
    if (!seen.has(tab.url)) { seen.add(tab.url); uniqueTabs.push(tab); }
  }

  const visibleTabs = uniqueTabs.slice(0, 8);
  const extraCount  = uniqueTabs.length - visibleTabs.length;

  const pageChips = visibleTabs.map(tab => {
    let label = cleanTitle(smartTitle(stripTitleNoise(tab.title || ''), tab.url), group.domain);
    // For localhost tabs, prepend port number so you can tell projects apart
    try {
      const parsed = new URL(tab.url);
      if (parsed.hostname === 'localhost' && parsed.port) label = `${parsed.port} ${label}`;
    } catch {}
    const count    = urlCounts[tab.url];
    const dupeTag  = count > 1 ? ` <span class="chip-dupe-badge">(${count}x)</span>` : '';
    const chipClass = count > 1 ? ' chip-has-dupes' : '';
    const safeUrl   = (tab.url || '').replace(/"/g, '&quot;');
    const safeTitle = label.replace(/"/g, '&quot;');
    let domain = '';
    try { domain = new URL(tab.url).hostname; } catch {}
    const faviconUrl = domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=16` : '';
    return `<div class="page-chip draggable clickable${chipClass}" draggable="true" data-tab-id="${tab.id}" data-action="focus-tab" data-tab-url="${safeUrl}" title="${safeTitle}">
      ${faviconUrl ? `<img class="chip-favicon" src="${faviconUrl}" alt="" onerror="this.style.display='none'">` : ''}
      <span class="chip-text">${label}</span>${dupeTag}
      <div class="chip-actions">
        <button class="chip-action chip-close" data-action="close-single-tab" data-tab-url="${safeUrl}" title="Close this tab">
          <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" stroke-width="2.5" stroke="currentColor"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18 18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>`;
  }).join('') + (extraCount > 0 ? buildOverflowChips(uniqueTabs.slice(8), urlCounts) : '');

  let actionsHtml = `
    <button class="action-btn close-tabs" data-action="close-domain-tabs" data-domain-id="${stableId}">
      ${ICONS.close}
      Close all ${tabCount} tab${tabCount !== 1 ? 's' : ''}
    </button>`;

  if (hasDupes) {
    const dupeUrlsEncoded = dupeUrls.map(([url]) => encodeURIComponent(url)).join(',');
    actionsHtml += `
      <button class="action-btn" data-action="dedup-keep-one" data-dupe-urls="${dupeUrlsEncoded}">
        Close ${totalExtras} duplicate${totalExtras !== 1 ? 's' : ''}
      </button>`;
  }

  return `
    <div class="mission-card domain-card draggable ${hasDupes ? 'has-amber-bar' : 'has-neutral-bar'}" draggable="true" data-domain-id="${stableId}" style="${dynamicStyle}">
      <div class="status-bar"></div>
      <div class="mission-content">
        <div class="mission-top">
          <span class="mission-name">${isLanding ? 'Homepages' : (group.label || friendlyDomain(group.domain))}</span>
          ${tabBadge}
          ${dupeBadge}
        </div>
        <div class="mission-pages">${pageChips}</div>
        <div class="actions">${actionsHtml}</div>
      </div>
      <div class="mission-meta">
        <div class="mission-page-count">${tabCount}</div>
        <div class="mission-page-label">tabs</div>
      </div>
      <div class="card-resize-handle"></div>
    </div>`;
}


/* ----------------------------------------------------------------
   MAIN DASHBOARD RENDERER
   ---------------------------------------------------------------- */

/**
 * renderStaticDashboard()
 *
 * The main render function:
 * 1. Paints greeting + date
 * 2. Fetches open tabs via chrome.tabs.query()
 * 3. Groups tabs by domain (with landing pages pulled out to their own group)
 * 4. Renders domain cards
 * 5. Updates footer stats
 * 6. Renders the "Saved for Later" checklist
 */
async function renderStaticDashboard() {
  // --- Header ---
  const greetingEl = document.getElementById('greeting');
  const dateEl     = document.getElementById('dateDisplay');
  if (greetingEl) greetingEl.textContent = getGreeting();
  if (dateEl)     dateEl.textContent     = getDateDisplay();

  // --- Fetch tabs & settings ---
  await fetchOpenTabs();
  const realTabs = getRealTabs();
  const storageKeys = Object.keys(DEFAULT_SETTINGS);
  const storage = await chrome.storage.local.get(storageKeys);
  const settings = { ...DEFAULT_SETTINGS, ...storage };
  const userNotes = settings.userNotes || [];

  // --- Group tabs by domain ---
  const LANDING_PAGE_PATTERNS = [
    { hostname: 'mail.google.com', test: (p, h) =>
        !h.includes('#inbox/') && !h.includes('#sent/') && !h.includes('#search/') },
    { hostname: 'x.com',               pathExact: ['/home'] },
    { hostname: 'www.linkedin.com',    pathExact: ['/'] },
    { hostname: 'github.com',          pathExact: ['/'] },
    { hostname: 'www.youtube.com',     pathExact: ['/'] },
    ...(typeof LOCAL_LANDING_PAGE_PATTERNS !== 'undefined' ? LOCAL_LANDING_PAGE_PATTERNS : []),
  ];

  function isLandingPage(url) {
    try {
      const parsed = new URL(url);
      return LANDING_PAGE_PATTERNS.some(p => {
        const hostnameMatch = p.hostname ? parsed.hostname === p.hostname : p.hostnameEndsWith ? parsed.hostname.endsWith(p.hostnameEndsWith) : false;
        if (!hostnameMatch) return false;
        if (p.test)       return p.test(parsed.pathname, url);
        if (p.pathPrefix) return parsed.pathname.startsWith(p.pathPrefix);
        if (p.pathExact)  return p.pathExact.includes(parsed.pathname);
        return parsed.pathname === '/';
      });
    } catch { return false; }
  }

  domainGroups = [];
  const groupMap    = {};
  const landingTabs = [];
  const customGroups = typeof LOCAL_CUSTOM_GROUPS !== 'undefined' ? LOCAL_CUSTOM_GROUPS : [];

  function matchCustomGroup(url) {
    try {
      const parsed = new URL(url);
      return customGroups.find(r => {
        const hostMatch = r.hostname ? parsed.hostname === r.hostname : r.hostnameEndsWith ? parsed.hostname.endsWith(r.hostnameEndsWith) : false;
        if (!hostMatch) return false;
        if (r.pathPrefix) return parsed.pathname.startsWith(r.pathPrefix);
        return true;
      }) || null;
    } catch { return null; }
  }

  for (const tab of realTabs) {
    try {
      if (isLandingPage(tab.url)) {
        landingTabs.push(tab);
        continue;
      }
      const customRule = matchCustomGroup(tab.url);
      if (customRule) {
        const key = customRule.groupKey;
        if (!groupMap[key]) groupMap[key] = { domain: key, label: customRule.groupLabel, tabs: [] };
        groupMap[key].tabs.push(tab);
        continue;
      }
      let hostname = tab.url && tab.url.startsWith('file://') ? 'local-files' : new URL(tab.url).hostname;
      if (!hostname) continue;
      if (!groupMap[hostname]) groupMap[hostname] = { domain: hostname, tabs: [] };
      groupMap[hostname].tabs.push(tab);
    } catch {}
  }

  if (landingTabs.length > 0) {
    groupMap['__landing-pages__'] = { domain: '__landing-pages__', tabs: landingTabs };
  }

  const landingHostnames = new Set(LANDING_PAGE_PATTERNS.map(p => p.hostname).filter(Boolean));
  const landingSuffixes = LANDING_PAGE_PATTERNS.map(p => p.hostnameEndsWith).filter(Boolean);
  function isLandingDomain(domain) {
    if (landingHostnames.has(domain)) return true;
    return landingSuffixes.some(s => domain.endsWith(s));
  }

  domainGroups = Object.values(groupMap).sort((a, b) => {
    const aIsLanding = a.domain === '__landing-pages__';
    const bIsLanding = b.domain === '__landing-pages__';
    if (aIsLanding !== bIsLanding) return aIsLanding ? -1 : 1;
    const aIsPriority = isLandingDomain(a.domain);
    const bIsPriority = isLandingDomain(b.domain);
    if (aIsPriority !== bIsPriority) return aIsPriority ? -1 : 1;
    return b.tabs.length - a.tabs.length;
  });

  const { domainOrder = [] } = settings;
  if (domainOrder.length > 0) {
    domainGroups.sort((a, b) => {
      const idxA = domainOrder.indexOf('domain-' + a.domain.replace(/[^a-z0-9]/g, '-'));
      const idxB = domainOrder.indexOf('domain-' + b.domain.replace(/[^a-z0-9]/g, '-'));
      if (idxA === -1 && idxB === -1) return 0;
      if (idxA === -1) return 1;
      if (idxB === -1) return -1;
      return idxA - idxB;
    });
  }

  // --- Render domain cards & notes ---
  const openTabsSection      = document.getElementById('openTabsSection');
  const openTabsMissionsEl   = document.getElementById('openTabsMissions');
  const openTabsSectionCount = document.getElementById('openTabsSectionCount');
  const openTabsSectionTitle = document.getElementById('openTabsSectionTitle');

  if (domainGroups.length > 0 || userNotes.length > 0) {
    if (openTabsSectionTitle) openTabsSectionTitle.textContent = 'Dashboard';
    const countText = domainGroups.length > 0 ? `${domainGroups.length} domain${domainGroups.length !== 1 ? 's' : ''}` : 'No tabs open';
    if (openTabsSectionCount) {
      openTabsSectionCount.innerHTML = `${countText} &nbsp;&middot;&nbsp; <button class="action-btn close-tabs" data-action="close-all-open-tabs" style="font-size:11px;padding:3px 10px;">${ICONS.close} Close all ${realTabs.length} tabs</button>`;
    }
    const tabCardsHtml = domainGroups.map(g => renderDomainCard(g, settings)).join('');
    const noteCardsHtml = userNotes.map(n => renderNoteCard(n, settings)).join('');
    if (openTabsMissionsEl) openTabsMissionsEl.innerHTML = tabCardsHtml + noteCardsHtml;
    if (openTabsSection) openTabsSection.style.display = 'block';
  } else if (openTabsSection) {
    openTabsSection.style.display = 'none';
  }

  const statTabs = document.getElementById('statTabs');
  if (statTabs) statTabs.textContent = openTabs.length;
  checkTabOutDupes();
}

async function renderDashboard() {
  await renderStaticDashboard();
}


/* ----------------------------------------------------------------
   EVENT HANDLERS — using event delegation

   One listener on document handles ALL button clicks.
   Think of it as one security guard watching the whole building
   instead of one per door.
   ---------------------------------------------------------------- */

/**
 * findEmptySpot(settings)
 *
 * Scans current card positions and returns an {x, y} coordinate
 * that has minimal overlap with existing cards.
 */
async function findEmptySpot(settings) {
  const cardWidth = settings.cardSize || 260;
  const cardHeight = 200; // estimated note height
  const missionsEl = document.getElementById('openTabsMissions');
  if (!missionsEl) return { x: 100, y: 100 };

  const containerRect = missionsEl.getBoundingClientRect();
  const maxX = Math.max(containerRect.width - cardWidth, 400);
  const maxY = Math.max(window.innerHeight - 300, 400);

  // Get all existing card rects
  const existingRects = [...document.querySelectorAll('.mission-card')].map(el => {
    return {
      left: el.offsetLeft,
      top: el.offsetTop,
      right: el.offsetLeft + el.offsetWidth,
      bottom: el.offsetTop + el.offsetHeight
    };
  });

  // Simple grid search for a free spot
  for (let y = 40; y < maxY; y += 50) {
    for (let x = 40; x < maxX; x += 50) {
      const rect = { left: x, top: y, right: x + cardWidth, bottom: y + cardHeight };
      const overlap = existingRects.some(r => {
        return !(rect.left > r.right || rect.right < r.left || rect.top > r.bottom || rect.bottom < r.top);
      });
      if (!overlap) return { x, y };
    }
  }

  // Fallback: random near top-center
  return {
    x: Math.max(0, (containerRect.width / 2) - (cardWidth / 2) + (Math.random() * 100 - 50)),
    y: 100 + (Math.random() * 100 - 50)
  };
}

document.addEventListener('click', async (e) => {
  // New Note
  if (e.target.closest('#addNoteBtn')) {
    const storage = await chrome.storage.local.get(Object.keys(DEFAULT_SETTINGS));
    const settings = { ...DEFAULT_SETTINGS, ...storage };
    const userNotes = settings.userNotes || [];
    
    const newNoteId = 'note-' + Date.now();
    const newNote = {
      id: newNoteId,
      text: '',
      type: 'note'
    };
    
    // In freeform mode, find an empty spot first
    if (settings.layoutMode === 'chaos') {
      const spot = await findEmptySpot(settings);
      const cardPositions = settings.cardPositions || {};
      cardPositions[newNoteId] = { x: spot.x, y: spot.y, z: 999 };
      await chrome.storage.local.set({ cardPositions });
      settings.cardPositions = cardPositions; // update local ref for renderer
    }

    userNotes.push(newNote);
    await chrome.storage.local.set({ userNotes });
    
    const missionsEl = document.getElementById('openTabsMissions');
    if (missionsEl) {
      if (missionsEl.querySelector('.missions-empty-state')) missionsEl.innerHTML = '';
      
      const div = document.createElement('div');
      div.innerHTML = renderNoteCard(newNote, settings);
      const noteEl = div.firstElementChild;
      missionsEl.appendChild(noteEl);
      noteEl.querySelector('textarea')?.focus();
    }
    return;
  }

  // Walk up the DOM to find the nearest element with data-action
  const actionEl = e.target.closest('[data-action]');
  if (!actionEl) return;

  const action = actionEl.dataset.action;

  // Delete Note
  if (action === 'delete-note') {
    const noteId = actionEl.dataset.noteId;
    const card = actionEl.closest('.mission-card');
    if (card) animateCardOut(card);

    const { userNotes = [] } = await chrome.storage.local.get('userNotes');
    const filtered = userNotes.filter(n => n.id !== noteId);
    await chrome.storage.local.set({ userNotes: filtered });
    
    const { cardPositions = {} } = await chrome.storage.local.get('cardPositions');
    delete cardPositions[noteId];
    await chrome.storage.local.set({ cardPositions });
    return;
  }

  // ---- Close duplicate Tab Out tabs ----
  if (action === 'close-tabout-dupes') {
    await closeTabOutDupes();
    playCloseSound();
    const banner = document.getElementById('tabOutDupeBanner');
    if (banner) {
      banner.style.transition = 'opacity 0.4s';
      banner.style.opacity = '0';
      setTimeout(() => { banner.style.display = 'none'; banner.style.opacity = '1'; }, 400);
    }
    showToast('Closed extra Tab Out tabs');
    return;
  }

  const card = actionEl.closest('.mission-card');

  // ---- Expand overflow chips ("+N more") ----
  if (action === 'expand-chips') {
    const overflowContainer = actionEl.parentElement.querySelector('.page-chips-overflow');
    if (overflowContainer) {
      overflowContainer.style.display = 'contents';
      actionEl.remove();
    }
    return;
  }

  // Focus a specific tab
  if (action === 'focus-tab') {
    const tabUrl = actionEl.dataset.tabUrl;
    if (tabUrl) await focusTab(tabUrl);
    return;
  }

  // Edit Note (Toggle Edit Mode)
  if (action === 'edit-note') {
    const card = actionEl.closest('.note-card');
    if (card) {
      card.classList.add('editing');
      const textarea = card.querySelector('.note-textarea');
      textarea?.focus();
      if (textarea) textarea.selectionStart = textarea.selectionEnd = textarea.value.length;
    }
    return;
  }

  // ---- Close a single tab ----
  if (action === 'close-single-tab') {
    e.stopPropagation(); // don't trigger parent chip's focus-tab
    const tabUrl = actionEl.dataset.tabUrl;
    if (!tabUrl) return;

    // Close the tab in Chrome directly
    const allTabs = await chrome.tabs.query({});
    const match   = allTabs.find(t => t.url === tabUrl);
    if (match) await chrome.tabs.remove(match.id);
    await fetchOpenTabs();

    playCloseSound();

    // Animate the chip row out
    const chip = actionEl.closest('.page-chip');
    if (chip) {
      const rect = chip.getBoundingClientRect();
      shootConfetti(rect.left + rect.width / 2, rect.top + rect.height / 2);
      chip.style.transition = 'opacity 0.2s, transform 0.2s';
      chip.style.opacity    = '0';
      chip.style.transform  = 'scale(0.8)';
      setTimeout(() => {
        chip.remove();
        // If the card now has no tabs, remove it too
        const parentCard = document.querySelector('.mission-card:has(.mission-pages:empty)');
        if (parentCard) animateCardOut(parentCard);
        document.querySelectorAll('.mission-card').forEach(c => {
          if (c.querySelectorAll('.page-chip[data-action="focus-tab"]').length === 0) {
            animateCardOut(c);
          }
        });
      }, 200);
    }

    // Update footer
    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;

    showToast('Tab closed');
    return;
  }

  // ---- Close all tabs in a domain group ----
  if (action === 'close-domain-tabs') {
    const domainId = actionEl.dataset.domainId;
    const group    = domainGroups.find(g => {
      return 'domain-' + g.domain.replace(/[^a-z0-9]/g, '-') === domainId;
    });
    if (!group) return;

    const urls      = group.tabs.map(t => t.url);
    // Landing pages and custom groups (whose domain key isn't a real hostname)
    // must use exact URL matching to avoid closing unrelated tabs
    const useExact  = group.domain === '__landing-pages__' || !!group.label;

    if (useExact) {
      await closeTabsExact(urls);
    } else {
      await closeTabsByUrls(urls);
    }

    if (card) {
      playCloseSound();
      animateCardOut(card);
    }

    // Remove from in-memory groups
    const idx = domainGroups.indexOf(group);
    if (idx !== -1) domainGroups.splice(idx, 1);

    const groupLabel = group.domain === '__landing-pages__' ? 'Homepages' : (group.label || friendlyDomain(group.domain));
    showToast(`Closed ${urls.length} tab${urls.length !== 1 ? 's' : ''} from ${groupLabel}`);

    const statTabs = document.getElementById('statTabs');
    if (statTabs) statTabs.textContent = openTabs.length;
    return;
  }

  // ---- Close duplicates, keep one copy ----
  if (action === 'dedup-keep-one') {
    const urlsEncoded = actionEl.dataset.dupeUrls || '';
    const urls = urlsEncoded.split(',').map(u => decodeURIComponent(u)).filter(Boolean);
    if (urls.length === 0) return;

    await closeDuplicateTabs(urls, true);
    playCloseSound();

    // Hide the dedup button
    actionEl.style.transition = 'opacity 0.2s';
    actionEl.style.opacity    = '0';
    setTimeout(() => actionEl.remove(), 200);

    // Remove dupe badges from the card
    if (card) {
      card.querySelectorAll('.chip-dupe-badge').forEach(b => {
        b.style.transition = 'opacity 0.2s';
        b.style.opacity    = '0';
        setTimeout(() => b.remove(), 200);
      });
      card.querySelectorAll('.open-tabs-badge').forEach(badge => {
        if (badge.textContent.includes('duplicate')) {
          badge.style.transition = 'opacity 0.2s';
          badge.style.opacity    = '0';
          setTimeout(() => badge.remove(), 200);
        }
      });
      card.classList.remove('has-amber-bar');
      card.classList.add('has-neutral-bar');
    }

    showToast('Closed duplicates, kept one copy each');
    return;
  }

  // ---- Close ALL open tabs ----
  if (action === 'close-all-open-tabs') {
    const allUrls = openTabs
      .filter(t => t.url && !t.url.startsWith('chrome') && !t.url.startsWith('about:'))
      .map(t => t.url);
    await closeTabsByUrls(allUrls);
    playCloseSound();

    document.querySelectorAll('#openTabsMissions .mission-card').forEach(c => {
      shootConfetti(
        c.getBoundingClientRect().left + c.offsetWidth / 2,
        c.getBoundingClientRect().top  + c.offsetHeight / 2
      );
      animateCardOut(c);
    });

    showToast('All tabs closed. Fresh start.');
    return;
  }
});


/* ----------------------------------------------------------------
   SETTINGS & THEMES — chrome.storage.local
   ---------------------------------------------------------------- */

const DEFAULT_SETTINGS = {
  theme: 'system',
  accentColor: '#c8713a',
  density: 'comfortable',
  bgImage: null,
  bgType: 'none',
  cardStyle: 'default',
  stickyTextColor: '#1a1613',
  layoutMode: 'default',
  domainOrder: [],
  cardPositions: {},
  cardSize: 260,
  userNotes: []
};

/**
 * applySettings(settings)
 *
 * Updates the DOM and CSS variables based on user preferences.
 * settings: a full settings object (merged with defaults)
 */
function applySettings(settings) {
  const {
    theme, accentColor, density, bgImage, bgType, 
    cardStyle, stickyTextColor, layoutMode, cardSize
  } = settings;

  const root = document.documentElement;

  // 1. Apply root data-attributes
  root.setAttribute('data-theme', theme);
  root.setAttribute('data-density', density);
  root.setAttribute('data-card-style', cardStyle);
  root.setAttribute('data-layout-mode', layoutMode);
  root.setAttribute('data-bg', bgType);

  // 2. Apply CSS Variables
  root.style.setProperty('--accent', accentColor);
  root.style.setProperty('--sticky-text', stickyTextColor);
  root.style.setProperty('--card-width', `${cardSize}px`);

  // 3. Background Logic
  const customControls = document.getElementById('customBgControls');
  const bgStatus = document.getElementById('bgImageStatus');
  
  if (bgType === 'custom') {
    if (customControls) customControls.style.display = 'block';
    if (bgImage) {
      root.style.setProperty('--bg-image', `url("${bgImage}")`);
      root.style.setProperty('--bg-overlay', 'rgba(0,0,0,0.25)');
      document.querySelector('.container')?.classList.add('has-custom-bg');
      if (bgStatus) bgStatus.textContent = 'Custom background active';
    } else {
      root.style.setProperty('--bg-image', 'none');
      root.style.setProperty('--bg-overlay', 'transparent');
      if (bgStatus) bgStatus.textContent = 'No image uploaded';
    }
  } else {
    if (customControls) customControls.style.display = 'none';
    document.querySelector('.container')?.classList.remove('has-custom-bg');
    // Clear inline overrides so CSS [data-bg] patterns or default paper can work
    root.style.removeProperty('--bg-image');
    root.style.removeProperty('--bg-overlay');
  }
  
  // 4. Update Modal UI (active states)
  const config = {
    '#themeOptions': theme,
    '#densityOptions': density,
    '#cardStyleOptions': cardStyle,
    '#layoutModeOptions': layoutMode,
    '#bgTypeOptions': bgType
  };

  for (const [id, currentVal] of Object.entries(config)) {
    const container = document.querySelector(id);
    if (!container) continue;
    container.querySelectorAll('.setting-control').forEach(btn => {
      // Find which data attribute this button uses
      const btnVal = btn.dataset.theme || btn.dataset.density || btn.dataset.style || btn.dataset.layout || btn.dataset.bg;
      btn.classList.toggle('active', btnVal === currentVal);
    });
  }

  // Accent Color Swatches
  const swatches = document.querySelectorAll('.color-swatch');
  const customWrapper = document.getElementById('customAccentWrapper');
  let matchedSwatch = false;

  swatches.forEach(swatch => {
    const isMatch = swatch.dataset.color.toLowerCase() === accentColor.toLowerCase();
    swatch.classList.toggle('active', isMatch);
    if (isMatch) matchedSwatch = true;
  });

  if (customWrapper) {
    customWrapper.classList.toggle('active', !matchedSwatch);
    const picker = document.getElementById('accentColorPicker');
    if (picker && !matchedSwatch) picker.value = accentColor;
  }

  // Sticky Text Color Picker
  const stickyPicker = document.getElementById('stickyTextColorPicker');
  const stickyDisplay = document.getElementById('stickyTextColorValue');
  if (stickyPicker) stickyPicker.value = stickyTextColor;
  if (stickyDisplay) stickyDisplay.textContent = stickyTextColor.toUpperCase();

  const addNoteBtn = document.getElementById('addNoteBtn');
  if (addNoteBtn) {
    addNoteBtn.style.background = accentColor;
    addNoteBtn.style.borderColor = accentColor;
  }

  // Card Size Slider
  const sizeSlider = document.getElementById('cardSizeSlider');
  const sizeDisplay = document.getElementById('cardSizeValue');
  if (sizeSlider) sizeSlider.value = cardSize;
  if (sizeDisplay) sizeDisplay.textContent = cardSize;
}

/**
 * processBackgroundImage(file)
 *
 * Resizes and compresses an image before saving to storage.
 * Uses object URLs for memory-efficient loading.
 */
async function processBackgroundImage(file) {
  if (!file || !file.type.startsWith('image/')) {
    throw new Error('Invalid file type. Please upload an image.');
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objectUrl = URL.createObjectURL(file);
    
    img.onload = () => {
      URL.revokeObjectURL(objectUrl); // Clean up memory
      
      const canvas = document.createElement('canvas');
      let width = img.width;
      let height = img.height;

      // Resize to max 1920px
      const MAX_DIM = 1920;
      if (width > height) {
        if (width > MAX_DIM) {
          height *= MAX_DIM / width;
          width = MAX_DIM;
        }
      } else {
        if (height > MAX_DIM) {
          width *= MAX_DIM / height;
          height = MAX_DIM;
        }
      }

      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Could not initialize canvas context.'));
        return;
      }
      
      ctx.drawImage(img, 0, 0, width, height);
      
      try {
        // Compress as JPEG (0.75 quality) to ensure storage success
        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        resolve(dataUrl);
      } catch (e) {
        reject(new Error('Failed to encode image. The file might be too large.'));
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(new Error('Failed to load image.'));
    };

    img.src = objectUrl;
  });
}

/**
 * initSettings()
 *
 * Loads settings from storage, merges with defaults, and applies them.
 */
async function initSettings() {
  const keys = Object.keys(DEFAULT_SETTINGS);
  const storage = await chrome.storage.local.get(keys);
  
  // Merge defaults with storage (storage takes precedence)
  const settings = { ...DEFAULT_SETTINGS, ...storage };
  
  applySettings(settings);

  // Fix CSP issue for upload button
  const uploadBtn = document.getElementById('uploadBgBtn');
  if (uploadBtn && !uploadBtn.dataset.listenerAdded) {
    uploadBtn.addEventListener('click', () => {
      document.getElementById('bgImageInput').click();
    });
    uploadBtn.dataset.listenerAdded = 'true';
  }

  // Check for #settings hash to open modal immediately
  if (window.location.hash === '#settings') {
    document.getElementById('settingsOverlay')?.classList.add('visible');
  }
}

// Listen for storage changes from other tabs/options page
chrome.storage.onChanged.addListener(async (changes) => {
  // Re-fetch everything to ensure we have a clean full state
  await initSettings();
});


/* ----------------------------------------------------------------
   SETTINGS UI EVENT HANDLERS
   ---------------------------------------------------------------- */

document.addEventListener('click', async (e) => {
  const settingsBtn = e.target.closest('#settingsBtn');
  if (settingsBtn) {
    document.getElementById('settingsOverlay').classList.add('visible');
    return;
  }

  const closeSettingsBtn = e.target.closest('#closeSettingsBtn');
  if (closeSettingsBtn) {
    document.getElementById('settingsOverlay').classList.remove('visible');
    return;
  }

  // Close modal when clicking overlay
  if (e.target.id === 'settingsOverlay') {
    e.target.classList.remove('visible');
    return;
  }

  // Theme options
  const themeOption = e.target.closest('#themeOptions .setting-control');
  if (themeOption) {
    const theme = themeOption.dataset.theme;
    await chrome.storage.local.set({ theme });
    return;
  }

  // Density options
  const densityOption = e.target.closest('#densityOptions .setting-control');
  if (densityOption) {
    const density = densityOption.dataset.density;
    await chrome.storage.local.set({ density });
    return;
  }

  // Card Style options
  const cardStyleOption = e.target.closest('#cardStyleOptions .setting-control');
  if (cardStyleOption) {
    const cardStyle = cardStyleOption.dataset.style;
    await chrome.storage.local.set({ cardStyle });
    return;
  }

  // Layout Mode options
  const layoutOption = e.target.closest('#layoutModeOptions .setting-control');
  if (layoutOption) {
    const layoutMode = layoutOption.dataset.layout;
    await chrome.storage.local.set({ layoutMode });
    return;
  }

  // Background Type options
  const bgOption = e.target.closest('#bgTypeOptions .setting-control');
  if (bgOption) {
    const bgType = bgOption.dataset.bg;
    await chrome.storage.local.set({ bgType });
    return;
  }

  // Clear background
  const clearBgBtn = e.target.closest('#clearBgBtn');
  if (clearBgBtn) {
    await chrome.storage.local.set({ bgImage: null });
    return;
  }

  // Color swatches
  const swatch = e.target.closest('.color-swatch');
  if (swatch) {
    const accentColor = swatch.dataset.color;
    await chrome.storage.local.set({ accentColor });
    return;
  }
});

// Background image input
document.addEventListener('change', async (e) => {
  if (e.target.id === 'bgImageInput' && e.target.files[0]) {
    try {
      showToast('Processing background...');
      const dataUrl = await processBackgroundImage(e.target.files[0]);
      await chrome.storage.local.set({ bgImage: dataUrl });
      showToast('Background updated');
    } catch (err) {
      console.error('[tab-out] Background upload error:', err);
      showToast(err.message || 'Failed to load image');
    } finally {
      e.target.value = ''; // Reset input
    }
  }
});

// Accent & Sticky color pickers
document.addEventListener('input', async (e) => {
  // Auto-save notes
  if (e.target.classList.contains('note-textarea')) {
    const noteId = e.target.dataset.noteId;
    const text = e.target.value;
    const { userNotes = [] } = await chrome.storage.local.get('userNotes');
    const note = userNotes.find(n => n.id === noteId);
    if (note) {
      note.text = text;
      await chrome.storage.local.set({ userNotes });
    }
    return;
  }

  if (e.target.id === 'accentColorPicker') {
    await chrome.storage.local.set({ accentColor: e.target.value });
  }
  if (e.target.id === 'stickyTextColorPicker') {
    await chrome.storage.local.set({ stickyTextColor: e.target.value });
  }
  if (e.target.id === 'cardSizeSlider') {
    await chrome.storage.local.set({ cardSize: parseInt(e.target.value) });
  }
});


/* ----------------------------------------------------------------
   DRAG AND DROP — Cards & Tabs
   ---------------------------------------------------------------- */

let draggedEl = null;

document.addEventListener('dragstart', (e) => {
  const card = e.target.closest('.mission-card.draggable');
  const chip = e.target.closest('.page-chip.draggable');
  
  if (card || chip) {
    draggedEl = card || chip;
    const type = card ? 'card' : 'chip';
    const id = card ? card.dataset.domainId : chip.dataset.tabId;
    
    // In chaos mode, we need the mouse offset to drop correctly
    let offsetData = '';
    if (card && document.documentElement.getAttribute('data-layout-mode') === 'chaos') {
      const rect = card.getBoundingClientRect();
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      offsetData = `:${ox}:${oy}`;
    }
    
    e.dataTransfer.setData('text/plain', `${type}:${id}${offsetData}`);
    e.dataTransfer.effectAllowed = 'move';
    
    // Slight delay to allow ghost image to be created
    setTimeout(() => draggedEl.classList.add('is-dragging'), 0);
  }
});

document.addEventListener('dragover', (e) => {
  e.preventDefault(); // Required to allow drop
  
  const layoutMode = document.documentElement.getAttribute('data-layout-mode');
  const card = e.target.closest('.mission-card.draggable');
  const chip = e.target.closest('.page-chip.draggable');
  
  // Clear previous highlights
  document.querySelectorAll('.drag-over, .drag-over-top').forEach(el => {
    el.classList.remove('drag-over', 'drag-over-top');
  });

  if (draggedEl?.classList.contains('mission-card') && layoutMode !== 'chaos' && card && card !== draggedEl) {
    card.classList.add('drag-over');
  } else if (draggedEl?.classList.contains('page-chip') && chip && chip !== draggedEl) {
    const rect = chip.getBoundingClientRect();
    const midpoint = rect.top + rect.height / 2;
    
    if (e.clientY < midpoint) {
      chip.classList.add('drag-over-top');
    } else {
      chip.classList.add('drag-over');
    }
  }
  e.dataTransfer.dropEffect = 'move';
});

document.addEventListener('dragleave', (e) => {
  const card = e.target.closest('.mission-card.draggable');
  const chip = e.target.closest('.page-chip.draggable');
  if (card) card.classList.remove('drag-over');
  if (chip) chip.classList.remove('drag-over', 'drag-over-top');
});

document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const dataString = e.dataTransfer.getData('text/plain');
  if (!dataString) return;

  const data = dataString.split(':');
  const type = data[0];
  const id = data[1];
  
  const layoutMode = document.documentElement.getAttribute('data-layout-mode');

  // Handle Card Drop (Freeform / Chaos)
  if (type === 'card' && layoutMode === 'chaos') {
    const offsetX = parseFloat(data[2] || 0);
    const offsetY = parseFloat(data[3] || 0);
    
    const container = document.getElementById('openTabsMissions');
    const draggedCard = container.querySelector(`[data-domain-id="${id}"]`);
    
    if (draggedCard) {
      const containerRect = container.getBoundingClientRect();
      
      // Calculate new position relative to the container
      const newX = e.clientX - offsetX - containerRect.left;
      const newY = e.clientY - offsetY - containerRect.top;
      
      // Update DOM immediately
      draggedCard.style.left = `${newX}px`;
      draggedCard.style.top = `${newY}px`;
      
      // Bring to front
      const cards = [...container.querySelectorAll('.mission-card')];
      const maxZ = Math.max(...cards.map(c => parseInt(c.style.getPropertyValue('--chaos-z') || 0)), 0);
      const newZ = maxZ + 1;
      draggedCard.style.setProperty('--chaos-z', newZ);

      // Save to storage
      const { cardPositions = {} } = await chrome.storage.local.get('cardPositions');
      cardPositions[id] = { x: newX, y: newY, z: newZ };
      await chrome.storage.local.set({ cardPositions });
    }
  }
  // Handle Card Drop (Grid Reorder)
  else if (type === 'card' && layoutMode !== 'chaos') {
    const targetCard = e.target.closest('.mission-card.draggable');
    if (targetCard && targetCard.dataset.domainId !== id) {
      const container = document.getElementById('openTabsMissions');
      const cards = [...container.querySelectorAll('.mission-card')];
      const draggedCard = container.querySelector(`[data-domain-id="${id}"]`);
      
      if (draggedCard) {
        const targetIndex = cards.indexOf(targetCard);
        const draggedIndex = cards.indexOf(draggedCard);
        
        if (draggedIndex < targetIndex) {
          targetCard.after(draggedCard);
        } else {
          targetCard.before(draggedCard);
        }

        const newOrder = [...container.querySelectorAll('.mission-card')].map(c => c.dataset.domainId);
        await chrome.storage.local.set({ domainOrder: newOrder });
      }
    }
  }

  // Handle Chip (Tab) Drop
  if (type === 'chip') {
    const targetChip = e.target.closest('.page-chip.draggable');
    if (targetChip && targetChip.dataset.tabId !== id) {
      const draggedTabId = parseInt(id);
      const isTop = targetChip.classList.contains('drag-over-top');
      
      try {
        const targetTabId = parseInt(targetChip.dataset.tabId);
        const targetTab = await chrome.tabs.get(targetTabId);
        
        let newIndex = targetTab.index;
        if (!isTop) newIndex += 1;

        await chrome.tabs.move(draggedTabId, { 
          windowId: targetTab.windowId, 
          index: newIndex 
        });
        
        await renderDashboard();
        showToast('Tab moved');
      } catch (err) {
        console.error('[tab-out] Failed to move tab:', err);
      }
    }
  }

  // Cleanup
  document.querySelectorAll('.drag-over, .drag-over-top, .is-dragging').forEach(el => {
    el.classList.remove('drag-over', 'drag-over-top', 'is-dragging');
  });
  draggedEl = null;
});

document.addEventListener('dragend', () => {
  document.querySelectorAll('.is-dragging, .drag-over, .drag-over-top').forEach(el => {
    el.classList.remove('is-dragging', 'drag-over', 'drag-over-top');
  });
  draggedEl = null;
});


/* ----------------------------------------------------------------
   RESIZE LOGIC — Cards
   ---------------------------------------------------------------- */

document.addEventListener('mousedown', (e) => {
  const handle = e.target.closest('.card-resize-handle');
  if (!handle) return;

  e.preventDefault();
  e.stopPropagation(); // Don't trigger card drag

  const card = handle.closest('.mission-card');
  const startX = e.clientX;
  const startY = e.clientY;
  const startWidth = card.offsetWidth;
  const startHeight = card.offsetHeight;
  
  const layoutMode = document.documentElement.getAttribute('data-layout-mode');
  const id = card.dataset.domainId;

  function onMouseMove(e) {
    const newWidth = Math.max(160, startWidth + (e.clientX - startX));
    const newHeight = Math.max(100, startHeight + (e.clientY - startY));
    
    card.style.width = `${newWidth}px`;
    card.style.height = `${newHeight}px`;
  }

  async function onMouseUp() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);

    // Save dimensions
    const { cardPositions = {} } = await chrome.storage.local.get('cardPositions');
    
    if (!cardPositions[id]) cardPositions[id] = {};
    cardPositions[id].w = card.offsetWidth;
    cardPositions[id].h = card.offsetHeight;

    await chrome.storage.local.set({ cardPositions });
    showToast('Size saved');
  }

  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);
});


// Handle Note Blur (Back to Preview)
document.addEventListener('blur', (e) => {
  if (e.target.classList.contains('note-textarea')) {
    const card = e.target.closest('.note-card');
    if (card) {
      card.classList.remove('editing');
      const preview = card.querySelector('.note-preview');
      if (preview) {
        preview.innerHTML = parseMarkdown(e.target.value);
      }
    }
  }
}, true); // useCapture to catch blur on children


/* ----------------------------------------------------------------
   INITIALIZE
   ---------------------------------------------------------------- */
initSettings();
renderDashboard();
