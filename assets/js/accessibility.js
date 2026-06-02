/* ============================================================================
 * accessibility.js
 *
 * Adaptive accessibility layer.
 *
 *   StruggleDetector  — listens for behavior signals (mouse, scroll, focus,
 *                       hover, idle, jitter) and accumulates a decaying score.
 *   PromptController  — renders the suggestion UI; honors snooze/opt-out;
 *                       can anchor near the area of struggle.
 *   StateManager      — localStorage persistence for preferences.
 *   ModeApplicator    — toggles the reduced-noise mode on <html>, fires a
 *                       `a11y:mode-change` event, and runs registered hooks
 *                       so Three.js scenes (or any component) can respond.
 *
 * Public API on `window.A11y`:
 *   A11y.enable()                           — turn reduced-noise mode on
 *   A11y.disable()                          — turn it off
 *   A11y.toggle()                           — flip
 *   A11y.isEnabled()                        — boolean
 *   A11y.register({onEnable, onDisable})    — subscribe a component (returns unsubscribe fn)
 *   A11y.onChange(fn)                       — subscribe to mode changes (returns unsubscribe)
 *   A11y.reset()                            — clear stored preferences
 *   A11y.showPromptNow()                    — for testing
 *   A11y.getScore()                         — current struggle score (debugging)
 *
 * Custom event:
 *   document.dispatchEvent('a11y:mode-change', {detail: {enabled: boolean}})
 *
 * Storage keys (under `a11y:` namespace):
 *   a11y:reduced     "1" | "0"        — user preference
 *   a11y:optOut      "1"              — never auto-prompt again
 *   a11y:snoozeUntil <timestamp ms>   — auto-prompt suppressed until then
 * ============================================================================ */

