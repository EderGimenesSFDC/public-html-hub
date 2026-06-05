/**
 * BRE · Claro BR — Injeção de sidebar global
 * Inclua ao final de <body> em todas as páginas do site:
 *
 *   <!-- ao final do <body>, antes de </body> -->
 *   <link rel="stylesheet" href="<base>/assets/site.css">
 *   <script>var BRE_BASE = '<caminho relativo até a raiz>';</script>
 *   <script src="<base>/assets/nav.js"></script>
 *
 * Onde BRE_BASE é:
 *   - '.'  para páginas na raiz (index.html, poc-bre-*.html)
 *   - '..' para páginas em /docs/
 */

(function () {
  var base = (typeof BRE_BASE !== 'undefined') ? BRE_BASE : '.';
  var path = window.location.pathname;

  // ── Navegação ──────────────────────────────────────────────────────────────
  var nav = [
    {
      section: 'VISÃO GERAL',
      items: [
        { label: 'Portal',                icon: '🏠', href: base + '/index.html' },
        { label: 'Contexto de negócio',   icon: '📋', href: base + '/docs/visao-negocio-precificacao.html' },
        { label: 'Recomendação BRE',      icon: '🎯', href: base + '/docs/recomendacao.html', badge: { text: 'Novo', cls: 'bre-badge-ok' } },
      ]
    },
    {
      section: 'POR PÚBLICO',
      items: [
        { label: 'Visão Executiva',       icon: '👔', href: base + '/docs/para-gestores.html',   badge: { text: 'Gestores', cls: 'bre-badge-info' } },
        { label: 'Como o BRE Funciona',   icon: '📊', href: base + '/docs/para-funcionais.html', badge: { text: 'Funcional', cls: 'bre-badge-info' } },
        { label: 'Guia Técnico',          icon: '⚙️', href: base + '/docs/guia-bre.html',        badge: { text: 'Técnico', cls: 'bre-badge-pending' } },
      ]
    },
    {
      section: 'PROVAS DE CONCEITO',
      items: [
        { label: 'POC 1 · Pipeline',      icon: '⚙️', href: base + '/docs/poc-bre-claro.html',    badge: { text: 'Provada', cls: 'bre-badge-ok' } },
        { label: 'POC 2 · Composto',      icon: '🗺️', href: base + '/docs/poc-bre-composto.html', badge: { text: 'Provada', cls: 'bre-badge-ok' } },
        { label: 'POC 3 · Avançado',      icon: '📦', href: base + '/docs/poc-bre-avancado.html', badge: { text: 'Provada', cls: 'bre-badge-ok' } },
        { label: 'POC Completa',          icon: '🔮', href: base + '/docs/poc-bre-completa.html', badge: { text: 'Provada', cls: 'bre-badge-ok' } },
      ]
    },
    {
      section: 'RESULTADOS',
      items: [
        { label: 'Performance & Carga',   icon: '📈', href: base + '/docs/performance.html' },
        { label: 'Dados de Carga (tabelas)', icon: '🗃️', href: base + '/docs/dados-carga.html', badge: { text: 'Novo', cls: 'bre-badge-ok' } },
      ]
    },
    {
      section: 'ARTEFATOS',
      items: [
        { label: 'Código público',        icon: '📁', href: 'https://github.com/EderGimenesSFDC/public-html-hub/tree/main/projects/bre-claro', external: true },
      ]
    },
  ];

  // ── Detecta página ativa ───────────────────────────────────────────────────
  function isActive(href) {
    if (!href || href.startsWith('http')) return false;
    var norm = href.replace(/^\.\.?\//, '/').replace(/^\./, '');
    return path.endsWith(norm) ||
           path.endsWith(norm.replace(/\.html$/, '')) ||
           (norm === '/index.html' && (path === '/' || path.endsWith('/index.html')));
  }

  // ── Constrói HTML ─────────────────────────────────────────────────────────
  function h(tag, attrs, content) {
    var attrStr = Object.entries(attrs || {}).map(function(kv) {
      return kv[0] + '="' + kv[1].replace(/"/g, '&quot;') + '"';
    }).join(' ');
    return '<' + tag + (attrStr ? ' ' + attrStr : '') + '>' + (content || '') + '</' + tag + '>';
  }

  var html = '<nav class="bre-nav" id="bre-nav">';

  // Header
  html += '<div class="bre-nav-header">';
  html += h('a', { href: base + '/index.html', class: 'bre-nav-logo' },
    'BRE · Claro BR' + h('span', {}, 'Motor de Precificação Nativa'));
  html += '</div>';

  // Body
  html += '<div class="bre-nav-body">';
  nav.forEach(function(group) {
    html += h('div', { class: 'bre-nav-section' }, group.section);
    group.items.forEach(function(item) {
      var active = isActive(item.href);
      var cls = 'bre-nav-item' + (active ? ' active' : '');
      var target = item.external ? ' target="_blank" rel="noopener"' : '';
      var badgeHtml = item.badge
        ? h('span', { class: 'bre-badge ' + item.badge.cls }, item.badge.text)
        : '';
      var iconHtml = h('span', { class: 'bre-nav-icon' }, item.icon);
      html += '<a href="' + item.href + '" class="' + cls + '"' + target + '>';
      html += iconHtml + item.label + badgeHtml;
      html += '</a>';
    });
  });
  html += '</div>';

  // Footer
  html += '<div class="bre-nav-footer">';
  html += 'Salesforce Industries · BRE<br>';
  html += 'Junho/2026 · org <code>org-demo</code>';
  html += '</div>';

  html += '</nav>';

  // Botão mobile
  html += '<button class="bre-nav-toggle" id="bre-nav-toggle" onclick="breNavToggle()">☰</button>';
  html += '<div class="bre-nav-overlay" id="bre-nav-overlay" onclick="breNavClose()"></div>';

  // Injeta
  var container = document.createElement('div');
  container.innerHTML = html;
  document.body.insertBefore(container.firstChild, document.body.firstChild);
  document.body.insertBefore(container.firstChild, document.body.firstChild); // toggle
  document.body.insertBefore(container.firstChild, document.body.firstChild); // overlay

  // Aplica margem
  document.body.classList.add('bre-nav-active');

  // Mobile toggle
  window.breNavToggle = function() {
    document.getElementById('bre-nav').classList.toggle('open');
    document.getElementById('bre-nav-overlay').classList.toggle('open');
  };
  window.breNavClose = function() {
    document.getElementById('bre-nav').classList.remove('open');
    document.getElementById('bre-nav-overlay').classList.remove('open');
  };
})();
