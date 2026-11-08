/* 岐黄智谱 · 路线 B 前端
 * 数据：local.js（由 build-local.py 用本地 RDKit 生成，含 2D SVG 路径与 3D SDF）
 */
(function () {
  'use strict';

  const DATA = window.QH_LOCAL || { compounds: [] };
  const ALL = (DATA.compounds || []).filter((c) => c.ok);
  if (!ALL.length) {
    document.getElementById('detail').innerHTML =
      '<p style="padding:40px;color:#7c8a82">没有数据，请先运行 <code>build-local.py</code>。</p>';
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
  const st = DATA.stats || {};
  $('#statCount').textContent = ALL.length;
  $('#stat3d').textContent = `${st.embed_ok ?? ALL.filter((c) => c.embed3d).length}/${st.n ?? ALL.length}`;
  $('#statTime').textContent = `${((st.total_ms ?? 0) / 1000).toFixed(2)} s`;
  $('#engine').textContent = DATA.engine || 'RDKit';

  /* ---------------- 药味筛选 ---------------- */
  function renderChips() {
    const items = [['全部', ALL.length], ...herbs.map((h) => [h, ALL.filter((c) => c.herb === h).length])];
    chipsEl.innerHTML = items
      .map(([name, n]) =>
        `<button class="chip ${state.herb === name ? 'on' : ''}" data-herb="${esc(name)}">${esc(name)}<span class="n">${n}</span></button>`)
      .join('');
  }

  /* ---------------- 列表 ---------------- */
  function filtered() {
    const q = state.q.trim().toLowerCase();
    return ALL.filter((c) => {
      if (state.herb !== '全部' && c.herb !== state.herb) return false;
      if (!q) return true;
      return [c.cn, c.en, c.formula, c.cid, c.herb].join(' ').toLowerCase().includes(q);
    });
  }

  function renderList() {
    const rows = filtered();
    listEl.innerHTML = rows
      .map((c) => `
      <div class="item ${c.id === state.id ? 'on' : ''}" data-id="${c.id}" role="button" tabindex="0">
        <img class="thumb" src="${esc(c.svg)}" alt="${esc(c.cn)} 2D 结构">
        <div class="meta">
          <div class="cn">${esc(c.cn)}</div>
          <div class="en">${esc(c.en)}</div>
          <div class="row">
            <span class="herb">${esc(c.herb)}</span>
            ${c.aHas3d ? '' : '<span class="badge">A 缺 3D</span>'}
          </div>
        </div>
      </div>`)
      .join('');
    emptyEl.hidden = rows.length > 0;
  }

  /* ---------------- 对比卡 ---------------- */
  function renderCompare() {
    const total = ALL.length;
    const aOk = ALL.filter((c) => c.aHas3d).length;
    const bOk = ALL.filter((c) => c.embed3d).length;
    const fixed = ALL.filter((c) => !c.aHas3d && c.embed3d).map((c) => c.cn);
    $('#compare').innerHTML = `
      <div class="t">3D 构象覆盖对比</div>
      <div class="row a"><span>路线 A · PubChem</span><b>${aOk}/${total}</b></div>
      <div class="row b"><span>路线 B · 本地 RDKit</span><b>${bOk}/${total}</b></div>
      <div class="note">本地管线补齐了 ${fixed.length} 个 PubChem 没有构象的大分子：${esc(fixed.join('、'))}</div>`;
  }

  /* ---------------- 详情骨架 ---------------- */
  detailEl.innerHTML = `
    <div class="detail-head">
      <div>
        <div class="kicker">成 分 · 路 线 B</div>
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
        <div class="panel-head"><span>2D 结构式</span><span class="local">本地绘制 · SVG</span></div>
        <div class="panel-body"><img id="img2d" alt="2D 结构"></div>
      </figure>
      <figure class="panel p3d">
        <div class="panel-head"><span>3D 构象</span><span class="local" id="src3d">本地生成 · ETKDG + MMFF94</span></div>
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

    <div class="pipeline" id="pipeline"></div>
    <div class="rules" id="rules"></div>
    <div class="props" id="dProps"></div>

    <div class="ids">
      <div class="idrow"><label>输入 SMILES</label><code id="dSmiIn"></code><button data-copy="dSmiIn">复制</button></div>
      <div class="idrow"><label>标准化后</label><code id="dSmiOut"></code><button data-copy="dSmiOut">复制</button></div>
      <div class="idrow"><label>InChIKey</label><code id="dInchi"></code><button data-copy="dInchi">复制</button></div>
    </div>

    <div class="trace">
      <span class="dotline"></span>
      <span>全部由本地 RDKit 生成 · 未发起任何网络请求 · ${esc(DATA.generatedAt || '')}</span>
    </div>`;

  /* ---------------- 填充详情 ---------------- */
  const current = () => ALL.find((c) => c.id === state.id) || ALL[0];

  function renderPipeline(c) {
    const steps = [
      { t: '解析 SMILES', m: `MolFromSmiles · ${c.msParse ?? 0}ms`, ok: true },
      { t: '标准化', m: `${esc((c.notes || ['—'])[0])} · ${c.msStd ?? 0}ms`, ok: true },
      { t: '2D 描绘', m: `SVG ${c.svgKB ?? 0}KB · ${c.msDraw ?? 0}ms`, ok: true },
      {
        t: '3D 嵌入',
        m: c.embed3d ? `ETKDGv3 + MMFF94 · ${c.msEmbed ?? 0}ms` : '嵌入失败，已降级',
        ok: !!c.embed3d,
      },
      { t: '描述符', m: `12 项 · Lipinski · 即时`, ok: true },
    ];
    $('#pipeline').innerHTML = steps
      .map((s, i) => `
        <div class="step ${s.ok ? 'done' : 'fail'}">
          <div class="idx">${i + 1}</div>
          <div class="body"><div class="t">${s.t}</div><div class="m">${s.m}</div></div>
        </div>`)
      .join('');
  }

  function renderRules(c) {
    const v = c.violations ?? 0;
    $('#rules').innerHTML = `
      <span class="rule ${v === 0 ? 'ok' : 'warn'}">Lipinski 违规 <b>${v}</b>/4</span>
      <span class="rule">立体中心 <b>${c.stereo ?? 0}</b></span>
      <span class="rule">环 <b>${c.rings ?? 0}</b>（芳香 ${c.aromaticRings ?? 0}）</span>
      <span class="rule">Fsp³ <b>${fmt(c.fsp3, 2)}</b></span>
      <span class="rule">标准化：${esc((c.notes || ['—'])[0])}</span>`;
  }

  function fillDetail(c) {
    $('#dCn').textContent = c.cn;
    $('#dEn').textContent = c.en;
    $('#dTags').innerHTML = [
      `<span class="tag">${esc(c.herb)}</span>`,
      `<span class="tag">${esc(c.formula || '—')}</span>`,
      `<span class="tag">PubChem CID ${esc(c.cid ?? '—')}</span>`,
      `<span class="tag">本地生成</span>`,
      c.aHas3d ? '' : '<span class="tag warn">A 缺 3D · B 已补齐</span>',
    ].join('');

    $('#img2d').src = c.svg;
    $('#img2d').alt = `${c.cn} 的 2D 结构式`;

    renderPipeline(c);
    renderRules(c);

    $('#dProps').innerHTML = [
      ['分子量', fmt(c.mw), 'g/mol'],
      ['分子式', c.formula || '—', ''],
      ['LogP', fmt(c.logp, 2), ''],
      ['TPSA', fmt(c.tpsa, 1), 'Å²'],
      ['氢键供体', c.hbd ?? '—', ''],
      ['氢键受体', c.hba ?? '—', ''],
      ['可旋转键', c.rotb ?? '—', ''],
      ['重原子数', c.heavy ?? '—', ''],
    ]
      .map(([k, v, u]) =>
        `<div class="prop"><span class="k">${k}</span><span class="v">${esc(v)}${u ? `<small>${u}</small>` : ''}</span></div>`)
      .join('');

    $('#dSmiIn').textContent = c.smilesIn || '—';
    $('#dSmiOut').textContent = c.smilesCanonical || '—';
    $('#dInchi').textContent = c.inchiKey || '—';

    mount3D(c);
  }

  /* ---------------- 3D ---------------- */
  function applyStyle() {
    if (!viewer) return;
    const scheme = { colorscheme: 'Jmol' };
    const st = state.style === 'line'
      ? { line: { linewidth: 2.5, ...scheme } }
      : { stick: { radius: 0.13, ...scheme }, sphere: { scale: 0.27, ...scheme } };
    viewer.setStyle({}, st);
    viewer.render();
  }

  function showFallback(c, msg) {
    const fb = $('#fallback3d');
    fb.classList.add('show');
    fb.innerHTML = `<img src="${esc(c.svg)}" alt=""><p>${esc(msg)}</p>`;
  }

  function mount3D(c) {
    const fb = $('#fallback3d');
    fb.classList.remove('show');
    stopSpin();

    if (!c.embed3d || !c.sdf) {
      showFallback(c, '该分子 3D 嵌入失败（多为柔性过大），已降级为 2D 展示。');
      return;
    }
    if (typeof window.$3Dmol === 'undefined') {
      showFallback(c, '3D 组件未加载（vendor/3Dmol-min.js 缺失），已回退为 2D 结构。');
      return;
    }
    try {
      if (!viewer) {
        viewer = window.$3Dmol.createViewer(document.getElementById('viewer3d'), {
          backgroundColor: '#ffffff', antialias: true,
        });
      }
      viewer.removeAllModels();
      viewer.addModel(c.sdf, 'sdf');
      applyStyle();
      viewer.zoomTo();
      viewer.render();
      viewer.resize();
    } catch (e) {
      showFallback(c, '当前浏览器无法创建 WebGL 上下文，已回退为 2D 结构。');
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
      try { viewer.rotate(1.2, 'y'); viewer.render(); } catch (e) {}
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
    select(rows[(i + delta + rows.length) % rows.length].id);
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
  $('#reset3d').addEventListener('click', () => { stopSpin(); try { viewer.zoomTo(); viewer.render(); } catch (e) {} });
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
  renderCompare();
  fillDetail(current());
})();