(function (global) {
  'use strict';

  // -------------------------------------------------------------------------
  // Configuration. Tuned conservatively — prefer false negatives (no prompt)
  // over false positives (annoying prompt).
  // -------------------------------------------------------------------------
  const CONFIG = Object.freeze({
    SCORE_THRESHOLD: 100,        // total score that triggers the prompt
    SCORE_DECAY_PER_SEC: 0.92,   // multiplicative decay applied each second
    SCORE_TICK_MS: 1000,
    PROMPT_COOLDOWN_MS: 90_000,  // after dismiss, pause auto-detection this long
    SNOOZE_DURATION_MS: 24 * 3600 * 1000,
    MIN_DWELL_BEFORE_PROMPT_MS: 6_000, // don't prompt during the first few seconds
    HOVER_REPEAT_WINDOW_MS: 6_000,
    HOVER_REPEAT_THRESHOLD: 3,
    SCROLL_OSC_WINDOW_MS: 1_200, // window for detecting up-down-up scroll
    JITTER_WINDOW_MS: 80,
    JITTER_DISTANCE_PX: 6,
    JITTER_REVERSALS_THRESHOLD: 4,
    IDLE_NO_INTERACTION_MS: 12_000,
    FOCUS_BLUR_REPEAT_THRESHOLD: 2,
    NS: 'a11y:',
  });

  // -------------------------------------------------------------------------
  // StateManager
  // -------------------------------------------------------------------------
  const StateManager = (() => {
    const safeGet = (k) => {
      try { return localStorage.getItem(CONFIG.NS + k); } catch (_) { return null; }
    };
    const safeSet = (k, v) => {
      try { localStorage.setItem(CONFIG.NS + k, v); } catch (_) {}
    };
    const safeRemove = (k) => {
      try { localStorage.removeItem(CONFIG.NS + k); } catch (_) {}
    };

    return {
      isReduced()      { return safeGet('reduced') === '1'; },
      setReduced(on)   { safeSet('reduced', on ? '1' : '0'); },
      isOptedOut()     { return safeGet('optOut') === '1'; },
      setOptedOut()    { safeSet('optOut', '1'); },
      isSnoozed() {
        const v = parseInt(safeGet('snoozeUntil') || '0', 10);
        return Number.isFinite(v) && v > Date.now();
      },
      snooze(ms) { safeSet('snoozeUntil', String(Date.now() + ms)); },
      reset() {
        safeRemove('reduced');
        safeRemove('optOut');
        safeRemove('snoozeUntil');
      },
    };
  })();

  // -------------------------------------------------------------------------
  // ExitPill — small floating "Exit Reading Mode" button shown only while
  // calm mode is active, so users have a one-click way back to the full
  // experience. CSS handles its visibility via [data-a11y-mode="reduced"].
  // -------------------------------------------------------------------------
  const ExitPill = (() => {
    let btn = null;
    function ensure() {
      if (btn) return btn;
      btn = document.createElement('button');
      btn.className = 'a11y-exit';
      btn.type = 'button';
      btn.textContent = 'Exit Reading Mode';
      btn.setAttribute('aria-label', 'Exit Reading Mode and return to the full site');
      btn.addEventListener('click', () => ModeApplicator.apply(false));
      document.body.appendChild(btn);
      return btn;
    }
    function sync(enabled) {
      // Mount lazily; CSS handles show/hide via the root attribute.
      if (enabled) ensure();
    }
    return { sync };
  })();

  // -------------------------------------------------------------------------
  // VoiceReader — browser-native read-aloud, available only in Reading Mode.
  //
  // Uses window.speechSynthesis (Web Speech API). We walk the main content
  // sections in document order, build a queue of readable blocks (headings,
  // paragraphs, list items, role/company/project titles, etc.), then speak
  // each one as a separate SpeechSynthesisUtterance. Per-block utterances:
  //   - sidestep the Chrome ~15s auto-pause bug for long monologues
  //   - let us highlight the *currently* spoken element
  //   - let us implement Skip / Pause / Resume cleanly
  // -------------------------------------------------------------------------
  const VoiceReader = (() => {
    const SUPPORTED = typeof window !== 'undefined' && 'speechSynthesis' in window;

    // Order matters — we read top-to-bottom through the page.
    const SECTION_ORDER = [
      '#hero', '#about', '#skills', '#experience',
      '#projects', '#education', '#contact',
    ];
    // Within each section, these selectors define the readable units.
    const READABLE_SEL = [
      'h1', 'h2', 'h3', 'h4',
      'p',
      'li',
      '.exp-role', '.exp-company', '.exp-date', '.exp-type',
      '.proj-name', '.proj-domain', '.proj-desc',
      '.skill-name', '.skill-desc',
      '.edu-degree', '.edu-uni', '.edu-quote',
      '.about-body', '.about-stat-label',
      '.hero-sub', '.contact-desc',
    ].join(', ');

    let queue = [];      // [{el, text}]
    let idx = 0;
    let playing = false;
    let paused = false;
    let controls = null;
    let label = null;
    // Set to true right before we call speechSynthesis.cancel() so the
    // utterance's onend handler knows the end was forced (don't auto-advance).
    let suppressEndOnce = false;

    function collect() {
      const seen = new WeakSet();
      const out = [];
      SECTION_ORDER.forEach((sel) => {
        const sec = document.querySelector(sel);
        if (!sec) return;
        sec.querySelectorAll(READABLE_SEL).forEach((el) => {
          if (seen.has(el)) return;
          // Skip if any ancestor is already queued — we read the outer block
          // (e.g. <li>) and don't want to also read its nested <span>s.
          let p = el.parentElement;
          while (p) { if (seen.has(p)) return; p = p.parentElement; }
          const txt = (el.innerText || el.textContent || '').replace(/\s+/g, ' ').trim();
          if (txt && txt.length > 1) {
            seen.add(el);
            out.push({ el, text: txt });
          }
        });
      });
      return out;
    }

    function highlight(item, on) {
      if (item && item.el) item.el.classList.toggle('a11y-speaking', !!on);
    }
    function clearAllHighlights() {
      document.querySelectorAll('.a11y-speaking').forEach((el) => {
        el.classList.remove('a11y-speaking');
      });
    }

    function speakNext() {
      if (idx >= queue.length) { stop(); return; }
      const item = queue[idx];
      highlight(item, true);
      try {
        item.el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch (_) {}

      const u = new SpeechSynthesisUtterance(item.text);
      u.lang = 'en-US';
      u.rate = 1.0;
      u.pitch = 1.0;
      u.volume = 1.0;
      const handleEnd = () => {
        highlight(item, false);
        // If we just cancelled deliberately (stop / skip), don't auto-advance.
        if (suppressEndOnce) { suppressEndOnce = false; return; }
        idx++;
        if (playing && !paused) speakNext();
      };
      u.onend = handleEnd;
      u.onerror = handleEnd;
      window.speechSynthesis.speak(u);
    }

    function play() {
      if (!SUPPORTED) return;
      if (paused) {
        // Resume a paused utterance instead of restarting.
        window.speechSynthesis.resume();
        paused = false;
        updateUI();
        return;
      }
      // Fresh run from the top — make sure any prior session is cleared.
      if (playing) {
        suppressEndOnce = true;
        window.speechSynthesis.cancel();
      } else {
        window.speechSynthesis.cancel();
      }
      queue = collect();
      if (!queue.length) return;
      idx = 0;
      playing = true;
      paused = false;
      updateUI();
      speakNext();
    }

    function pause() {
      if (!SUPPORTED || !playing) return;
      window.speechSynthesis.pause();
      paused = true;
      updateUI();
    }

    function stop() {
      if (!SUPPORTED) return;
      if (window.speechSynthesis.speaking || window.speechSynthesis.pending) {
        suppressEndOnce = true;
        window.speechSynthesis.cancel();
      }
      clearAllHighlights();
      queue = []; idx = 0; playing = false; paused = false;
      updateUI();
    }

    function skip() {
      if (!SUPPORTED || !playing) return;
      const item = queue[idx];
      highlight(item, false);
      suppressEndOnce = true;
      window.speechSynthesis.cancel();
      idx++;
      if (idx < queue.length) {
        // If paused, just stage the next one and stay paused-ish: simplest
        // behaviour is to resume playback on skip.
        paused = false;
        speakNext();
      } else {
        stop();
      }
    }

    function updateUI() {
      if (!controls) return;
      const playBtn = controls.querySelector('[data-action="play"]');
      const skipBtn = controls.querySelector('[data-action="skip"]');
      const stopBtn = controls.querySelector('[data-action="stop"]');
      const isLivePlaying = playing && !paused;
      playBtn.textContent = isLivePlaying ? '⏸' : '▶';
      playBtn.setAttribute(
        'aria-label',
        isLivePlaying ? 'Pause read aloud'
          : paused ? 'Resume read aloud' : 'Start read aloud'
      );
      controls.classList.toggle('is-playing', isLivePlaying);
      controls.classList.toggle('is-paused', paused);
      skipBtn.disabled = !playing;
      stopBtn.disabled = !playing;
      if (label) {
        label.textContent = isLivePlaying ? 'Reading…'
                          : paused ? 'Paused'
                          : 'Read Aloud';
      }
    }

    function ensure() {
      if (controls || !SUPPORTED) return controls;
      controls = document.createElement('div');
      controls.className = 'a11y-voice';
      controls.setAttribute('role', 'toolbar');
      controls.setAttribute('aria-label', 'Read aloud controls');
      controls.innerHTML = `
        <button type="button" class="a11y-voice__btn" data-action="play"
                aria-label="Start read aloud">▶</button>
        <button type="button" class="a11y-voice__btn" data-action="skip"
                aria-label="Skip current paragraph" disabled>⏭</button>
        <button type="button" class="a11y-voice__btn" data-action="stop"
                aria-label="Stop read aloud" disabled>⏹</button>
        <span class="a11y-voice__label">Read Aloud</span>
      `;
      label = controls.querySelector('.a11y-voice__label');
      controls.addEventListener('click', (e) => {
        const b = e.target.closest('[data-action]');
        if (!b || b.disabled) return;
        const action = b.dataset.action;
        if (action === 'play') (playing && !paused) ? pause() : play();
        else if (action === 'skip') skip();
        else if (action === 'stop') stop();
      });
      document.body.appendChild(controls);

      // Safety: stop speaking if the user leaves the tab.
      window.addEventListener('beforeunload', stop);
      document.addEventListener('visibilitychange', () => {
        if (document.hidden && playing && !paused) pause();
      });
      return controls;
    }

    function sync(enabled) {
      if (enabled && SUPPORTED) ensure();
      else if (!enabled && playing) stop();
    }

    return { sync, play, pause, stop, skip, isSupported: () => SUPPORTED };
  })();

  // -------------------------------------------------------------------------
  // ModeApplicator — single source of truth for reduced-noise on/off.
  // -------------------------------------------------------------------------
  const ModeApplicator = (() => {
    const subscribers = new Set();          // {onEnable?, onDisable?}
    const changeListeners = new Set();      // (enabled) => void
    let enabled = false;

    function notify() {
      // 1. Run component hooks (Three.js scenes, custom widgets).
      subscribers.forEach((sub) => {
        try {
          if (enabled && typeof sub.onEnable === 'function') sub.onEnable();
          if (!enabled && typeof sub.onDisable === 'function') sub.onDisable();
        } catch (err) {
          // A misbehaving subscriber must not break the system.
          console.error('[a11y] subscriber threw:', err);
        }
      });
      // 2. Generic change listeners.
      changeListeners.forEach((fn) => { try { fn(enabled); } catch (e) {} });
      // 3. Public DOM event for any listener that prefers vanilla events.
      document.dispatchEvent(new CustomEvent('a11y:mode-change', {
        detail: { enabled },
      }));
    }

    function apply(on) {
      enabled = !!on;
      const root = document.documentElement;
      if (enabled) root.setAttribute('data-a11y-mode', 'reduced');
      else root.removeAttribute('data-a11y-mode');
      // Keep legacy class in sync for older portfolio CSS.
      document.body.classList.toggle('a11y-reduce-bg', enabled);
      StateManager.setReduced(enabled);
      ExitPill.sync(enabled);
      VoiceReader.sync(enabled);
      notify();
    }

    function register(sub) {
      subscribers.add(sub);
      // If we're already enabled when a component registers late, give it
      // its onEnable immediately so it can sync state.
      if (enabled && typeof sub.onEnable === 'function') {
        try { sub.onEnable(); } catch (e) {}
      }
      return () => subscribers.delete(sub);
    }

    function onChange(fn) {
      changeListeners.add(fn);
      return () => changeListeners.delete(fn);
    }

    return {
      isEnabled: () => enabled,
      apply,
      register,
      onChange,
    };
  })();

  // -------------------------------------------------------------------------
  // StruggleDetector — accumulates a decaying score from behavior signals.
  // -------------------------------------------------------------------------
  const StruggleDetector = (() => {
    const startedAt = Date.now();
    let score = 0;
    let lastInteraction = Date.now();
    let lastSignalEl = null; // for context-aware anchoring

    // Signal-specific state.
    const hoverHistory = new Map(); // el -> [timestamps]
    let lastScrollY = window.scrollY;
    let scrollDirHistory = [];      // [{dir, t}]
    let lastMouse = null;           // {x, y, t}
    let jitterReversals = 0;
    let jitterWindowStart = 0;
    let lastJitterDir = null;       // -1 | 1 | null per axis (we use Manhattan)
    const focusBlurHistory = new Map(); // el -> count

    // ---- score helpers ----
    function add(points, sourceEl) {
      score += points;
      if (sourceEl) lastSignalEl = sourceEl;
    }
    function tick() {
      score *= CONFIG.SCORE_DECAY_PER_SEC;
      if (score < 0.1) score = 0;
      if (
        score >= CONFIG.SCORE_THRESHOLD &&
        Date.now() - startedAt >= CONFIG.MIN_DWELL_BEFORE_PROMPT_MS
      ) {
        PromptController.maybeShow(lastSignalEl);
        // Reset to avoid immediately re-triggering on the next tick.
        score = 0;
      }
    }

    // ---- 1. Mouse movement without clicks ----
    let mouseDistance = 0;
    let lastClickTime = 0;
    function onMouseMove(e) {
      const now = performance.now();
      if (lastMouse) {
        const dx = e.clientX - lastMouse.x;
        const dy = e.clientY - lastMouse.y;
        const dt = now - lastMouse.t;
        const d = Math.hypot(dx, dy);
        mouseDistance += d;

        // Pointer jitter: rapid direction reversals over a short window.
        // We approximate "reversal" by the sign of dx+dy flipping inside
        // a tight time window with non-trivial per-step distance.
        const dir = Math.sign(dx + dy);
        if (dir !== 0) {
          if (
            lastJitterDir !== null &&
            dir !== lastJitterDir &&
            d >= 1 &&
            now - jitterWindowStart < CONFIG.JITTER_WINDOW_MS
          ) {
            jitterReversals++;
            if (jitterReversals >= CONFIG.JITTER_REVERSALS_THRESHOLD) {
              add(18, e.target);
              jitterReversals = 0;
            }
          } else if (now - jitterWindowStart >= CONFIG.JITTER_WINDOW_MS) {
            jitterWindowStart = now;
            jitterReversals = 0;
          }
          lastJitterDir = dir;
        }

        // Movement-without-click: penalize sustained motion since last click.
        if (now - lastClickTime > 2000 && mouseDistance > 600) {
          add(8, e.target);
          mouseDistance = 0;
        }
      }
      lastMouse = { x: e.clientX, y: e.clientY, t: now };
      lastInteraction = Date.now();
    }
    function onClick() {
      lastClickTime = performance.now();
      mouseDistance = 0;
      lastInteraction = Date.now();
    }

    // ---- 2. Repeated hover over same element ----
    function onMouseEnter(e) {
      const el = e.target;
      if (!(el instanceof Element)) return;
      // Only track elements that look like content the user might be
      // re-reading (not the whole document).
      if (!el.matches('p, li, h1, h2, h3, h4, [data-accessible], [data-a11y-track]')) {
        return;
      }
      const now = Date.now();
      const arr = hoverHistory.get(el) || [];
      const fresh = arr.filter((t) => now - t < CONFIG.HOVER_REPEAT_WINDOW_MS);
      fresh.push(now);
      hoverHistory.set(el, fresh);
      if (fresh.length >= CONFIG.HOVER_REPEAT_THRESHOLD) {
        add(22, el);
        hoverHistory.set(el, []); // reset so we don't fire again next tick
      }
    }

    // ---- 3. Rapid scroll oscillation ----
    function onScroll() {
      const y = window.scrollY;
      const dir = Math.sign(y - lastScrollY);
      lastScrollY = y;
      if (dir === 0) return;
      const now = Date.now();
      scrollDirHistory.push({ dir, t: now });
      // Trim outside the window.
      scrollDirHistory = scrollDirHistory.filter(
        (s) => now - s.t < CONFIG.SCROLL_OSC_WINDOW_MS
      );
      // Count direction flips in the window.
      let flips = 0;
      for (let i = 1; i < scrollDirHistory.length; i++) {
        if (scrollDirHistory[i].dir !== scrollDirHistory[i - 1].dir) flips++;
      }
      if (flips >= 2) {
        // up -> down -> up (or vice versa) inside ~1.2s = scanning confusion
        add(20);
        scrollDirHistory = [];
      }
      lastInteraction = now;
    }

    // ---- 4. Long dwell time without interaction ----
    function checkIdle() {
      if (Date.now() - lastInteraction >= CONFIG.IDLE_NO_INTERACTION_MS) {
        // Only contribute once per idle stretch.
        add(12);
        lastInteraction = Date.now() - CONFIG.IDLE_NO_INTERACTION_MS / 2;
      }
    }

    // ---- 5. Repeated focus/blur on text elements ----
    function onFocus(e) {
      const el = e.target;
      if (!(el instanceof Element)) return;
      if (!el.matches('input, textarea, [contenteditable], [data-a11y-track]')) return;
      const n = (focusBlurHistory.get(el) || 0) + 1;
      focusBlurHistory.set(el, n);
      if (n >= CONFIG.FOCUS_BLUR_REPEAT_THRESHOLD * 2) { // focus+blur = 2 events
        add(15, el);
        focusBlurHistory.set(el, 0);
      }
      lastInteraction = Date.now();
    }

    // ---- lifecycle ----
    let started = false;
    let tickHandle = null;
    let idleHandle = null;

    function start() {
      if (started) return;
      started = true;
      window.addEventListener('mousemove', onMouseMove, { passive: true });
      window.addEventListener('click', onClick, { passive: true });
      window.addEventListener('scroll', onScroll, { passive: true });
      // mouseover bubbles where mouseenter doesn't — cheaper for a single listener.
      window.addEventListener('mouseover', onMouseEnter, { passive: true });
      window.addEventListener('focusin', onFocus, true);
      window.addEventListener('focusout', onFocus, true);

      tickHandle = setInterval(tick, CONFIG.SCORE_TICK_MS);
      idleHandle = setInterval(checkIdle, 2000);
    }

    function stop() {
      started = false;
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('click', onClick);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('mouseover', onMouseEnter);
      window.removeEventListener('focusin', onFocus, true);
      window.removeEventListener('focusout', onFocus, true);
      clearInterval(tickHandle);
      clearInterval(idleHandle);
    }

    return {
      start,
      stop,
      getScore: () => score,
      getLastSignalEl: () => lastSignalEl,
      // For tests/debugging — let callers nudge the score.
      _add: add,
    };
  })();

  // -------------------------------------------------------------------------
  // PromptController — DOM rendering, focus management, lifecycle.
  // -------------------------------------------------------------------------
  const PromptController = (() => {
    let root = null;
    let visible = false;
    let activeInteraction = false; // suppress while user is mid-action
    let lastFocusedBeforeOpen = null;

    // The user is "actively interacting" if they've recently fired an input
    // event on a form control or are mid-drag. We don't want to interrupt that.
    document.addEventListener('input', () => {
      activeInteraction = true;
      setTimeout(() => { activeInteraction = false; }, 1500);
    }, { passive: true });

    function ensureMounted() {
      if (root) return root;
      // If the host page provided their own container, use it.
      root = document.querySelector('[data-a11y-prompt]');
      if (!root) {
        root = document.createElement('div');
        document.body.appendChild(root);
      }
      root.className = 'a11y-prompt';
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'false');
      root.setAttribute('aria-live', 'polite');
      root.setAttribute('aria-labelledby', 'a11y-prompt-title');
      root.setAttribute('aria-describedby', 'a11y-prompt-body');
      root.hidden = true;
      root.innerHTML = `
        <button class="a11y-prompt__close" type="button"
                aria-label="Dismiss accessibility suggestion">&times;</button>
        <p id="a11y-prompt-title" class="a11y-prompt__title">
          Find the animations distracting?
        </p>
        <p id="a11y-prompt-body" class="a11y-prompt__body">
          Switch to Reading Mode — clean light theme, no motion,
          no background effects. Just the content, easy to read.
        </p>
        <div class="a11y-prompt__actions">
          <button class="a11y-prompt__btn a11y-prompt__btn--primary"
                  type="button" data-a11y-action="enable">
            Enable Reading Mode
          </button>
          <button class="a11y-prompt__btn a11y-prompt__btn--ghost"
                  type="button" data-a11y-action="dismiss">
            Not now
          </button>
          <button class="a11y-prompt__btn a11y-prompt__btn--link"
                  type="button" data-a11y-action="opt-out">
            Don't show again
          </button>
        </div>
      `;
      root.addEventListener('click', onActionClick);
      root.addEventListener('keydown', onKeyDown);
      return root;
    }

    function onActionClick(e) {
      const btn = e.target.closest('[data-a11y-action], .a11y-prompt__close');
      if (!btn) return;
      const action = btn.dataset.a11yAction || 'dismiss';
      handle(action);
    }

    function onKeyDown(e) {
      if (e.key === 'Escape') { handle('dismiss'); }
    }

    function handle(action) {
      if (action === 'enable') {
        ModeApplicator.apply(true);
        hide();
      } else if (action === 'opt-out') {
        StateManager.setOptedOut();
        hide();
      } else {
        StateManager.snooze(CONFIG.SNOOZE_DURATION_MS);
        hide();
      }
    }

    function anchorTo(targetEl) {
      // Default position is the bottom-right (set in CSS). When we have a
      // believable origin element, anchor near it but stay on-screen.
      if (!targetEl || !(targetEl instanceof Element)) {
        root.style.left = ''; root.style.top = '';
        root.dataset.anchored = 'false';
        return;
      }
      const rect = targetEl.getBoundingClientRect();
      const promptW = 360, promptH = 140;
      let left = rect.left + rect.width / 2 - promptW / 2;
      let top = rect.bottom + 12;
      // Clamp into viewport with 12px margin.
      const margin = 12;
      left = Math.max(margin, Math.min(window.innerWidth - promptW - margin, left));
      if (top + promptH + margin > window.innerHeight) {
        top = Math.max(margin, rect.top - promptH - 12);
      }
      root.style.left = left + 'px';
      root.style.top = top + 'px';
      root.style.right = 'auto';
      root.style.bottom = 'auto';
      root.dataset.anchored = 'true';
    }

    function show(targetEl) {
      ensureMounted();
      if (visible) return;
      visible = true;
      anchorTo(targetEl);
      root.hidden = false;
      // Force reflow so the transition fires.
      // eslint-disable-next-line no-unused-expressions
      root.offsetHeight;
      root.classList.add('is-visible');
      lastFocusedBeforeOpen = document.activeElement;
      const primary = root.querySelector('[data-a11y-action="enable"]');
      if (primary) primary.focus({ preventScroll: true });
    }

    function hide() {
      if (!root || !visible) return;
      visible = false;
      root.classList.remove('is-visible');
      // Wait for the transition to finish before hiding for assistive tech.
      setTimeout(() => {
        if (!visible && root) root.hidden = true;
      }, 260);
      if (lastFocusedBeforeOpen && document.contains(lastFocusedBeforeOpen)) {
        try { lastFocusedBeforeOpen.focus({ preventScroll: true }); } catch (_) {}
      }
    }

    function maybeShow(targetEl) {
      if (visible) return;
      if (activeInteraction) return;
      if (ModeApplicator.isEnabled()) return;
      if (StateManager.isOptedOut()) return;
      if (StateManager.isSnoozed()) return;
      show(targetEl);
    }

    return { show, hide, maybeShow };
  })();

  // -------------------------------------------------------------------------
  // Boot
  // -------------------------------------------------------------------------
  function init() {
    // Restore persisted mode without prompting.
    if (StateManager.isReduced()) ModeApplicator.apply(true);

    // Honor OS-level signals as a soft pre-trigger: if the user has set
    // prefers-reduced-motion and hasn't opted out or already enabled, we
    // surface the prompt once after a short dwell, with anchoring to the
    // first content region.
    try {
      const mql = window.matchMedia('(prefers-reduced-motion: reduce)');
      if (mql.matches && !ModeApplicator.isEnabled() &&
          !StateManager.isOptedOut() && !StateManager.isSnoozed()) {
        setTimeout(() => {
          const first = document.querySelector('[data-accessible="text"], main, article');
          PromptController.maybeShow(first);
        }, 4000);
      }
    } catch (_) { /* matchMedia not available */ }

    StruggleDetector.start();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // -------------------------------------------------------------------------
  // Public API
  // -------------------------------------------------------------------------
  global.A11y = {
    enable()   { ModeApplicator.apply(true); },
    disable()  { ModeApplicator.apply(false); },
    toggle()   { ModeApplicator.apply(!ModeApplicator.isEnabled()); },
    isEnabled: () => ModeApplicator.isEnabled(),
    register:  (sub) => ModeApplicator.register(sub),
    onChange:  (fn) => ModeApplicator.onChange(fn),
    reset() {
      StateManager.reset();
      ModeApplicator.apply(false);
    },
    showPromptNow() { PromptController.show(StruggleDetector.getLastSignalEl()); },
    getScore: () => StruggleDetector.getScore(),
    voice: {
      play:   () => VoiceReader.play(),
      pause:  () => VoiceReader.pause(),
      stop:   () => VoiceReader.stop(),
      skip:   () => VoiceReader.skip(),
      isSupported: () => VoiceReader.isSupported(),
    },
  };
})(window);
