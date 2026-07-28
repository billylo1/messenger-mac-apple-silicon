// Runs in the page world (main frame + iframes). No Node/Electron APIs.
// Relies on window.messengerDesktop when the preload bridge is present;
// otherwise relays to window.top via postMessage.

(function () {
  if (window.__messengerDesktopInjected) return;
  window.__messengerDesktopInjected = true;

  function forwardNotify(title, options, source) {
    var opts = options || {};
    var body = opts.body != null ? String(opts.body) : '';
    var tag = opts.tag != null ? String(opts.tag) : '';
    var silent = !!opts.silent;
    var icon = typeof opts.icon === 'string' ? opts.icon : '';

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
  window.Notification = HijackedNotification;

  try {
    if (typeof ServiceWorkerRegistration !== 'undefined') {
      ServiceWorkerRegistration.prototype.showNotification = function (title, options) {
        forwardNotify(title, options || {}, 'SW');
        return Promise.resolve();
      };
    }
  } catch (e) {}

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

    function updateBadge() {
      if (window.messengerDesktop && window.messengerDesktop.setBadge) {
        window.messengerDesktop.setBadge(parseBadge(document.title));
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
      updateBadge();
    }

    if (document.documentElement) {
      observeTitle();
    }
    document.addEventListener('DOMContentLoaded', observeTitle);
    setInterval(updateBadge, 2000);
  }
})();
