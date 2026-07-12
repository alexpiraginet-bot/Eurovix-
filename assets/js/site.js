/* ============================================================
   EUROVIX · Site Premium — interações
   ============================================================ */

(function () {
  'use strict';

  /* ---------- Header: sombra ao rolar ---------- */
  const header = document.querySelector('.site-header');
  const onScroll = () => header && header.classList.toggle('scrolled', window.scrollY > 8);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  /* ---------- Menu mobile ---------- */
  const menuBtn = document.getElementById('menuBtn');
  const nav = document.getElementById('mainNav');
  if (menuBtn && nav) {
    menuBtn.addEventListener('click', () => {
      const open = nav.classList.toggle('open');
      menuBtn.classList.toggle('open', open);
      menuBtn.setAttribute('aria-expanded', String(open));
      document.body.style.overflow = open ? 'hidden' : '';
    });
    nav.querySelectorAll('a').forEach(a => a.addEventListener('click', () => {
      nav.classList.remove('open');
      menuBtn.classList.remove('open');
      menuBtn.setAttribute('aria-expanded', 'false');
      document.body.style.overflow = '';
    }));
  }

  /* ---------- Link ativo conforme a seção visível ---------- */
  const sections = document.querySelectorAll('section[id]');
  const navLinks = document.querySelectorAll('.main-nav a[href^="#"]');
  if ('IntersectionObserver' in window && sections.length) {
    const spy = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (!e.isIntersecting) return;
        navLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + e.target.id));
      });
    }, { rootMargin: '-40% 0px -55% 0px' });
    sections.forEach(s => spy.observe(s));
  }

  /* ---------- Reveal on scroll ---------- */
  const reveals = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { threshold: 0.12 });
    reveals.forEach(el => io.observe(el));
  } else {
    reveals.forEach(el => el.classList.add('in'));
  }

  /* ---------- Catálogo de serviços (EVX.SERVICES) ---------- */
  const grid = document.getElementById('servicesGrid');
  if (grid && typeof EVX !== 'undefined') {
    grid.insertAdjacentHTML('beforeend', EVX.SERVICES.map(s => `
      <article class="service-card reveal in">
        <div class="ico-wrap"><img src="assets/img/icons/${s.icon}.webp" alt="" width="132" height="132" loading="lazy"></div>
        <h3>${s.nome}</h3>
        <div class="tag">${s.tag}</div>
        <p>${s.desc}</p>
        <ul>
          ${s.itens.map(i => `<li>${EVX.icon('check', 15)}<span>${i}</span></li>`).join('')}
        </ul>
        <div class="meta-row">
          <span class="dur">${EVX.icon('clock', 14)} ${s.duracao}</span>
          <a class="link" href="agendamento.html?servico=${s.id}">Agendar ${EVX.icon('arrow', 14)}</a>
        </div>
      </article>
    `).join(''));
  }
})();
