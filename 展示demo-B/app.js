/* 岐黄智谱 · 路线 A demo 前端逻辑
 * 数据：data.js（由 build-data.mjs 从 PubChem 抓取并本地缓存）
 * 3D：vendor/3Dmol-min.js（本地，断网可用）
 */
(function () {
  'use strict';

  const DATA = window.QH_DATA || { compounds: [] };
  const ALL = (DATA.compounds || []).filter((c) => c.ok !== false);
  if (!ALL.length) {
    document.getElementById('detail').innerHTML =
      '<p style="padding:40px;color:#7c8a82">没有数据，请先运行 <code>node build-data.mjs</code>。</p>';
    return;
  }

  const state = { q: '', herb: '全部', id: ALL[0].id, mode: 'both', style: 'ballstick', spinning: false };
  let viewer = null;
  let spinRAF = null;

  const $ = (s) => document.querySelector(s);
  const listEl = $('#list');
  const chipsEl = $('#chips');
  const detailEl = $('#detail');
  const qEl = $('#q');
  const emptyEl = $('#empty');

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const fmt = (v, d = 2) => (v === null || v === undefined || v === '' ? '—' : Number(v).toFixed(d));

  /* ---------------- 顶部统计 ---------------- */
  const herbs = [...new Set(ALL.map((c) => c.herb))];
  $('#statCount').textContent = ALL.length;
  $('#statHerb').textContent = herbs.length;
  $('#statDate').textContent = (DATA.generatedAt || '').slice(0, 10);

  /* ---------------- 药味筛选 ---------------- */
  function renderChips() {
    const items = [['全部', ALL.length], ...herbs.map((h) => [h, ALL.filter((c) => c.herb === h).length])];
    chipsEl.innerHTML = items
      .map(
        ([name, n]) =>
          `<button class="chip ${state.herb === name ? 'on' : ''}" data-herb="${esc(name)}">${esc(name)}<span class="n">${n}</span></button>`
      )
      .join('');
  }

  /* ---------------- 列表 ---------------- */
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return ALL.filter((c) => {
      if (state.herb !== '全部' && c.herb !== state.herb) return false;
      if (!q) return true;
      return [c.cn, c.en, c.formula, c.cid, c.herb, c.title].join(' ').toLowerCase().includes(q);
    });
  }

  function renderList() {
    const rows = filtered();
    listEl.innerHTML = rows
      .map(
        (c) => `
      <div class="item ${c.id === state.id ? 'on' : ''}" data-id="${c.id}" role="button" tabindex="0">
        <img class="thumb" src="${esc(c.png2d)}" alt="${esc(c.cn)} 2D 结构">
        <div class="meta">
          <div class="cn">${esc(c.cn)}</div>
          <div class="en">${esc(c.en)}</div>
          <div class="row">
            <span class="herb">${esc(c.herb)}</span>
            <span class="cid">CID ${esc(c.cid)}</span>
          </div>
        </div>
      </div>`
      )
      .join('');
    emptyEl.hidden = rows.length > 0;
  }

  /* ---------------- 详情骨架（只建一次，保住 3D 容器） ---------------- */
  detailEl.innerHTML = `
    <div class="detail-head">
      <div>
        <div class="kicker">成 分</div>
        <h2><span id="dCn"></span><span class="en" id="dEn"></span></h2>
        <div class="tags" id="dTags"></div>
      </div>
      <div class="navbtns">
        <button id="prev" title="上一个（↑）">←</button>
        <button id="next" title="下一个（↓）">→</button>
      </div>
    </div>

    <div class="viewers" id="viewers">
      <figure class="panel p2d">
        <div class="panel-head"><span>2D 结构式</span><span class="src">PubChem · PNG</span></div>
        <div class="panel-body"><img id="img2d" alt="2D 结构"></div>
      </figure>
      <figure class="panel p3d">
        <div class="panel-head"><span>3D 构象</span><span class="src" id="src3d">PubChem · SDF · 可拖拽</span></div>
        <div class="panel-body">
          <div id="viewer3d"></div>
          <div class="fallback" id="fallback3d"></div>
        </div>
        <div class="viewer-tools">
          <button id="reset3d">重置视角</button>
          <button id="spin3d">自旋</button>
          <button id="style3d">线框</button>
        </div>
      </figure>
    </div>

    <div class="props" id="dProps"></div>

    <div class="ids">
      <div class="idrow"><label>SMILES</label><code id="dSmiles"></code><button data-copy="dSmiles">复制</button></div>
      <div class="idrow"><label>InChIKey</label><code id="dInchi"></code><button data-copy="dInchi">复制</button></div>
      <div class="idrow"><label>IUPAC</label><code id="dIupac"></code></div>
    </div>

    <div class="trace">
      <span class="dotline"></span>
      <span>可回溯：</span>
      <span id="dTrace"></span>
      <a id="dLink" href="#" target="_blank" rel="noopener">打开 PubChem 页面 ↗</a>
    </div>
    <div class="trace" style="padding-top:4px">
      <span style="font-family:var(--mono);font-size:10.5px;color:#9aa69f">
        2D: /rest/pug/compound/cid/{CID}/PNG?record_type=2d &nbsp;·&nbsp;
        3D: /rest/pug/compound/cid/{CID}/SDF?record_type=3d
      </span>
    </div>`;

  /* ---------------- 填充详情 ---------------- */
  function current() {
    return ALL.find((c) => c.id === state.id) || ALL[0];
  }

  function fillDetail(c) {
    $('#dCn').textContent = c.cn;
    $('#dEn').textContent = c.en;
    $('#dTags').innerHTML = [
      `<span class="tag">${esc(c.herb)}</span>`,
      `<span class="tag">${esc(c.formula || '—')}</span>`,
      `<span class="tag">PubChem CID ${esc(c.cid)}</span>`,
      c.sdfType === '3d' ? '' : '<span class="tag warn">无 3D 构象</span>',
    ].join('');

    $('#img2d').src = c.png2d;
    $('#img2d').alt = `${c.cn} 的 2D 结构式`;

    $('#dProps').innerHTML = [
      ['分子量', fmt(c.mw), 'g/mol'],
      ['分子式', c.formula || '—', ''],
      ['XLogP', fmt(c.xlogp, 1), ''],
      ['TPSA', fmt(c.tpsa, 1), 'Å²'],
      ['氢键供体', c.hbd ?? '—', ''],
      ['氢键受体', c.hba ?? '—', ''],
      ['可旋转键', c.rotb ?? '—', ''],
      ['重原子数', c.heavy ?? '—', ''],
    ]
      .map(
        ([k, v, u]) =>
          `<div class="prop"><span class="k">${k}</span><span class="v">${esc(v)}${u ? `<small>${u}</small>` : ''}</span></div>`
      )
      .join('');

    $('#dSmiles').textContent = c.smiles || '—';
    $('#dInchi').textContent = c.inchiKey || '—';
    $('#dIupac').textContent = c.iupac || '—';

    $('#dTrace').textContent = `PubChem CID ${c.cid} · 抓取于 ${c.retrievedAt || DATA.generatedAt?.slice(0, 10) || '—'}`;
    $('#dLink').href = `https://pubchem.ncbi.nlm.nih.gov/compound/${c.cid}`;

    $('#src3d').textContent = c.sdfType === '3d' ? 'PubChem · SDF · 可拖拽' : 'PubChem 未提供 3D';
    mount3D(c);
  }

  /* ---------------- 3D 渲染 ---------------- */
  function applyStyle() {
    if (!viewer) return;
    const scheme = { colorscheme: 'Jmol' };
    const st =
      state.style === 'line'
        ? { line: { linewidth: 2.5, ...scheme } }
        : { stick: { radius: 0.13, ...scheme }, sphere: { scale: 0.27, ...scheme } };
    viewer.setStyle({}, st);
    viewer.render();
  }

  function showFallback(c, msg) {
    const fb = $('#fallback3d');
    fb.classList.add('show');
    fb.innerHTML = `<img src="${esc(c.png2d)}" alt=""><p>${esc(msg)}</p>`;
  }

  function mount3D(c) {
    const fb = $('#fallback3d');
    fb.classList.remove('show');
    stopSpin();

    if (c.sdfType !== '3d') {
      showFallback(c, 'PubChem 未收录该成分的 3D 构象（多为大分子或柔性链），无法生成可旋转的 3D 视图。这是真实存在的数据缺口。');
      return;
    }
    if (typeof window.$3Dmol === 'undefined') {
      showFallback(c, '3D 组件未加载（vendor/3Dmol-min.js 缺失），已回退为 2D 结构。');
      return;
    }
    try {
      if (!viewer) {
        viewer = window.$3Dmol.createViewer(document.getElementById('viewer3d'), {
          backgroundColor: '#ffffff',
          antialias: true,
        });
      }
      viewer.removeAllModels();
      viewer.addModel(c.sdf, 'sdf');
      applyStyle();
      viewer.zoomTo();
      viewer.render();
      viewer.resize();
    } catch (e) {
      showFallback(c, '当前浏览器无法创建 WebGL 上下文，已回退为 2D 结构（换 Chrome/Edge 可看 3D）。');
    }
  }

  function stopSpin() {
    state.spinning = false;
    $('#spin3d')?.classList.remove('on');
    if (spinRAF) cancelAnimationFrame(spinRAF);
    spinRAF = null;
  }

  function toggleSpin() {
    if (state.spinning) return stopSpin();
    state.spinning = true;
    $('#spin3d').classList.add('on');
    const step = () => {
      if (!state.spinning) { spinRAF = null; return; }
      try { viewer.rotate(1.2, 'y'); viewer.render(); } catch (e) { /* ignore */ }
      spinRAF = requestAnimationFrame(step);
    };
    spinRAF = requestAnimationFrame(step);
  }

  /* ---------------- 交互 ---------------- */
  function select(id, updateHash = true) {
    state.id = id;
    if (updateHash) history.replaceState(null, '', '#' + id);
    renderList();
    fillDetail(current());
    listEl.querySelector('.item.on')?.scrollIntoView({ block: 'nearest' });
  }

  function step(delta) {
    const rows = filtered();
    if (!rows.length) return;
    const i = rows.findIndex((c) => c.id === state.id);
    const next = rows[(i + delta + rows.length) % rows.length];
    select(next.id);
  }

  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.item');
    if (item) select(item.dataset.id);
  });
  listEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      const item = e.target.closest('.item');
      if (item) { e.preventDefault(); select(item.dataset.id); }
    }
  });

  chipsEl.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    state.herb = chip.dataset.herb;
    renderChips();
    renderList();
    const rows = filtered();
    if (rows.length && !rows.some((c) => c.id === state.id)) select(rows[0].id);
  });

  qEl.addEventListener('input', () => {
    state.q = qEl.value;
    renderList();
    const rows = filtered();
    if (rows.length && !rows.some((c) => c.id === state.id)) select(rows[0].id);
    if (!rows.length) { renderList(); }
  });

  $('#mode').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    state.mode = b.dataset.mode;
    [...$('#mode').children].forEach((x) => x.classList.toggle('on', x === b));
    const v = $('#viewers');
    v.classList.toggle('only2d', state.mode === '2d');
    v.classList.toggle('only3d', state.mode === '3d');
    requestAnimationFrame(() => { try { viewer?.resize(); } catch (e) {} });
  });

  $('#prev').addEventListener('click', () => step(-1));
  $('#next').addEventListener('click', () => step(1));

  $('#reset3d').addEventListener('click', () => {
    stopSpin();
    try { viewer.zoomTo(); viewer.render(); } catch (e) {}
  });

  $('#spin3d').addEventListener('click', toggleSpin);

  $('#style3d').addEventListener('click', (e) => {
    state.style = state.style === 'line' ? 'ballstick' : 'line';
    e.target.textContent = state.style === 'line' ? '球棍' : '线框';
    e.target.classList.toggle('on', state.style === 'line');
    applyStyle();
  });

  detailEl.addEventListener('click', async (e) => {
    const btn = e.target.closest('[data-copy]');
    if (!btn) return;
    const text = document.getElementById(btn.dataset.copy)?.textContent || '';
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
    }
    const old = btn.textContent;
    btn.textContent = '已复制';
    setTimeout(() => (btn.textContent = old), 1200);
  });

  document.addEventListener('keydown', (e) => {
    if (e.target.tagName === 'INPUT') return;
    if (e.key === 'ArrowDown') { e.preventDefault(); step(1); }
    if (e.key === 'ArrowUp') { e.preventDefault(); step(-1); }
  });

  window.addEventListener('resize', () => { try { viewer?.resize(); } catch (e) {} });

  window.addEventListener('hashchange', () => {
    const id = location.hash.slice(1);
    if (id && id !== state.id && ALL.some((c) => c.id === id)) select(id, false);
  });

  /* ---------------- 启动 ---------------- */
  const initial = location.hash.slice(1);
  if (initial && ALL.some((c) => c.id === initial)) state.id = initial;

  renderChips();
  renderList();
  fillDetail(current());
})();
