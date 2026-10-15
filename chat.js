// Chat im Terminal-Look.
// Ablauf: Klick auf das Gesicht oben rechts -> Grün läuft vom Gesicht aus über den
// Bildschirm (CSS clip-path, ca. 1,1 s) -> Terminal blendet ein (0,4 s).
// Antworten wählt ein kleines neuronales Netz (tinynet.js, Gewichte in model/tinynet.json):
// Es erkennt das Thema der Frage und zeigt die passende, von Lennard freigegebene Antwort
// aus knowledge.json. Frei erfundener Text ist so ausgeschlossen. Ist das Netz unsicher,
// kommt die Ausweichantwort. Lädt das Netz nicht, greift ein einfacher Stichwort-Abgleich.

(function () {
  const trigger = document.querySelector('.hero-mark');
  if (!trigger) return;

  let data = null;   // knowledge.json
  let net = null;    // TinyNet-Instanz
  let loading = null;

  // Wissensbasis und Modell erst beim ersten Öffnen laden (spart Datenvolumen)
  function loadAll() {
    if (!loading) {
      loading = (async () => {
        data = await fetch('knowledge.json').then((r) => r.json());
        try {
          net = await window.TinyNet.load('model/tinynet.json');
        } catch (err) {
          console.warn('Netz nicht geladen, nutze Stichwort-Abgleich', err);
        }
      })();
    }
    return loading;
  }

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Gesicht mit vier Ausdrücken (gleiche Linienführung wie das Logo) ---
  const faceSVG = `
    <svg class="face chat-face" data-mood="neutral" viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg"
      fill="none" stroke="currentColor" stroke-width="6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="50" cy="13" r="5.5" fill="currentColor" stroke="none" />
      <path d="M27 37 A23 21 0 0 1 73 37" />
      <rect x="21" y="37" width="58" height="11" rx="5.5" />
      <path d="M25 48 V62 A25 25 0 0 0 75 62 V48" />
      <g class="mood mood-neutral">
        <g class="eye"><rect x="37" y="53" width="7" height="13" rx="3.5" fill="currentColor" stroke="none" /></g>
        <g class="eye"><rect x="56" y="53" width="7" height="13" rx="3.5" fill="currentColor" stroke="none" /></g>
        <path class="mouth" d="M45 75 Q52 79 58 73" stroke-width="5" />
      </g>
      <g class="mood mood-thinking">
        <rect x="40" y="52" width="7" height="9" rx="3.5" fill="currentColor" stroke="none" />
        <rect x="59" y="52" width="7" height="9" rx="3.5" fill="currentColor" stroke="none" />
        <path class="mouth" d="M46 75 L57 73" stroke-width="5" />
      </g>
      <g class="mood mood-surprised">
        <rect x="36" y="51" width="8" height="15" rx="4" fill="currentColor" stroke="none" />
        <rect x="56" y="51" width="8" height="15" rx="4" fill="currentColor" stroke="none" />
        <circle class="mouth" cx="50" cy="75" r="3.5" stroke-width="4.5" />
      </g>
      <g class="mood mood-happy">
        <path d="M36 61 Q40.5 54 45 61" stroke-width="5" />
        <path d="M55 61 Q59.5 54 64 61" stroke-width="5" />
        <path class="mouth" d="M41 70 Q50 81 60 70" stroke-width="5" />
      </g>
    </svg>`;

  // --- Overlay einmalig anlegen ---
  const overlay = document.createElement('div');
  overlay.className = 'chat-overlay';
  overlay.setAttribute('role', 'dialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-label', 'Chat with Lennard’s assistant');
  overlay.hidden = true;
  overlay.innerHTML = `
    <canvas class="paint" aria-hidden="true"></canvas>
    <div class="term">
      <div class="term-bar">
        <span class="term-dots" aria-hidden="true"><i></i><i></i><i></i></span>
        <span class="term-title">lennard@tiny-assistant: ~</span>
        <button type="button" class="term-close" aria-label="Close chat">esc</button>
      </div>
      <div class="term-log" aria-live="polite"></div>
      <div class="term-face">${faceSVG}</div>
      <form class="term-input" autocomplete="off">
        <span class="term-prompt" aria-hidden="true">&gt;</span>
        <input type="text" name="q" aria-label="Ask a question" placeholder="Ask me something…" maxlength="200">
      </form>
    </div>`;
  document.body.appendChild(overlay);

  const log = overlay.querySelector('.term-log');
  const form = overlay.querySelector('.term-input');
  const input = form.querySelector('input');
  const face = overlay.querySelector('.chat-face');
  let started = false;
  let busy = false;
  let moodTimer;

  function setMood(mood, holdMs) {
    face.dataset.mood = mood;
    clearTimeout(moodTimer);
    if (holdMs) moodTimer = setTimeout(() => (face.dataset.mood = 'neutral'), holdMs);
  }

  function addLine(cls, text) {
    const line = document.createElement('p');
    line.className = 'term-line ' + cls;
    line.textContent = text;
    log.appendChild(line);
    log.scrollTop = log.scrollHeight;
    return line;
  }

  // Text Zeichen für Zeichen schreiben, währenddessen "spricht" der Mund
  function typeLine(cls, text) {
    return new Promise((resolve) => {
      const line = addLine(cls, '');
      if (reduceMotion) {
        line.textContent = text;
        return resolve();
      }
      face.classList.add('talking');
      let i = 0;
      const step = () => {
        i += 2;
        line.textContent = text.slice(0, i);
        log.scrollTop = log.scrollHeight;
        if (i < text.length) setTimeout(step, 14);
        else {
          face.classList.remove('talking');
          resolve();
        }
      };
      step();
    });
  }

  // Ersatzweg ohne Modell: einfacher Stichwort-Abgleich gegen knowledge.json
  function keywordAnswer(question) {
    const words = question.toLowerCase().replace(/[^a-z0-9äöüß\s-]/g, ' ').split(/\s+/).filter(Boolean);
    let best = null;
    let bestScore = 0;
    for (const entry of data.entries) {
      const score = entry.keys.filter((k) => words.includes(k)).length;
      if (score > bestScore) {
        best = entry;
        bestScore = score;
      }
    }
    return best || data.fallback;
  }

  // Unter dieser Sicherheit lieber die Ausweichantwort (siehe training/eval_net.txt)
  const MIN_CONFIDENCE = 0.5;

  function findAnswer(question) {
    if (!net) return keywordAnswer(question);
    const { id, confidence } = net.classify(question);
    if (confidence < MIN_CONFIDENCE) return data.fallback;
    return data.entries.find((e) => e.id === id) || data.fallback;
  }

  async function ask(question) {
    const q = question.trim();
    if (!q || busy) return;
    addLine('is-user', '> ' + q);

    const cmd = q.toLowerCase();
    if (cmd === 'clear') {
      log.innerHTML = '';
      return;
    }
    if (cmd === 'exit' || cmd === 'quit') {
      close();
      return;
    }
    if (cmd === 'help') {
      setMood('happy', 2500);
      await typeLine('is-bot', 'Ask anything about Lennard: studies, work, projects, hobbies. Commands: help, clear, exit.');
      return;
    }

    busy = true;
    setMood('thinking');
    await loadAll();
    const answer = findAnswer(q);
    // Kurze Denkpause, damit das Gesicht sichtbar nachdenkt
    await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 600 + Math.random() * 300));
    setMood(answer.mood || 'neutral');
    await typeLine('is-bot', answer.text);
    setMood(answer.mood || 'neutral', 1800);
    busy = false;
  }

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value;
    input.value = '';
    ask(q);
  });

  // Gesicht reagiert schon beim Tippen
  input.addEventListener('input', () => {
    if (!busy && input.value.length === 1) setMood('surprised', 700);
  });

  // --- Öffnen und Schließen ---
  // Ablauf (zusammen etwa 2 s): Glasblase platzt (0,15 s) -> Wasser läuft über den
  // Bildschirm und färbt sich blau (1,6 s, water.js) -> Terminal blendet ein (0,3 s).
  // Schließen läuft rückwärts.
  const canvas = overlay.querySelector('.paint');
  const POP_MS = 150, PAINT_MS = 1600;
  let animating = false;

  const wait = (ms) => new Promise((r) => setTimeout(r, ms));

  function origin() {
    const r = trigger.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  async function open() {
    if (animating || !overlay.hidden) return;
    animating = true;
    const ready = loadAll();
    document.documentElement.classList.add('chat-open');
    overlay.hidden = false;

    if (reduceMotion || !window.waterFlood) {
      overlay.classList.add('is-filled', 'is-open');
    } else {
      trigger.classList.add('is-popping');
      await wait(POP_MS);
      trigger.classList.add('is-popped');
      await window.waterFlood(canvas, origin(), 'in', PAINT_MS);
      overlay.classList.add('is-filled');
      requestAnimationFrame(() => overlay.classList.add('is-open'));
    }
    animating = false;
    setTimeout(() => input.focus(), reduceMotion ? 0 : 300);

    if (!started) {
      started = true;
      busy = true; // keine Fragen, solange die Begrüßung noch getippt wird
      await ready;
      await wait(reduceMotion ? 0 : 300);
      setMood('happy', 1500);
      const intro = net
        ? data.intro.replace('{params}', net.nParams.toLocaleString('en-US'))
        : data.intro_fallback;
      await typeLine('is-intro', intro);
      addLine('is-hint', data.hint);
      busy = false;
    }
  }

  async function close() {
    if (animating || overlay.hidden) return;
    animating = true;
    overlay.classList.remove('is-open');
    if (!reduceMotion && window.waterFlood) {
      await wait(250);
      overlay.classList.remove('is-filled');
      await window.waterFlood(canvas, origin(), 'out', PAINT_MS);
      trigger.classList.remove('is-popped');
      trigger.classList.add('is-unpopping');
      await wait(300);
      trigger.classList.remove('is-popping', 'is-unpopping');
    } else {
      overlay.classList.remove('is-filled');
      trigger.classList.remove('is-popping', 'is-popped');
    }
    overlay.hidden = true;
    document.documentElement.classList.remove('chat-open');
    animating = false;
    trigger.focus();
  }

  // Handy-Tastatur: Overlay auf den sichtbaren Bereich verkleinern, damit die
  // Eingabezeile nicht unter der Tastatur verschwindet
  if (window.visualViewport) {
    const fit = () => {
      if (overlay.hidden) return;
      overlay.style.height = window.visualViewport.height + 'px';
      overlay.style.top = window.visualViewport.offsetTop + 'px';
    };
    window.visualViewport.addEventListener('resize', fit);
    window.visualViewport.addEventListener('scroll', fit);
  }

  trigger.addEventListener('click', open);
  overlay.querySelector('.term-close').addEventListener('click', close);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !overlay.hidden) close();
  });
})();
