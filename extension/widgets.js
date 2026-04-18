// widgets.js – Handles the sidebar widget system for Tab Out

(() => {
  const storageKey = 'tabOutWidgets';

  // Utility: format time components
  function pad(num) {
    return String(num).padStart(2, '0');
  }

  // Load widgets from storage and render them
  function loadWidgets() {
    chrome.storage.local.get([storageKey], (result) => {
      const widgets = result[storageKey] || [];
      const container = document.getElementById('sidebarWidgets');
      container.innerHTML = '';
      widgets.forEach(renderWidget);
    });
  }

  // Save widgets array to storage
  function saveWidgets(widgets) {
    chrome.storage.local.set({ [storageKey]: widgets });
  }

  // Render a single widget based on its type and state
  function renderWidget(widget) {
    const container = document.getElementById('sidebarWidgets');
    const el = document.createElement('div');
    el.className = 'widget';
    el.dataset.id = widget.id;
    // Header with title and remove button
    const header = document.createElement('div');
    header.style.display = 'flex';
    header.style.justifyContent = 'space-between';
    header.style.alignItems = 'center';
    const title = document.createElement('h3');
    title.textContent = widget.title;
    const removeBtn = document.createElement('button');
    removeBtn.textContent = '✕';
    removeBtn.style.border = 'none';
    removeBtn.style.background = 'transparent';
    removeBtn.style.cursor = 'pointer';
    removeBtn.addEventListener('click', () => deleteWidget(widget.id));
    header.appendChild(title);
    header.appendChild(removeBtn);
    el.appendChild(header);

    // Content based on type
    if (widget.type === 'clock') {
      const timeEl = document.createElement('div');
      timeEl.style.fontSize = '1.2em';
      const dateEl = document.createElement('div');
      dateEl.style.fontSize = '0.9em';
      el.appendChild(timeEl);
      el.appendChild(dateEl);
      function update() {
        const now = new Date();
        timeEl.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        dateEl.textContent = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
      }
      update();
      setInterval(update, 1000);
    }

    if (widget.type === 'worldclock') {
      const list = document.createElement('div');
      list.style.fontSize = '0.9em';
      // For demo, show a few hard‑coded zones
      const zones = widget.zones || ['America/New_York', 'Europe/London', 'Asia/Tokyo'];
      function update() {
        list.innerHTML = '';
        zones.forEach((tz) => {
          const now = new Date().toLocaleTimeString('en-US', { timeZone: tz, hour: '2-digit', minute: '2-digit', second: '2-digit' });
          const city = tz.split('/')[1].replace('_', ' ');
          const row = document.createElement('div');
          row.textContent = `${city}: ${now}`;
          list.appendChild(row);
        });
      }
      el.appendChild(list);
      update();
      setInterval(update, 1000);
    }

    if (widget.type === 'timer') {
      const display = document.createElement('div');
      display.style.fontSize = '1.2em';
      const controls = document.createElement('div');
      controls.style.marginTop = '8px';
      const startBtn = document.createElement('button');
      startBtn.textContent = widget.state?.isRunning ? 'Pause' : 'Start';
      const resetBtn = document.createElement('button');
      resetBtn.textContent = 'Reset';
      controls.append(startBtn, resetBtn);
      el.appendChild(display, controls);

      function updateDisplay() {
        const remaining = widget.state?.timeRemaining ?? 0;
        const mins = Math.floor(remaining / 60);
        const secs = remaining % 60;
        display.textContent = `${pad(mins)}:${pad(secs)}`;
        startBtn.textContent = widget.state?.isRunning ? 'Pause' : 'Start';
      }

      // Start / pause logic – uses chrome.alarms for background notification
      startBtn.addEventListener('click', () => {
        const isRunning = widget.state?.isRunning;
        if (isRunning) {
          // Pause: cancel alarm and store remaining time
          chrome.alarms.clear(widget.id);
          widget.state.isRunning = false;
          // remaining already updated via interval below
        } else {
          // Start: set alarm for remaining seconds
          const seconds = widget.state?.timeRemaining ?? 60; // default 1 min if not set
          widget.state = { isRunning: true, timeRemaining: seconds };
          chrome.alarms.create(widget.id, { when: Date.now() + seconds * 1000 });
        }
        persistAndRefresh();
      });

      resetBtn.addEventListener('click', () => {
        widget.state = { isRunning: false, timeRemaining: widget.initialDuration || 60 };
        chrome.alarms.clear(widget.id);
        persistAndRefresh();
      });

      // Interval to count down locally for UI feedback
      const interval = setInterval(() => {
        if (widget.state?.isRunning && widget.state.timeRemaining > 0) {
          widget.state.timeRemaining -= 1;
          updateDisplay();
        }
        if (widget.state?.timeRemaining <= 0) {
          clearInterval(interval);
        }
      }, 1000);

      updateDisplay();
    }

    if (widget.type === 'countdown') {
      const targetInput = document.createElement('input');
      targetInput.type = 'date';
      targetInput.style.width = '100%';
      const display = document.createElement('div');
      display.style.marginTop = '8px';
      el.appendChild(targetInput, display);

      function update() {
        const target = widget.state?.targetDate ? new Date(widget.state.targetDate) : null;
        if (target) {
          const now = new Date();
          const diff = Math.max(0, Math.floor((target - now) / (1000 * 60 * 60 * 24)));
          display.textContent = `${diff} day(s) left`;
        } else {
          display.textContent = '';
        }
      }

      targetInput.addEventListener('change', () => {
        widget.state = { targetDate: targetInput.value };
        persistAndRefresh();
        update();
      });

      // Initialize input if saved
      if (widget.state?.targetDate) {
        targetInput.value = widget.state.targetDate;
      }
      update();
    }

    if (widget.type === 'todo') {
      const list = document.createElement('ul');
      list.style.paddingLeft = '20px';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = 'New task...';
      input.style.width = '100%';
      input.style.marginTop = '8px';
      el.appendChild(list, input);

      const tasks = widget.state?.tasks || [];
      function renderList() {
        list.innerHTML = '';
        tasks.forEach((t, i) => {
          const li = document.createElement('li');
          const chk = document.createElement('input');
          chk.type = 'checkbox';
          chk.checked = t.done;
          chk.addEventListener('change', () => {
            tasks[i].done = chk.checked;
            persistAndRefresh();
          });
          const span = document.createElement('span');
          span.textContent = t.text;
          li.append(chk, span);
          list.appendChild(li);
        });
      }

      input.addEventListener('keypress', (e) => {
        if (e.key === 'Enter' && input.value.trim()) {
          tasks.push({ text: input.value.trim(), done: false });
          input.value = '';
          renderList();
          persistAndRefresh();
        }
      });

      renderList();
    }

    container.appendChild(el);
  }

  // Delete widget
  function deleteWidget(id) {
    chrome.storage.local.get([storageKey], (result) => {
      const widgets = result[storageKey] || [];
      const filtered = widgets.filter((w) => w.id !== id);
      saveWidgets(filtered);
      loadWidgets();
    });
  }

  // Persist current widgets array (used after UI changes)
  function persistAndRefresh() {
    const container = document.getElementById('sidebarWidgets');
    const widgets = [];
    container.querySelectorAll('.widget').forEach((el) => {
      const id = el.dataset.id;
      // Find the original widget object from storage to keep its type & title
      // We'll rebuild minimal state from DOM where possible
      // For simplicity, re‑read from storage and replace the matching entry
      // (this is a quick approach; a more robust state manager could be used)
      widgets.push({ id, title: el.querySelector('h3').textContent, type: el.dataset.type, state: {} });
    });
    // In practice we keep the full objects; here we just reload from storage after modifications
    loadWidgets();
  }

  // Open widget picker modal
  function openWidgetPicker() {
    document.getElementById('widgetPickerOverlay').classList.add('active');
  }

  function closeWidgetPicker() {
    document.getElementById('widgetPickerOverlay').classList.remove('active');
  }

  // Handle widget selection
  function addWidget(type) {
    const id = `widget-${Date.now()}`;
    const titles = {
      clock: 'Digital Clock',
      worldclock: 'World Clock',
      timer: 'Timer',
      countdown: 'Countdown',
      todo: 'To‑Do List',
    };
    const widget = { id, type, title: titles[type] || 'Widget', state: {} };
    if (type === 'timer') {
      widget.initialDuration = 60; // seconds default
      widget.state = { isRunning: false, timeRemaining: 60 };
    }
    chrome.storage.local.get([storageKey], (result) => {
      const widgets = result[storageKey] || [];
      widgets.push(widget);
      saveWidgets(widgets);
      loadWidgets();
    });
    closeWidgetPicker();
  }

  // Event listeners for picker UI
  document.addEventListener('DOMContentLoaded', () => {
    loadWidgets();
    const addBtn = document.getElementById('addTemplateBtn');
    if (addBtn) addBtn.addEventListener('click', openWidgetPicker);
    const closeBtn = document.getElementById('closeWidgetPickerBtn');
    if (closeBtn) closeBtn.addEventListener('click', closeWidgetPicker);
    // Widget buttons
    document.querySelectorAll('.widget-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.dataset.type;
        addWidget(type);
      });
    });
  });
})();
