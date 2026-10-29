(() => {
  if (window.__integrationAudit) return;
  const audit = window.__integrationAudit = { violations: [], errors: [], rejections: [], resizeTargets: 0, rafScheduled: 0, rafPending: 0, globalListeners: 0, timeouts: 0, intervals: 0 };
  document.addEventListener('securitypolicyviolation', event => audit.violations.push({ directive: event.effectiveDirective, blocked: event.blockedURI, source: event.sourceFile, line: event.lineNumber }));
  window.addEventListener('error', event => audit.errors.push(event.message));
  window.addEventListener('unhandledrejection', event => audit.rejections.push(String(event.reason)));
  // Count only externally rooted listeners. DOM delegation on collectible elements is outside this probe.
  const add = EventTarget.prototype.addEventListener, remove = EventTarget.prototype.removeEventListener;
  const listeners = [];
  const capture = options => typeof options === 'boolean' ? options : Boolean(options && options.capture);
  const trackedTarget = target => target === window || target === document || target === window.visualViewport || target === document.fonts || (typeof MediaQueryList !== 'undefined' && target instanceof MediaQueryList);
  const forget = record => { const index = listeners.indexOf(record); if (index !== -1) { listeners.splice(index, 1); audit.globalListeners--; } };
  EventTarget.prototype.addEventListener = function(type, listener, options) {
    if (!listener || !trackedTarget(this)) return add.call(this, type, listener, options);
    const found = listeners.find(record => record.target === this && record.type === type && record.listener === listener && record.capture === capture(options));
    if (found) return add.call(this, type, found.wrapped, options);
    const record = { target: this, type, listener, capture: capture(options), wrapped: listener };
    if (typeof options === 'object' && options.once) record.wrapped = function(event) { forget(record); if (typeof listener === 'function') listener.call(this, event); else listener.handleEvent(event); };
    listeners.push(record); audit.globalListeners++;
    return add.call(this, type, record.wrapped, options);
  };
  EventTarget.prototype.removeEventListener = function(type, listener, options) {
    const found = listeners.find(record => record.target === this && record.type === type && record.listener === listener && record.capture === capture(options));
    if (found) { forget(found); return remove.call(this, type, found.wrapped, options); }
    return remove.call(this, type, listener, options);
  };
  const timeout = window.setTimeout.bind(window), clearTimeoutNative = window.clearTimeout.bind(window), interval = window.setInterval.bind(window), clearIntervalNative = window.clearInterval.bind(window);
  const timeouts = new Set(), intervals = new Set();
  window.setTimeout = (callback, delay, ...args) => {
    if (typeof callback !== 'function') return timeout(callback, delay, ...args);
    const id = timeout((...values) => { timeouts.delete(id); audit.timeouts = timeouts.size; callback(...values); }, delay, ...args);
    timeouts.add(id); audit.timeouts = timeouts.size; return id;
  };
  window.clearTimeout = id => { timeouts.delete(id); audit.timeouts = timeouts.size; clearTimeoutNative(id); };
  window.setInterval = (callback, delay, ...args) => { const id = interval(callback, delay, ...args); intervals.add(id); audit.intervals = intervals.size; return id; };
  window.clearInterval = id => { intervals.delete(id); audit.intervals = intervals.size; clearIntervalNative(id); };
  const Resize = window.ResizeObserver;
  window.ResizeObserver = class extends Resize {
    observed = new Set();
    observe(target, options) { if (!this.observed.has(target)) { this.observed.add(target); audit.resizeTargets++; } super.observe(target, options); }
    unobserve(target) { if (this.observed.delete(target)) audit.resizeTargets--; super.unobserve(target); }
    disconnect() { audit.resizeTargets -= this.observed.size; this.observed.clear(); super.disconnect(); }
  };
  const raf = window.requestAnimationFrame.bind(window), cancel = window.cancelAnimationFrame.bind(window), pending = new Set();
  window.requestAnimationFrame = callback => { audit.rafScheduled++; const id = raf(time => { pending.delete(id); audit.rafPending = pending.size; callback(time); }); pending.add(id); audit.rafPending = pending.size; return id; };
  window.cancelAnimationFrame = id => { pending.delete(id); audit.rafPending = pending.size; cancel(id); };
})();
