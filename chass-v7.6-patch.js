/* CHASS KEIBA LAB Ver.7.6 patch
   Goals:
   1) AI fair odds / real odds / expected return are strictly separated.
   2) Market snapshots are preserved per race.
   3) Dashboard tables are mobile-friendly.
   4) No "expected return" is shown as confirmed unless real odds are available.
*/
(() => {
  'use strict';

  const VERSION = '7.6';
  const SNAP_KEY = 'chass_market_snapshots_v76';

  const $v76 = (id) => document.getElementById(id);
  const n76 = (v) => {
    const x = parseFloat(v);
    return Number.isFinite(x) ? x : null;
  };
  const esc76 = (s='') => String(s).replace(/[&<>"']/g, m => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'
  }[m]));

  function raceKey76() {
    const d = String($v76('raceDate')?.value || '');
    const t = String($v76('track')?.value || '');
    const r = String($v76('raceNo')?.value || '');
    return `${d}|${t}|${r}`;
  }

  function loadSnaps76() {
    try { return JSON.parse(localStorage.getItem(SNAP_KEY) || '{}'); }
    catch { return {}; }
  }
  function saveSnaps76(v) {
    localStorage.setItem(SNAP_KEY, JSON.stringify(v));
  }

  function currentHorseMarket76() {
    return [...document.querySelectorAll('.horse-row')]
      .map((row, i) => {
        let h = null;
        try { h = horseFromRow(row); } catch {}
        if (!h) return null;
        const name = String(h['horse-name'] || '').trim();
        if (!name) return null;
        const win = n76(h.win), place = n76(h.place), odds = n76(h.odds), pop = n76(h.pop);
        const fair = win && win > 0 ? 100 / win : null;
        return {
          no: String(h['horse-no'] || i + 1),
          name,
          mark: h.mark || '',
          win, place, odds, pop, fair
        };
      }).filter(Boolean);
  }

  function marketKind76() {
    const t = String($v76('oddsType')?.value || '').trim();
    if (t === '実オッズ') return 'real';
    if (t === '予想オッズ') return 'predicted';
    if (t === '種別不明') return 'unknown';
    return 'none';
  }

  function captureSnapshot76(source='ui') {
    const horses = currentHorseMarket76();
    if (!horses.length || !horses.some(h => h.odds && h.odds > 0)) return;
    const key = raceKey76();
    if (!key || key === '||') return;

    const db = loadSnaps76();
    db[key] ||= [];
    const kind = marketKind76();
    const checkedAt = String($v76('oddsCheckedAt')?.value || '');
    const sig = JSON.stringify(horses.map(h => [h.no, h.odds, h.pop]));
    const last = db[key][db[key].length - 1];
    if (last && last.sig === sig && last.kind === kind && last.checkedAt === checkedAt) return;

    db[key].push({
      at: new Date().toISOString(),
      source,
      kind,
      oddsType: String($v76('oddsType')?.value || ''),
      checkedAt,
      horses: horses.map(h => ({ no:h.no, name:h.name, odds:h.odds, pop:h.pop })),
      sig
    });
    if (db[key].length > 40) db[key] = db[key].slice(-40);
    saveSnaps76(db);
  }

  function getSnapshotPair76() {
    const list = loadSnaps76()[raceKey76()] || [];
    const priced = list.filter(x => (x.horses || []).some(h => h.odds));
    if (!priced.length) return { first:null, final:null, latest:null };

    const firstReal = priced.find(x => x.kind === 'real') || null;
    const finalReal = [...priced].reverse().find(x =>
      x.kind === 'real' && (/最終/.test(x.checkedAt || '') || x.source === 'official-final')
    ) || null;
    return {
      first: firstReal || priced[0],
      final: finalReal,
      latest: priced[priced.length - 1]
    };
  }

  function valueLabel76(h, kind) {
    if (!h.fair) return { main:'AIフェア —', sub:'AI勝率未計算', cls:'' };
    if (kind !== 'real' || !h.odds) {
      const src = kind === 'predicted' ? '予想オッズ' : kind === 'unknown' ? '種別不明オッズ' : '市場未取得';
      return {
        main:`AIフェア ${h.fair.toFixed(1)}倍`,
        sub:`実オッズ — ｜ 期待回収率 —（${src}）`,
        cls:''
      };
    }
    const ev = h.win * h.odds;
    const gap = h.odds / h.fair;
    let cls = '', tag = '適正圏';
    if (ev >= 125 && (h.pop ?? 0) >= 8 && (h.place ?? 0) >= 18) { cls='v76-diamond3'; tag='💎💎💎 大穴'; }
    else if (ev >= 110 && (h.pop ?? 0) >= 4) { cls='v76-diamond'; tag='💎 期待値'; }
    else if (ev < 82 && (h.pop ?? 99) <= 3) { cls='v76-warning'; tag='⚠️ 人気馬注意'; }

    return {
      main:`${tag} ｜ 期待回収率 ${ev.toFixed(0)}%`,
      sub:`実 ${h.odds.toFixed(1)}倍 ｜ AIフェア ${h.fair.toFixed(1)}倍 ｜ 市場/AI ${gap.toFixed(2)}x`,
      cls
    };
  }

  function ensureMarketCard76() {
    let card = $v76('v76MarketDiscipline');
    if (card) return card;

    card = document.createElement('section');
    card.id = 'v76MarketDiscipline';
    card.className = 'card v76-market-card';
    card.innerHTML = `
      <div class="section-head">
        <div><p class="eyebrow">MARKET CHECK</p><h2>AIフェア・実オッズ・期待回収率</h2></div>
        <span id="v76MarketBadge" class="badge">市場待ち</span>
      </div>
      <div class="v76-market-note">
        AIフェア倍率と実オッズを分離表示します。期待回収率は「実オッズ」と確認できた場合だけ確定表示します。
      </div>
      <div id="v76MarketRows" class="v76-market-list"></div>
      <div id="v76SnapshotInfo" class="muted v76-snapshot-info"></div>
    `;

    const finalCard = [...document.querySelectorAll('section.card')].find(x =>
      /最終判断/.test(x.textContent || '')
    );
    const quick = document.querySelector('.quick-card');
    if (finalCard?.parentNode) finalCard.insertAdjacentElement('afterend', card);
    else if (quick?.parentNode) quick.insertAdjacentElement('beforebegin', card);
    else document.querySelector('#predictionView')?.prepend(card);
    return card;
  }

  function renderMarketDiscipline76() {
    const card = ensureMarketCard76();
    if (!card) return;

    const horses = currentHorseMarket76();
    const list = $v76('v76MarketRows');
    const badge = $v76('v76MarketBadge');
    const info = $v76('v76SnapshotInfo');

    if (!horses.length) {
      card.hidden = true;
      return;
    }
    card.hidden = false;

    const kind = marketKind76();
    if (badge) {
      badge.textContent = kind === 'real' ? '実オッズ確認済'
        : kind === 'predicted' ? '予想オッズ'
        : kind === 'unknown' ? '種別不明'
        : '市場待ち';
    }

    const rows = [...horses]
      .sort((a,b) => (b.win ?? -1) - (a.win ?? -1))
      .map(h => {
        const v = valueLabel76(h, kind);
        return `<article class="v76-market-row ${v.cls}">
          <div class="v76-market-head">
            <strong class="horse-number-badge">${esc76(h.no)}</strong>
            <span class="v76-mark">${esc76(h.mark || '')}</span>
            <strong>${esc76(h.name)}</strong>
          </div>
          <div class="v76-market-grid">
            <div><span>AI勝率</span><strong>${h.win == null ? '—' : h.win.toFixed(1)+'%'}</strong></div>
            <div><span>AIフェア</span><strong>${h.fair == null ? '—' : h.fair.toFixed(1)+'倍'}</strong></div>
            <div><span>実オッズ</span><strong>${kind === 'real' && h.odds ? h.odds.toFixed(1)+'倍' : '—'}</strong></div>
          </div>
          <div class="v76-value-line"><strong>${esc76(v.main)}</strong><span>${esc76(v.sub)}</span></div>
        </article>`;
      }).join('');

    if (list) list.innerHTML = rows;
    const pair = getSnapshotPair76();
    if (info) {
      const a = pair.first ? `初回市場 ${pair.first.checkedAt || pair.first.at}` : '初回市場 —';
      const b = pair.final ? `最終市場 ${pair.final.checkedAt || pair.final.at}` : '最終市場 —';
      info.textContent = `市場履歴｜${a} ｜ ${b}`;
    }
  }

  function attachTableLabels76(root=document) {
    root.querySelectorAll('table').forEach(table => {
      const heads = [...table.querySelectorAll('thead th')].map(x => x.textContent.trim());
      table.querySelectorAll('tbody tr').forEach(tr => {
        [...tr.children].forEach((td, i) => {
          if (heads[i]) td.setAttribute('data-label', heads[i]);
        });
      });
    });
  }

  function injectStyles76() {
    if ($v76('v76Styles')) return;
    const s = document.createElement('style');
    s.id = 'v76Styles';
    s.textContent = `
      .v76-market-note{padding:12px 14px;border:1px solid rgba(116,239,199,.22);border-radius:14px;margin-bottom:14px;line-height:1.55}
      .v76-market-list{display:grid;gap:12px}
      .v76-market-row{border:1px solid rgba(145,166,205,.24);border-radius:18px;padding:14px;background:rgba(255,255,255,.015)}
      .v76-market-row.v76-diamond,.v76-market-row.v76-diamond3{border-color:rgba(94,224,190,.6)}
      .v76-market-row.v76-warning{border-color:rgba(255,190,70,.55)}
      .v76-market-head{display:flex;align-items:center;gap:10px;margin-bottom:12px;font-size:1.05rem}
      .v76-mark{min-width:1.2em;text-align:center}
      .v76-market-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}
      .v76-market-grid>div{border:1px solid rgba(145,166,205,.22);border-radius:13px;padding:9px;text-align:center}
      .v76-market-grid span{display:block;font-size:.72rem;opacity:.72;margin-bottom:3px}
      .v76-market-grid strong{font-size:1rem}
      .v76-value-line{margin-top:10px;display:grid;gap:3px}
      .v76-value-line span{font-size:.82rem;opacity:.78}
      .v76-snapshot-info{margin-top:12px;font-size:.82rem}
      @media(max-width:680px){
        .v76-market-grid{grid-template-columns:repeat(3,minmax(0,1fr))}
        #dashboardView .table-wrap{overflow:visible}
        #dashboardView table{display:block;width:100%;min-width:0}
        #dashboardView thead{display:none}
        #dashboardView tbody{display:grid;gap:10px}
        #dashboardView tr{display:grid;grid-template-columns:1fr 1fr;gap:7px 12px;border:1px solid rgba(145,166,205,.22);border-radius:16px;padding:12px}
        #dashboardView td{display:flex;justify-content:space-between;gap:8px;border:0!important;padding:5px 0!important;min-width:0}
        #dashboardView td::before{content:attr(data-label);opacity:.65;font-size:.78rem}
        #dashboardView td:first-child{grid-column:1/-1;font-weight:800;font-size:1.02rem}
        #dashboardView td:first-child::before{display:none}
      }
    `;
    document.head.appendChild(s);
  }

  function updateVersion76() {
    document.title = document.title.replace(/Ver\.\d+(?:\.\d+)?/g, `Ver.${VERSION}`);
    document.querySelectorAll('h1 span').forEach(x => {
      if (/Ver\./.test(x.textContent || '')) x.textContent = `Ver.${VERSION}`;
    });
  }

  // Attach market snapshots to the normal saved race object.
  try {
    const oldGetForm = getForm;
    getForm = function() {
      const d = oldGetForm();
      const pair = getSnapshotPair76();
      const list = loadSnaps76()[raceKey76()] || [];
      d.marketSnapshots = list.map(x => ({
        at:x.at, source:x.source, kind:x.kind, oddsType:x.oddsType,
        checkedAt:x.checkedAt, horses:x.horses
      }));
      d.marketFirst = pair.first || null;
      d.marketFinal = pair.final || null;
      return d;
    };
  } catch {}

  // Capture ordinary market input before/after ranking refresh.
  try {
    const oldRenderValueRanking = renderValueRanking;
    renderValueRanking = function(...args) {
      const out = oldRenderValueRanking.apply(this, args);
      captureSnapshot76('ui');
      renderMarketDiscipline76();
      return out;
    };
  } catch {}

  // Capture official NAR data. If checkedAt says "最終", preserve it as final market.
  try {
    const oldApplyOfficialOdds = applyOfficialOdds;
    applyOfficialOdds = function(data) {
      const n = oldApplyOfficialOdds(data);
      if (n) {
        captureSnapshot76(/最終/.test(String(data?.checkedAt || '')) ? 'official-final' : 'official');
        renderMarketDiscipline76();
      }
      return n;
    };
  } catch {}

  // Keep dashboard labels fresh after rerender.
  try {
    const oldRenderDashboard = renderDashboard;
    renderDashboard = function(...args) {
      const out = oldRenderDashboard.apply(this, args);
      setTimeout(() => attachTableLabels76($v76('dashboardView') || document), 0);
      return out;
    };
  } catch {}

  function boot76() {
    injectStyles76();
    updateVersion76();
    captureSnapshot76('boot');
    renderMarketDiscipline76();
    attachTableLabels76();
    document.addEventListener('input', (e) => {
      if (e.target?.matches?.('.odds,.pop,.win,.place,#oddsCheckedAt')) {
        setTimeout(() => {
          captureSnapshot76('input');
          renderMarketDiscipline76();
        }, 40);
      }
    });
    document.addEventListener('change', (e) => {
      if (e.target?.matches?.('.odds,.pop,.win,.place,#oddsCheckedAt,#oddsType')) {
        setTimeout(() => {
          captureSnapshot76('change');
          renderMarketDiscipline76();
        }, 40);
      }
    });

    const obs = new MutationObserver(() => {
      clearTimeout(window.__v76mut);
      window.__v76mut = setTimeout(() => {
        renderMarketDiscipline76();
        attachTableLabels76();
      }, 120);
    });
    obs.observe(document.body, {childList:true, subtree:true});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot76);
  else boot76();
})();
