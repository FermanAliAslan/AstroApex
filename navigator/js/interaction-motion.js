/* Connect a change in mission-wide overlap to its displayed total. */
(() => {
  const planner = window.AA;
  if (!planner) return;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  for (const row of document.querySelectorAll('[data-overlap]')) {
    const value = row.querySelector('b');
    const slot = document.createElement('span');
    slot.className = 'overlap-value-slot';
    value.replaceWith(slot);
    slot.append(value);
    const hours = () => planner.S.data[row.dataset.overlap].stats.both;
    let previousHours = hours(), previousText = value.textContent;

    planner.onChange(() => {
      const current = hours(), text = value.textContent;
      if (text === previousText && current === previousHours) return;
      const from = previousText, direction = Math.sign(current - previousHours);
      previousText = text;
      previousHours = current;
      slot.querySelector('.overlap-previous')?.remove();
      value.getAnimations?.().forEach(animation => animation.cancel());
      if (planner.S.tab !== 'compare' || reduced.matches || !direction || from === text || !value.animate) return;

      const old = document.createElement('span');
      old.className = 'overlap-previous';
      old.setAttribute('aria-hidden', 'true');
      old.textContent = from;
      slot.append(old);
      const shift = 11 * direction;
      const timing = {duration: 300, easing: 'cubic-bezier(.22,.8,.22,1)'};
      const leaving = old.animate([
        {opacity: .85, transform: 'translateY(0)'},
        {opacity: 0, transform: `translateY(${-shift}px)`}
      ], timing);
      leaving.onfinish = leaving.oncancel = () => old.remove();
      value.animate([
        {opacity: .18, transform: `translateY(${shift}px)`},
        {opacity: 1, transform: 'translateY(0)'}
      ], timing);
    });
    reduced.addEventListener('change', () => {
      if (reduced.matches) slot.getAnimations({subtree: true}).forEach(animation => animation.cancel());
    });
  }
})();
