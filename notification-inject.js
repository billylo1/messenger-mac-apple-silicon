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

  function forwardNotify(title, options, source) {
    var opts = options || {};
    var body = opts.body != null ? String(opts.body) : '';
    var tag = opts.tag != null ? String(opts.tag) : '';
    var silent = !!opts.silent;
    var icon = typeof opts.icon === 'string' ? opts.icon : '';

    try {
      console.log('[md-notify]', source, String(title || ''), body.slice(0, 80));
    } catch (e) {}

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
      if (!title) return 0;
      var m = String(title).match(/^\((\d+)\)/);
      return m ? parseInt(m[1], 10) : 0;
    }

    function isBoringTitle(title) {
      return !title || title === 'Messenger' || title === 'Messenger for Mac' || /^\(\d+\)\s*Messenger/.test(title);
    }

    function notifyFromTitle(title, reason) {
      // Only while page is considered backgrounded (spoofed by main process).
      if (!document.hidden) return;

      var now = Date.now();
      var body;
      var count = parseBadge(title);

      if (!isBoringTitle(title) && !/^\(\d+\)/.test(title)) {
        // e.g. "Alice messaged you"
        body = title;
      } else if (count > lastBadge && count > 0) {
        body = count === 1 ? 'You have a new message' : 'You have ' + count + ' new messages';
      } else {
        return;
      }

      if (body === lastTitleBody && now - lastTitleNotifyAt < 4000) return;
      lastTitleBody = body;
      lastTitleNotifyAt = now;

      forwardNotify('Messenger', { body: body, tag: 'title-' + reason }, 'title');
    }

    var lastSeenTitle = null;

    function updateBadge() {
      var title = document.title || '';
      var count = parseBadge(title);

      if (window.messengerDesktop && window.messengerDesktop.setBadge) {
        window.messengerDesktop.setBadge(count);
      }

      // Only act on title changes — the poll interval must not spam alerts.
      if (title !== lastSeenTitle) {
        var prevBadge = lastBadge;
        lastSeenTitle = title;

        if (!/^\(\d+\)/.test(title)) {
          notifyFromTitle(title, 'title-text');
        } else if (prevBadge >= 0 && count > prevBadge) {
          notifyFromTitle(title, 'badge-up');
        }
      }

      lastBadge = count;
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
      lastBadge = parseBadge(document.title || '');
      lastSeenTitle = document.title || '';
      updateBadge();
    }

    if (document.documentElement) {
      observeTitle();
    }
    document.addEventListener('DOMContentLoaded', observeTitle);
    setInterval(updateBadge, 1500);
  }
})();
