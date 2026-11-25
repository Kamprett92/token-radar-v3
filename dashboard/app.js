// Token Radar 3 — dashboard logic. Reads window.RADAR (zz-data.js), renders the
// board, the detail view, the apart tables and the methodology. No network.
(function () {
  var D = window.RADAR;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.s] = r; });

  function usd(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + n;
  }
  function signed(n, d) { return (n >= 0 ? '+' : '') + n.toFixed(d === undefined ? 1 : d) + '%'; }
  function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

  // ---- header / stats
  document.getElementById('metaLine').textContent =
    'Snapshot ' + D.meta.as_of + ' · ' + D.meta.board_rows + ' protocols ranked · market 7d median ' + signed(D.meta.market_median_change_7d) + ' · global multiple ' + D.meta.global_multiple.toFixed(3);
  document.getElementById('asOf').textContent = D.meta.as_of;
  var totalImplied = rows.reduce(function (a, r) { return a + r.v; }, 0);
  document.getElementById('stats').innerHTML =
    '<div class="stat"><b>' + D.meta.board_rows + '</b><span>protocols ranked</span></div>' +
    '<div class="stat"><b>' + D.meta.watchlist + '</b><span>watchlist covered</span></div>' +
    '<div class="stat"><b>' + usd(totalImplied) + '</b><span>total implied value</span></div>' +
    '<div class="stat"><b>' + usd(rows[0].v) + '</b><span>top implied value</span></div>' +
    '<div class="stat"><b>' + D.meta.live_apart + '</b><span>already trading, apart</span></div>' +
    '<div class="stat"><b>' + D.meta.ticker_apart + '</b><span>ticker only, unranked</span></div>';

  // ---- filters
  var cats = [], chains = [];
  rows.forEach(function (r) {
    if (r.c && cats.indexOf(r.c) < 0) cats.push(r.c);
    r.ch.forEach(function (c) { if (chains.indexOf(c) < 0) chains.push(c); });
  });
  cats.sort(); chains.sort();
  var catSel = document.getElementById('cat');
  cats.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; catSel.appendChild(o); });
  var chainSel = document.getElementById('chain');
  chains.forEach(function (c) { var o = document.createElement('option'); o.value = c; o.textContent = c; chainSel.appendChild(o); });

  var state = { q: '', cat: '', chain: '', wl: false, sort: 'rank', page: 0 };
  var PER = 15;

  function filtered() {
    var q = state.q.toLowerCase();
    var list = rows.filter(function (r) {
      if (state.wl && !r.w) return false;
      if (state.cat && r.c !== state.cat) return false;
      if (state.chain && r.ch.indexOf(state.chain) < 0) return false;
      if (q && (r.n.toLowerCase().indexOf(q) < 0 && r.s.toLowerCase().indexOf(q) < 0)) return false;
      return true;
    });
    var s = state.sort;
    if (s === 'value') list.sort(function (a, b) { return b.v - a.v; });
    else if (s === 'tvl') list.sort(function (a, b) { return b.t - a.t; });
    else if (s === 'growth') list.sort(function (a, b) { return (b.g || 0) - (a.g || 0); });
    else if (s === 'age') list.sort(function (a, b) { return (b.a || 0) - (a.a || 0); });
    else list.sort(function (a, b) { return a.r - b.r; });
    return list;
  }

  function factorChips(r) {
    var f = r.f;
    function chip(label, val, hot) {
      return '<span' + (hot ? ' class="hot"' : '') + '>' + label + ' ×' + val.toFixed(val < 1 ? 2 : 3).replace(/0+$/, '').replace(/\.$/, '.0') + '</span>';
    }
    return '<div class="fac">' +
      chip('cat', f[0], false) + chip('growth', f[1], f[1] > 1.03) +
      chip('age', f[2], false) + chip('breadth', f[3], false) +
      chip('lead', f[4], f[4] > 1) + chip('velocity', f[5], f[5] > 1.03) + '</div>';
  }

  function chainCell(r) {
    if (r.ch.length <= 3) return esc(r.ch.join(', '));
    return esc(r.ch.slice(0, 3).join(', ')) + ' <span class="pslug">+' + (r.ch.length - 3) + ' more</span>';
  }

  function render() {
    var list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PER));
    if (state.page >= pages) state.page = pages - 1;
    var slice = list.slice(state.page * PER, state.page * PER + PER);
    var html = '';
    slice.forEach(function (r) {
      var g = r.g === null ? '—' : '<span class="' + (r.g >= 0 ? 'pos' : 'neg') + '">' + signed(r.g) + '</span>';
      html += '<tr data-slug="' + esc(r.s) + '"><td>' + r.r + '</td>' +
        '<td><span class="pname">' + esc(r.n) + '</span>' + (r.w ? '<span class="badge">WATCHLIST</span>' : '') +
        '<br><span class="pslug">' + esc(r.s) + '</span></td>' +
        '<td>' + esc(r.c || '—') + '</td><td>' + chainCell(r) + '</td>' +
        '<td class="num">' + usd(r.t) + '</td><td class="num">' + g + '</td>' +
        '<td class="num"><b>' + usd(r.v) + '</b></td><td>' + factorChips(r) + '</td></tr>';
    });
    document.getElementById('rows').innerHTML = html || '<tr><td colspan="8">No protocols match these filters.</td></tr>';
    document.getElementById('pageInfo').textContent =
      'Page ' + (state.page + 1) + ' of ' + pages + ' · ' + list.length + ' protocols';
    document.getElementById('prev').disabled = state.page === 0;
    document.getElementById('next').disabled = state.page >= pages - 1;
  }

  // ---- detail view
  var FACTOR_ROWS = [
    ['Category multiple', function (r, c) { return 'trimmed multiple of ' + c + ' live-token comparables'; }],
    ['Growth vs market', function (r) { return '7d ' + (r.g === null ? 'not reported' : signed(r.g)) + ' vs market median ' + signed(D.meta.market_median_change_7d); }],
    ['Age', function (r) { return r.a === null ? 'listing date not recorded' : r.a + ' days since listing'; }],
    ['Chain breadth', function (r) { return r.ch.length + ' chain' + (r.ch.length === 1 ? '' : 's') + ': ' + r.ch.join(', '); }],
    ['Category leadership', function (r) { return r.k === 1 ? '#1 pre-token by TVL in its category' : r.k <= 3 ? '#' + r.k + ' pre-token by TVL in its category' : '#' + r.k + ' pre-token by TVL in its category'; }],
    ['TVL velocity', function (r) { return r.a === null ? 'age unknown' : 'TVL per day since listing, quartile vs the board'; }],
  ];
  function scrollToDetail() {
    var el = document.getElementById('detail');
    if (el && !el.hidden) el.scrollIntoView({ behavior: 'auto', block: 'start' });
  }
  function showDetail(slug) {
    var r = bySlug[slug];
    if (!r) return;
    document.getElementById('dName').textContent = '#' + r.r + ' · ' + r.n;
    document.getElementById('dMeta').textContent =
      r.s + ' · ' + (r.c || 'no category') + ' · ' + r.ch.join(', ') + ' · TVL ' + usd(r.t) +
      ' · 7d ' + (r.g === null ? 'not reported' : signed(r.g)) + ' · ' + (r.a === null ? 'age unknown' : r.a + ' days') +
      (r.w ? ' · on the watchlist' : '');
    var fh = '';
    FACTOR_ROWS.forEach(function (row, i) {
      fh += '<tr><td>' + row[0] + '</td><td>' + esc(row[1](r, r.c || 'its category')) + '</td><td class="num">×' + r.f[i].toFixed(3) + '</td></tr>';
    });
    document.getElementById('dFactors').innerHTML = fh;
    document.getElementById('dValue').textContent = usd(r.v);
    document.getElementById('dSteps').innerHTML = r.p.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    document.getElementById('dRisk').textContent = 'Risk note: ' + r.k2;
    document.getElementById('detail').hidden = false;
    // Scroll after layout settles: scrolling during parse can land past the
    // document in headless renders. On a row click the page is already loaded.
    if (document.readyState === 'complete') scrollToDetail();
    else window.addEventListener('load', function () { setTimeout(scrollToDetail, 100); });
  }
  document.getElementById('closeDetail').addEventListener('click', function () {
    document.getElementById('detail').hidden = true;
    history.replaceState(null, '', location.pathname + location.search);
  });
  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) { showDetail(tr.getAttribute('data-slug')); history.replaceState(null, '', '#detail=' + tr.getAttribute('data-slug')); }
  });

  // ---- apart tables
  document.getElementById('liveRows').innerHTML = D.live.map(function (p) {
    return '<tr><td>' + esc(p.name) + '<br><span class="pslug">' + esc(p.slug) + '</span></td><td>' +
      esc(p.category || '—') + '</td><td class="num">' + usd(p.tvl_usd) + '</td><td class="num">' + usd(p.mcap_usd) + '</td></tr>';
  }).join('');
  document.getElementById('tickerRows').innerHTML = D.ticker.top.map(function (p) {
    return '<tr><td>' + esc(p.name) + '<br><span class="pslug">' + esc(p.slug) + '</span></td><td>' +
      esc(p.symbol || '') + '</td><td>' + esc(p.category || '—') + '</td><td class="num">' + usd(p.tvl_usd) + '</td></tr>';
  }).join('');
  document.getElementById('catRows').innerHTML = D.categories.map(function (c) {
    return '<tr><td>' + esc(c.category) + (c.fallback ? ' *' : '') + '</td><td class="num">' + c.comparables +
      '</td><td class="num">' + c.multiple.toFixed(3) + '</td><td class="num">' + c.median_ratio.toFixed(3) +
      '</td><td class="num">' + c.iqr.toFixed(3) + '</td></tr>';
  }).join('');

  // ---- controls
  document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; state.page = 0; render(); });
  catSel.addEventListener('change', function (e) { state.cat = e.target.value; state.page = 0; render(); });
  chainSel.addEventListener('change', function (e) { state.chain = e.target.value; state.page = 0; render(); });
  document.getElementById('wl').addEventListener('change', function (e) { state.wl = e.target.checked; state.page = 0; render(); });
  document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; state.page = 0; render(); });
  document.getElementById('prev').addEventListener('click', function () { if (state.page > 0) { state.page--; render(); } });
  document.getElementById('next').addEventListener('click', function () { state.page++; render(); });

  // ---- hash routing (for screenshots and deep links)
  function applyHash() {
    var h = location.hash.slice(1);
    var parts = {};
    h.split('&').forEach(function (kv) { var p = kv.split('='); if (p[0]) parts[p[0]] = decodeURIComponent(p[1] || ''); });
    if (parts.category && cats.indexOf(parts.category) >= 0) { state.cat = parts.category; catSel.value = parts.category; }
    if (parts.chain && chains.indexOf(parts.chain) >= 0) { state.chain = parts.chain; chainSel.value = parts.chain; }
    if (parts.watchlist === '1') { state.wl = true; document.getElementById('wl').checked = true; }
    render();
    if (parts.detail) showDetail(parts.detail);
  }
  applyHash();
})();
