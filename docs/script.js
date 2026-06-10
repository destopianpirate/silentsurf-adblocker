/* ═══════════════════════════════════════════════════
   DESTOPIAN PIRATE — Core Interface Logic
   ═══════════════════════════════════════════════════ */

(function () {
    'use strict';

    // ── Tab Navigation ──
    const tabs = document.querySelectorAll('.nav-tab');
    const pages = document.querySelectorAll('.page');

    function switchPage(pageId) {
        pages.forEach(p => p.classList.remove('active'));
        tabs.forEach(t => t.classList.remove('active'));

        const target = document.getElementById(pageId);
        if (target) {
            target.classList.add('active');
            window.scrollTo({ top: 0, behavior: 'instant' });
        }

        tabs.forEach(t => {
            if (t.dataset.page === pageId) t.classList.add('active');
        });
    }

    // Make switchPage globally accessible for inline onclick
    window.switchPage = switchPage;

    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            switchPage(tab.dataset.page);
        });
    });

    // Brand logo click returns to home
    const brandLink = document.getElementById('nav-home-link');
    if (brandLink) {
        brandLink.addEventListener('click', (e) => {
            e.preventDefault();
            switchPage('page-home');
        });
    }

    // ── Manifesto Timestamp ──
    const tsEl = document.getElementById('manifesto-ts');
    if (tsEl) {
        const now = new Date();
        const y = now.getFullYear();
        const m = String(now.getMonth() + 1).padStart(2, '0');
        const d = String(now.getDate()).padStart(2, '0');
        const h = String(now.getHours()).padStart(2, '0');
        const min = String(now.getMinutes()).padStart(2, '0');
        tsEl.textContent = `${y}.${m}.${d} // ${h}:${min} LOCAL`;
    }

    // ── Redacted Text Reveal ──
    document.querySelectorAll('.redacted').forEach(el => {
        el.addEventListener('click', () => {
            el.style.background = 'transparent';
            el.style.color = 'var(--amber)';
            el.style.cursor = 'default';
        });
    });

    // ── Terminal Typewriter ──
    const terminalLines = [
        { text: '> initializing destopian_pirate_network...', cls: 'prompt' },
        { text: '  [OK] core systems online', cls: 'val' },
        { text: '  [OK] encryption protocols active', cls: 'val' },
        { text: '  [OK] surveillance countermeasures deployed', cls: 'val' },
        { text: '' },
        { text: '> scanning deployed agents...', cls: 'prompt' },
        { text: '  AGENT DTP-001: Destopian AdBlock Pro', cls: 'val' },
        { text: '    status: OPERATIONAL', cls: 'val' },
        { text: '    platform: Microsoft Edge (Manifest V3)', cls: 'muted' },
        { text: '    threats neutralized: ads, trackers, popups', cls: 'muted' },
        { text: '' },
        { text: '> network uptime: 99.97%', cls: 'prompt' },
        { text: '> active nodes: 1', cls: 'prompt' },
        { text: '> data collected from users: 0 bytes', cls: 'val' },
        { text: '> telemetry connections: NONE', cls: 'val' },
        { text: '' },
        { text: '  ██████████████████████ 100%', cls: 'val' },
        { text: '' },
        { text: '> all systems nominal. the watchers have no power here.', cls: 'warn' },
    ];

    const termOutput = document.getElementById('terminal-output');
    let lineIndex = 0;

    function typeTermLine() {
        if (!termOutput || lineIndex >= terminalLines.length) {
            // Add blinking cursor at end
            if (termOutput) {
                const cursorSpan = document.createElement('span');
                cursorSpan.className = 'term-cursor';
                termOutput.appendChild(cursorSpan);
            }
            return;
        }

        const entry = terminalLines[lineIndex];
        const div = document.createElement('div');
        div.className = 'term-line';

        if (entry.text === '') {
            div.innerHTML = '&nbsp;';
        } else {
            const span = document.createElement('span');
            span.className = entry.cls || '';
            div.appendChild(span);

            // Typewriter character by character
            let charIdx = 0;
            const text = entry.text;
            const typeChar = () => {
                if (charIdx < text.length) {
                    span.textContent += text[charIdx];
                    charIdx++;
                    setTimeout(typeChar, 12 + Math.random() * 8);
                } else {
                    lineIndex++;
                    setTimeout(typeTermLine, 80 + Math.random() * 120);
                }
            };

            div.style.animationDelay = '0s';
            termOutput.appendChild(div);
            typeChar();
            // Scroll terminal to bottom
            termOutput.scrollTop = termOutput.scrollHeight;
            return;
        }

        div.style.animationDelay = '0s';
        termOutput.appendChild(div);
        termOutput.scrollTop = termOutput.scrollHeight;
        lineIndex++;
        setTimeout(typeTermLine, 60);
    }

    // Start terminal when visible via IntersectionObserver
    const termSection = document.querySelector('.terminal-section');
    let termStarted = false;

    if (termSection && 'IntersectionObserver' in window) {
        const observer = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (entry.isIntersecting && !termStarted) {
                    termStarted = true;
                    setTimeout(typeTermLine, 400);
                    observer.disconnect();
                }
            });
        }, { threshold: 0.3 });

        observer.observe(termSection);
    } else if (termSection) {
        // Fallback: start immediately
        setTimeout(typeTermLine, 800);
    }

    // ── Signal Card Hover Flicker ──
    document.querySelectorAll('.signal-card').forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.opacity = '0.7';
            setTimeout(() => { card.style.opacity = '1'; }, 60);
            setTimeout(() => { card.style.opacity = '0.85'; }, 120);
            setTimeout(() => { card.style.opacity = '1'; }, 180);
        });
    });

    // ── Dossier Card Hover Flicker ──
    document.querySelectorAll('.dossier:not(.dossier-coming)').forEach(card => {
        card.addEventListener('mouseenter', () => {
            card.style.filter = 'brightness(1.15)';
            setTimeout(() => { card.style.filter = 'brightness(0.9)'; }, 50);
            setTimeout(() => { card.style.filter = 'brightness(1.05)'; }, 100);
            setTimeout(() => { card.style.filter = 'brightness(1)'; }, 150);
        });

        card.addEventListener('mouseleave', () => {
            card.style.filter = 'brightness(1)';
        });
    });

    // ── URL Hash Routing ──
    function handleHash() {
        const hash = window.location.hash.replace('#', '');
        if (hash === 'extensions') {
            switchPage('page-extensions');
        } else {
            switchPage('page-home');
        }
    }

    window.addEventListener('hashchange', handleHash);

    // Check hash on load
    if (window.location.hash) {
        handleHash();
    }

})();
