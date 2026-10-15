// Drei kleine Funktionen:
// 0. Die Augen der Figur oben rechts folgen dem Mauszeiger.
// 1. Die E-Mail-Zeile wird so skaliert, dass sie genau die volle Breite füllt.
// 2. Klick auf die Adresse kopiert sie, ein Tooltip folgt dem Mauszeiger.

// --- 0. Augen folgen der Maus ---
(function () {
  if (!document.querySelector('.face .eye')) return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const MAX_OFFSET = 3.5; // wie weit ein Auge aus der Mitte wandern darf (SVG-Einheiten)
  let frame;

  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => {
      // Bei jeder Bewegung neu suchen, damit auch das Gesicht im Chat-Fenster mitmacht
      document.querySelectorAll('.face .eye').forEach((eye) => {
        // Mittelpunkt des Auges auf dem Bildschirm, gemessen ohne aktuelle Verschiebung
        eye.removeAttribute('transform');
        const r = eye.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        const dist = Math.hypot(dx, dy) || 1;
        // Nahe am Kopf schaut sie weniger weit zur Seite, weiter weg bis zum Maximum
        const reach = Math.min(dist / 150, 1) * MAX_OFFSET;
        eye.setAttribute('transform', `translate(${(dx / dist) * reach} ${(dy / dist) * reach})`);
      });
    });
  });
})();

(function () {
  const line = document.querySelector('.contact-mail');
  const mail = document.getElementById('mail');
  const tooltip = document.getElementById('mail-tooltip');
  if (!line || !mail || !tooltip) return;

  // --- 1. Schriftgröße an die Breite anpassen ---
  // Gemessen wird an einer unsichtbaren Kopie bei 100px, dann wird hochgerechnet.
  function fitLine() {
    const target = line.parentElement.clientWidth -
      parseFloat(getComputedStyle(line.parentElement).paddingLeft) * 2;
    const probe = line.cloneNode(true);
    probe.style.cssText = 'position:absolute;visibility:hidden;left:-9999px;width:auto;font-size:100px';
    document.body.appendChild(probe);
    const natural = probe.scrollWidth;
    probe.remove();
    if (natural) line.style.fontSize = (target / natural) * 100 + 'px';
  }

  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(fitLine, 100);
  });
  document.fonts.ready.then(fitLine);
  fitLine();

  // --- 2. Kopieren mit Tooltip ---
  const label = tooltip.querySelector('.tooltip-text');
  const defaultText = 'Click to copy';
  let resetTimer;

  function moveTo(x, y) {
    tooltip.style.left = x + 'px';
    tooltip.style.top = y + 'px';
  }

  mail.addEventListener('mouseenter', (e) => {
    moveTo(e.clientX, e.clientY);
    tooltip.classList.add('is-visible');
  });
  mail.addEventListener('mousemove', (e) => moveTo(e.clientX, e.clientY));
  mail.addEventListener('mouseleave', () => {
    if (!tooltip.classList.contains('is-copied')) tooltip.classList.remove('is-visible');
  });

  async function copy() {
    try {
      await navigator.clipboard.writeText(mail.dataset.mail);
    } catch {
      window.location.href = 'mailto:' + mail.dataset.mail;
      return;
    }
    if (!mail.matches(':hover')) {
      const r = mail.getBoundingClientRect();
      moveTo(r.left + r.width / 2, r.top);
    }
    tooltip.classList.add('is-copied', 'is-visible');
    label.textContent = 'Copied';
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      tooltip.classList.remove('is-copied');
      label.textContent = defaultText;
      if (!mail.matches(':hover')) tooltip.classList.remove('is-visible');
    }, 1500);
  }

  mail.addEventListener('click', copy);
  mail.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      copy();
    }
  });
})();
