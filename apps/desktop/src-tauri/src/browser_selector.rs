//! Browser Element Selector — guest script builder
//!
//! Produces self-contained JavaScript strings that inject an element selector overlay into
//! the browser webview. The overlay highlights elements on hover and captures the selected
//! element's context when clicked.
//!
//! Unlike Orca (which uses `executeJavaScript()` with Promise returns), Tauri's `webview.eval()`
//! is fire-and-forget. So the injected script uses navigation interception: it assigns
//! `location.href = 'kira-select://capture/...'` and the backend's `on_navigation` callback
//! intercepts it and emits a capture event.

/// Custom-scheme prefix the injected selector script navigates to when capturing an element.
/// The backend's `on_navigation` callback intercepts URLs starting with this prefix.
pub const CAPTURE_PREFIX: &str = "kira-select://capture/";

/// Builds the ARM script that installs the selector overlay and hover tracking.
/// The script stores state on `window.__kiraSelect` for the await-click and teardown scripts.
#[allow(
    clippy::too_many_lines,
    clippy::needless_raw_string_hashes,
    reason = "self-contained guest JS held verbatim in a raw string; hashes keep it edit-safe"
)]
pub fn arm_script() -> String {
    r#"(function() {
  'use strict';

  // Tear down any pre-existing state (page could have predefined window.__kiraSelect)
  if (window.__kiraSelect) {
    try {
      if (typeof window.__kiraSelect.cleanup === 'function') {
        window.__kiraSelect.cleanup();
      }
    } catch(e) {}
    delete window.__kiraSelect;
  }

  // Budget constants (mirrored from shared types)
  var BUDGET = {
    textSnippetMaxLength: 200,
    nearbyTextEntryMaxLength: 200,
    nearbyTextMaxEntries: 10,
    htmlSnippetMaxLength: 4096,
    ancestorPathMaxEntries: 10,
    nearbyElementsMaxEntries: 6,
    nearbyElementMaxLength: 160,
    selectorMaxLength: 700,
    pathMaxLength: 900,
    cssClassesMaxLength: 500,
    selectedTextMaxLength: 500
  };
  var TEXT_NODE_SCAN_LIMIT = 80;

  // Safe attribute names
  var SAFE_ATTRS = new Set([
    'id', 'class', 'name', 'type', 'role', 'href', 'src', 'alt',
    'title', 'placeholder', 'for', 'action', 'method'
  ]);

  var SECRET_PATTERNS = [
    'access_token', 'auth_token', 'api_key', 'apikey', 'client_secret',
    'oauth_state', 'x-amz-', 'session_id', 'sessionid', 'csrf',
    'secret', 'password', 'passwd'
  ];

  var SAFE_URL_PROTOCOLS = new Set(['http:', 'https:', 'file:']);

  var STYLE_PROPS = [
    'display', 'position', 'width', 'height', 'margin', 'padding',
    'color', 'backgroundColor', 'border', 'borderRadius', 'fontFamily',
    'fontSize', 'fontWeight', 'lineHeight', 'textAlign', 'zIndex'
  ];

  // Helpers
  function clampStr(s, max) {
    if (!s || typeof s !== 'string') return '';
    if (s.length <= max) return s;
    return s.slice(0, max) + ' (truncated)';
  }

  function containsSecret(value) {
    if (!value) return false;
    var lower = value.toLowerCase();
    for (var i = 0; i < SECRET_PATTERNS.length; i++) {
      if (lower.indexOf(SECRET_PATTERNS[i]) !== -1) return true;
    }
    return false;
  }

  function sanitizeUrl(url) {
    try {
      var u = new URL(url);
      if (u.protocol === 'about:') {
        return u.toString() === 'about:blank' ? 'about:blank' : '';
      }
      if (!SAFE_URL_PROTOCOLS.has(u.protocol)) {
        return '';
      }
      u.search = '';
      u.hash = '';
      return u.toString();
    } catch (e) {
      return '';
    }
  }

  function normalizeText(text) {
    return String(text || '').trim().replace(/\s+/g, ' ');
  }

  function getBoundedText(el, max) {
    try {
      var walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      var chunks = [];
      var length = 0;
      var inspected = 0;
      var node = walker.nextNode();
      while (node && length < max + 20 && inspected < TEXT_NODE_SCAN_LIMIT) {
        inspected++;
        var separatorLength = chunks.length > 0 ? 1 : 0;
        var remaining = max + 20 - length - separatorLength;
        var text = node.textContent.trim();
        if (text.length > 0) {
          if (remaining <= 0) {
            break;
          }
          var take = Math.min(text.length, remaining);
          var piece = text.slice(0, take);
          chunks.push(piece);
          length += piece.length + separatorLength;
        }
        node = walker.nextNode();
      }
      return clampStr(normalizeText(chunks.join(' ')), max);
    } catch (e) {
      return '';
    }
  }

  function getSafeAttributes(el) {
    var attrs = {};
    if (!el || !el.attributes) return attrs;
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      var name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') continue;
      if (name.startsWith('aria-') || SAFE_ATTRS.has(name)) {
        var value = attr.value;
        if (containsSecret(name) || containsSecret(value)) {
          value = '(redacted)';
        }
        if (name === 'href' || name === 'src' || name === 'action') {
          value = sanitizeUrl(value);
        }
        attrs[name] = value;
      }
    }
    return attrs;
  }

  // Mirrors the getSafeAttributes policy, but mutates an element's own attributes in place so a
  // cloned subtree can be serialized without leaking event handlers, inline styles, secrets, or
  // unsafe URLs into the HTML snippet.
  function sanitizeAttributesInPlace(el) {
    if (!el || !el.attributes) return;
    var toRemove = [];
    for (var i = 0; i < el.attributes.length; i++) {
      var attr = el.attributes[i];
      var name = attr.name.toLowerCase();
      if (name.startsWith('on') || name === 'style') {
        toRemove.push(attr.name);
        continue;
      }
      if (!(name.startsWith('aria-') || SAFE_ATTRS.has(name))) {
        toRemove.push(attr.name);
        continue;
      }
      if (containsSecret(name) || containsSecret(attr.value)) {
        el.setAttribute(attr.name, '(redacted)');
        continue;
      }
      if (name === 'href' || name === 'src' || name === 'action') {
        el.setAttribute(attr.name, sanitizeUrl(attr.value));
      }
    }
    for (var j = 0; j < toRemove.length; j++) {
      el.removeAttribute(toRemove[j]);
    }
  }

  function getSafeHtmlSnippet(el) {
    if (!el) return '';
    try {
      var clone = el.cloneNode(true);
      sanitizeAttributesInPlace(clone);
      var descendants = clone.querySelectorAll('*');
      for (var i = 0; i < descendants.length; i++) {
        sanitizeAttributesInPlace(descendants[i]);
      }
      return clampStr(clone.outerHTML, BUDGET.htmlSnippetMaxLength);
    } catch (e) {
      return '';
    }
  }

  function getCssClasses(el) {
    if (!el || !el.className) return [];
    var className = typeof el.className === 'string' ? el.className : '';
    var classes = className.split(/\s+/).filter(Boolean);
    var result = [];
    var total = 0;
    for (var i = 0; i < classes.length; i++) {
      var cls = classes[i];
      var added = (result.length > 0 ? 1 : 0) + cls.length;
      if (total + added > BUDGET.cssClassesMaxLength) break;
      result.push(cls);
      total += added;
    }
    return result;
  }

  function getSelector(el) {
    if (!el) return '';
    var parts = [];
    var current = el;
    var length = 0;
    while (current && current.nodeType === 1 && parts.length < BUDGET.ancestorPathMaxEntries) {
      var tag = current.tagName.toLowerCase();
      var id = current.id;
      var selector = id ? (tag + '#' + id) : tag;
      var added = (parts.length > 0 ? 1 : 0) + selector.length;
      if (length + added > BUDGET.selectorMaxLength) break;
      parts.unshift(selector);
      length += added;
      current = current.parentElement;
    }
    return parts.join(' > ');
  }

  function getAncestorPath(el) {
    if (!el) return [];
    var path = [];
    var current = el.parentElement;
    while (current && current.nodeType === 1 && path.length < BUDGET.ancestorPathMaxEntries) {
      var tag = current.tagName.toLowerCase();
      var id = current.id;
      var classes = current.className && typeof current.className === 'string'
        ? current.className.split(/\s+/).filter(Boolean).slice(0, 3).join('.')
        : '';
      var part = tag + (id ? '#' + id : '') + (classes ? '.' + classes : '');
      path.unshift(part);
      current = current.parentElement;
    }
    return path;
  }

  function getNearbyElements(el) {
    if (!el || !el.parentElement) return [];
    var siblings = Array.from(el.parentElement.children);
    var index = siblings.indexOf(el);
    var nearby = [];
    for (var i = Math.max(0, index - 3); i < Math.min(siblings.length, index + 4); i++) {
      if (i === index) continue;
      nearby.push(siblings[i]);
    }
    return nearby.slice(0, BUDGET.nearbyElementsMaxEntries);
  }

  function getNearbyText(el) {
    var nearby = getNearbyElements(el);
    var results = [];
    for (var i = 0; i < nearby.length && results.length < BUDGET.nearbyTextMaxEntries; i++) {
      var text = getBoundedText(nearby[i], BUDGET.nearbyTextEntryMaxLength);
      if (text) results.push(text);
    }
    return results;
  }

  function getComputedStyles(el) {
    if (!el || !window.getComputedStyle) return {};
    try {
      var computed = window.getComputedStyle(el);
      var styles = {};
      for (var i = 0; i < STYLE_PROPS.length; i++) {
        var prop = STYLE_PROPS[i];
        styles[prop] = computed[prop] || '';
      }
      return styles;
    } catch (e) {
      return {};
    }
  }

  function getAccessibility(el) {
    if (!el) return {};
    var role = el.getAttribute('role') || el.tagName.toLowerCase();
    var label = el.getAttribute('aria-label') || el.getAttribute('title') || '';
    var describedBy = el.getAttribute('aria-describedby') || '';
    return { role: role, label: label, describedBy: describedBy };
  }

  function extractPayload(el) {
    if (!el) return null;
    var rect = el.getBoundingClientRect();
    var payload = {
      target: {
        tagName: el.tagName.toLowerCase(),
        selector: getSelector(el),
        attributes: getSafeAttributes(el),
        classes: getCssClasses(el),
        textContent: getBoundedText(el, BUDGET.textSnippetMaxLength),
        htmlSnippet: getSafeHtmlSnippet(el),
        rect: {
          x: rect.left,
          y: rect.top,
          width: rect.width,
          height: rect.height
        }
      },
      pageContext: {
        url: window.location.href,
        title: document.title,
        selectedText: clampStr(window.getSelection().toString(), BUDGET.selectedTextMaxLength)
      },
      accessibility: getAccessibility(el),
      computedStyles: getComputedStyles(el),
      ancestorPath: getAncestorPath(el),
      nearbyText: getNearbyText(el)
    };
    return payload;
  }

  // Create overlay host
  var host = document.createElement('div');
  host.id = 'kira-select-host';
  host.style.cssText = 'position:fixed;top:0;left:0;width:100vw;height:100vh;z-index:2147483647;pointer-events:none;';
  document.documentElement.appendChild(host);

  // Create highlight overlay
  var highlight = document.createElement('div');
  highlight.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #0066ff;background:rgba(0,102,255,0.1);box-sizing:border-box;transition:all 0.1s ease-out;';
  host.appendChild(highlight);

  var currentElement = null;

  function updateHighlight(el) {
    if (!el || el === host || el === highlight) {
      highlight.style.display = 'none';
      currentElement = null;
      return;
    }
    currentElement = el;
    var rect = el.getBoundingClientRect();
    highlight.style.display = 'block';
    highlight.style.left = rect.left + 'px';
    highlight.style.top = rect.top + 'px';
    highlight.style.width = rect.width + 'px';
    highlight.style.height = rect.height + 'px';
  }

  function onMouseMove(e) {
    var prev = host.style.pointerEvents;
    host.style.pointerEvents = 'none';
    var el = document.elementFromPoint(e.clientX, e.clientY);
    host.style.pointerEvents = prev;
    updateHighlight(el);
  }

  function cleanup() {
    document.removeEventListener('mousemove', onMouseMove, true);
    if (host.parentNode) {
      host.parentNode.removeChild(host);
    }
    delete window.__kiraSelect;
  }

  // Store state
  window.__kiraSelect = {
    host: host,
    highlight: highlight,
    getCurrentElement: function() { return currentElement; },
    extractPayload: extractPayload,
    cleanup: cleanup
  };

  // Install hover tracking
  document.addEventListener('mousemove', onMouseMove, true);
})();"#.to_string()
}

