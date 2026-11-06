/* Light, dark, or follow the device.

   All three already existed in the stylesheet - a prefers-color-scheme block guarded by
   :root:not([data-theme="light"]), and a :root[data-theme="dark"] override for the printing
   path to use. What was missing was any way for a reader to choose, which matters because the
   device setting is not always the right one for the job: a control chart read in a bright
   lab is easier light, and the same chart read at a desk at night is easier dark.

   Three options rather than two, for one reason: "follow my device" has to be nameable to get
   back to it. On a laptop set to dark, picking light PINS it light, which is a different state
   from following along - so two buttons leave no way home. That is why Chrome has three.

   The honest limitation, stated in the control itself rather than left to be discovered: a
   choice does not survive a reload. This page keeps nothing anywhere - no browser storage of
   any kind and no cookie, and the build's privacy lint fails if any appear, which is also why
   the words are not written out here. A theme preference is not worth being the exception
   that puts an asterisk on that guarantee, so "Device" is the only setting that persists,
   because the device is what remembers it rather than the page.

   No network, no storage. */
(function (root) {
  'use strict';
  const MODES = [
    ['device', 'Device', 'Follow this device’s light or dark setting. The only one that survives a reload, because your device is what remembers it.'],
    ['light', 'Light', 'Light until you reload. Nothing is stored, so a refresh goes back to following your device.'],
    ['dark', 'Dark', 'Dark until you reload. Nothing is stored, so a refresh goes back to following your device.']
    /* The wording above is checked by the build: a mode that stops saying what it does about
       persistence fails, because that is the part somebody would otherwise find out by
       losing their choice. */
  ];

  function apply(mode) {
    const el = document.documentElement;
    if (mode === 'device') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', mode);
  }

  /* Which mode is in force. Read off the attribute rather than kept in a variable here,
     because the print path sets data-theme directly and briefly - a variable would go stale
     and the control would start lying about the page it is on. */
  function current() {
    const v = document.documentElement.getAttribute('data-theme');
    return v === 'light' || v === 'dark' ? v : 'device';
  }

  function mount(container) {
    if (!container || container.querySelector('.theme-pick')) return;
    const wrap = document.createElement('div');
    wrap.className = 'theme-pick';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'Colour theme');
    const now = current();
    for (const [id, label, why] of MODES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'theme-btn' + (id === now ? ' on' : '');
      b.setAttribute('data-theme-mode', id);
      b.setAttribute('aria-pressed', id === now ? 'true' : 'false');
      b.title = why;
      b.textContent = label;
      b.addEventListener('click', () => {
        apply(id);
        for (const other of wrap.querySelectorAll('.theme-btn')) {
          const on = other.getAttribute('data-theme-mode') === id;
          other.className = 'theme-btn' + (on ? ' on' : '');
          other.setAttribute('aria-pressed', on ? 'true' : 'false');
        }
      });
      wrap.appendChild(b);
    }
    container.appendChild(wrap);
  }

  function init() {
    mount(document.querySelector('.top-nav'));
  }
  root.MLTheme = { MODES, apply, current, mount };
  if (typeof document !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = root.MLTheme;
})(typeof globalThis !== 'undefined' ? globalThis : this);
