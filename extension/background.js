// Tab Out Background Service Worker

// Listen for alarms (timers)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name.startsWith('timer-')) {
    chrome.notifications.create({
      type: 'basic',
      iconUrl: 'icons/icon48.png', 
      title: 'Timer Complete',
      message: 'Your Tab Out timer has finished!',
      priority: 2,
      requireInteraction: true
    });
    
    // Attempt to update the widget state in storage to mark as finished
    chrome.storage.local.get(['tabOutWidgets'], (res) => {
      if (res.tabOutWidgets) {
        let widgets = res.tabOutWidgets;
        let updated = false;
        widgets.forEach(w => {
          if (w.id === alarm.name && w.type === 'timer') {
            w.state.isRunning = false;
            w.state.timeRemaining = 0;
            updated = true;
          }
        });
        if (updated) {
          chrome.storage.local.set({ tabOutWidgets: widgets });
        }
      }
    });
  }
});
