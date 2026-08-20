// Runs in the page world (main frame + iframes). No Node/Electron APIs.
// Relies on window.messengerDesktop when the preload bridge is present;
// otherwise relays to window.top via postMessage.
//
// Messenger often never calls Notification API inside an Electron shell.
// We hijack Notification/SW when it does, and also synthesize native alerts
// from document.title unread changes while the window is "hidden".

(function () {
  if (window.__messengerDesktopInjected) return;
  window.__messengerDesktopInjected = true;

  var lastBadge = -1;
  var lastTitleNotifyAt = 0;
  var lastTitleBody = '';
  // Personal titles already alerted for this unread episode (cleared when badge → 0).
  var notifiedPersonal = Object.create(null);
  // Suppress title synthesis briefly after a real Notification/SW alert.
  var lastApiNotifyAt = 0;

  function forwardNotify(title, options, source) {
    var opts = options || {};
    var body = opts.body != null ? String(opts.body) : '';
    var tag = opts.tag != null ? String(opts.tag) : '';
    var silent = !!opts.silent;
    var icon = typeof opts.icon === 'string' ? opts.icon : '';

    try {
      console.log('[md-notify]', source, String(title || ''), body.slice(0, 80));
    } catch (e) {}

    if (source === 'Notification' || source === 'SW' || source === 'iframe') {
      lastApiNotifyAt = Date.now();
    }

    // Cross-origin iframes may lack the preload bridge — relay to top frame.
    if (window !== window.top && !(window.messengerDesktop && window.messengerDesktop.notify)) {
      try {
        window.top.postMessage({
          type: '__md_notif__',
          title: String(title || ''),
          body: body,
          tag: tag,
          silent: silent,
          icon: icon,
          source: source
        }, '*');
      } catch (e) {}
      return;
    }

    if (window.messengerDesktop && window.messengerDesktop.notify) {
      window.messengerDesktop.notify({
        title: String(title || 'Messenger'),
        body: body,
        tag: tag,
        silent: silent,
        icon: icon,
        source: source
      });
    }
  }

  // Messenger gates on permissions.query — always report granted.
  try {
    if (navigator.permissions && navigator.permissions.query) {
      var origQuery = navigator.permissions.query.bind(navigator.permissions);
      navigator.permissions.query = function (desc) {
        if (desc && desc.name === 'notifications') {
          return Promise.resolve({
            state: 'granted',
            status: 'granted',
            onchange: null,
            addEventListener: function () {},
            removeEventListener: function () {},
            dispatchEvent: function () { return false; }
          });
        }
        return origQuery(desc);
      };
    }
  } catch (e) {}

  var OrigNotification = window.Notification;
  function HijackedNotification(title, options) {
    forwardNotify(title, options, 'Notification');
    return {
      close: function () {},
      addEventListener: function () {},
      removeEventListener: function () {},
      dispatchEvent: function () { return false; },
      onclick: null,
      onclose: null,
      onerror: null,
      onshow: null
    };
  }
  HijackedNotification.permission = 'granted';
  HijackedNotification.maxActions = OrigNotification ? OrigNotification.maxActions : 0;
  HijackedNotification.requestPermission = function () {
    return Promise.resolve('granted');
  };

  function installNotificationHooks() {
    window.Notification = HijackedNotification;
    try {
      if (typeof ServiceWorkerRegistration !== 'undefined') {
        ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
          forwardNotify(title, options || {}, 'SW');
          return Promise.resolve();
        };
      }
    } catch (e) {}
  }
  installNotificationHooks();

  // Meta sometimes restores window.Notification after boot — keep ours in place.
  setInterval(function () {
    if (window.Notification !== HijackedNotification) {
      installNotificationHooks();
    }
  }, 2000);

  if (window === window.top) {
    window.addEventListener('message', function (e) {
      if (!e.data || e.data.type !== '__md_notif__') return;
      forwardNotify(
        e.data.title,
        {
          body: e.data.body,
          tag: e.data.tag,
          silent: e.data.silent,
          icon: e.data.icon
        },
        e.data.source || 'iframe'
      );
    });

    function parseBadge(title) {
      if (!title) return null;
      var m = String(title).match(/^\((\d+)\)/);
      return m ? parseInt(m[1], 10) : null;
    }

    function isPlainMessenger(title) {
      return title === 'Messenger' || title === 'Messenger for Mac';
    }

    function isBoringTitle(title) {
      return !title || isPlainMessenger(title) || /^\(\d+\)\s*Messenger/.test(title);
    }

    // Temporary badge-less titles Messenger uses while announcing unread.
    // Must NOT clear the dock badge (that caused the notify storm when titles
    // oscillated), but conversation names / inbox titles SHOULD clear it.
    function isTransientAlertTitle(title) {
      if (!title || isBoringTitle(title) || parseBadge(title) !== null) return false;
      return /messaged you|sent you|sent a |sent an |sent you a |sent you an /i.test(title);
    }

    function applyDockBadge(count) {
      if (window.messengerDesktop && window.messengerDesktop.setBadge) {
        window.messengerDesktop.setBadge(count > 0 ? count : 0);
      }
    }

    function clearUnreadState() {
      lastBadge = 0;
      notifiedPersonal = Object.create(null);
      applyDockBadge(0);
    }

    function notifyFromTitle(title, reason, count) {
      // Only while page is considered backgrounded (spoofed by main process).
      if (!document.hidden) return;

      // Real Notification/SW already alerted — skip synthetic title spam.
      if (Date.now() - lastApiNotifyAt < 8000) return;

      var now = Date.now();
      var body;

      if (!isBoringTitle(title) && parseBadge(title) === null) {
        // e.g. "Alice messaged you"
        body = title;
        if (notifiedPersonal[body]) return;
      } else if (typeof count === 'number' && count > lastBadge && count > 0) {
        body = count === 1 ? 'You have a new message' : 'You have ' + count + ' new messages';
      } else {
        return;
      }

      if (body === lastTitleBody && now - lastTitleNotifyAt < 15000) return;
      lastTitleBody = body;
      lastTitleNotifyAt = now;
      if (parseBadge(title) === null && !isBoringTitle(title)) {
        notifiedPersonal[body] = true;
      }

      forwardNotify('Messenger', { body: body, tag: 'title-' + reason }, 'title');
    }

    var lastSeenTitle = null;

    function updateBadge() {
      var title = document.title || '';
      var count = parseBadge(title);
      var hasBadge = count !== null;
      var focused = !document.hidden;
      var prevBadge = lastBadge;
      var titleChanged = title !== lastSeenTitle;
      if (titleChanged) lastSeenTitle = title;

      // Dock badge sync:
      // - "(N) …" → N (covers decreases when read elsewhere)
      // - focused + no count → clear (read in-app / chat title)
      // - plain "Messenger" → clear (inbox caught up, including while backgrounded)
      // - other background titles (e.g. "Alice messaged you") → keep count
      if (hasBadge) {
        lastBadge = count;
        applyDockBadge(count);
        if (count === 0) {
          notifiedPersonal = Object.create(null);
        }
      } else if (focused || isPlainMessenger(title)) {
        clearUnreadState();
      }

      if (titleChanged) {
        if (!hasBadge && isTransientAlertTitle(title)) {
          notifyFromTitle(title, 'title-text', prevBadge);
          // Personal titles omit the unread count. Bump lastBadge so a following
          // "(1) Messenger" title does not look like a brand-new badge increase.
          if (lastBadge < 1) lastBadge = 1;
        } else if (hasBadge && prevBadge >= 0 && count > prevBadge) {
          notifyFromTitle(title, 'badge-up', count);
        }
      }
    }

    function observeTitle() {
      var el = document.querySelector('title');
      if (!el || el.__mdBadgeObserved) return;
      el.__mdBadgeObserved = true;
      new MutationObserver(updateBadge).observe(el, {
        childList: true,
        characterData: true,
        subtree: true
      });
      var initial = parseBadge(document.title || '');
      lastBadge = initial !== null ? initial : 0;
      lastSeenTitle = document.title || '';
      updateBadge();
    }

    // When the window becomes focused, force a resync so a stale dock badge
    // cannot linger after messages were read in-app or on another device.
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) updateBadge();
    });

    if (document.documentElement) {
      observeTitle();
    }
    document.addEventListener('DOMContentLoaded', observeTitle);
    setInterval(updateBadge, 1500);
  }
})();