/// Builds the `AWAIT_CLICK` script that waits for a click and sends the capture via navigation.
#[allow(
    clippy::needless_raw_string_hashes,
    reason = "self-contained guest JS held verbatim in a raw string; hashes keep it edit-safe"
)]
pub fn await_click_script() -> String {
    r#"(function() {
  'use strict';
  var grab = window.__kiraSelect;
  if (!grab) {
    return;
  }

  function sendCapture(payload) {
    try {
      var json = JSON.stringify(payload);
      var encoded = encodeURIComponent(json);
      window.location.href = 'kira-select://capture/' + encoded;
    } catch (e) {
      grab.cleanup();
    }
  }

  function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();
    grab.host.removeEventListener('click', onClick, true);
    var el = grab.getCurrentElement();
    if (!el) {
      grab.cleanup();
      return;
    }
    try {
      var payload = grab.extractPayload(el);
      if (payload) {
        sendCapture(payload);
      }
    } catch (error) {
      grab.cleanup();
    }
  }

  grab.host.addEventListener('click', onClick, true);
  grab.host.style.pointerEvents = 'auto';
  grab.host.style.cursor = 'crosshair';
})();"#
        .to_string()
}

/// Builds the TEARDOWN script that removes the overlay and cleans up.
#[allow(
    clippy::needless_raw_string_hashes,
    reason = "self-contained guest JS held verbatim in a raw string; hashes keep it edit-safe"
)]
pub fn teardown_script() -> String {
    r#"(function() {
  'use strict';
  var grab = window.__kiraSelect;
  if (grab && typeof grab.cleanup === 'function') {
    grab.cleanup();
  }
})();"#
        .to_string()
}
