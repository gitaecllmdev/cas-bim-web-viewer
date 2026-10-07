// Demo 08: Panel Shipper (a concept). The framed panels go to site in delivery batches, one per floor in the order the
// floors are built (with the date its framing starts, from the schedule in Demo 3), loaded flat on 48 ft flatbeds:
// the truck and its stacks in 3D (truck.mjs, an SVG over the 3D pane), the floor plan beside it as the reference with
// the truck's panels highlighted and named, and the list of trucks and panels. Planning: shipping.mjs.
// Panels: every framed wall of the takeoff (split into panels of 40 ft or less, weights from a framing layout of each),
// or only the panels drawn in Demo 6 (their own layouts, and their shop drawings a click away).
// Shared views (colors, isolate, select, plan labels, levels): core/client/views.js.
import { loadState, fetchJson, escapeHtml, downloadCsv, stateFor, onModelReady, loadPropertyMap, getWallData } from '../../helpers.js';
import { DemoToolbar } from '../../toolbar.js';
import { assemblyFor } from '../02-takeoff/calc.mjs';
import { frameWall, fmtFtIn } from '../common/framing.mjs';
import { INDEX_STATE, entryLayout } from '../06-shop-drawings/panels.mjs';
import { linkActivities, fmtDay } from '../03-progress/p6.mjs';
import { TRAILER, panelWeight, planBatches } from './shipping.mjs';
import { truckSvg } from './truck.mjs';

const EXTENSION_ID = 'Drywall.PanelShipper';
const MAX_PANEL_IN = 40 * 12; // a longer wall is split into equal panels no longer than this
const BATCH_COLORS = ['#e8a33d', '#5b8fd6', '#6bb26b', '#c96bc9', '#d9534f', '#3fb8af', '#a0784b', '#7f7fd5', '#e377c2', '#8c8c3e', '#17becf', '#bc8f8f', '#9467bd', '#2ca02c'];
const NOT_SET = 'Not set';

class PanelShipperExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        this.source = 'walls'; // 'walls': every framed wall; 'shops': the panels drawn in Demo 6
        this.filter = { batch: '', type: '', find: '' };
        this.truckNo = null;
        this.picked = null; // a panel key
        this.panel.innerHTML = '<div class="demo-panel ps"><h2>Panel Shipper</h2><p class="muted" data-status>Waiting for a model…</p></div>';
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            // The floors and their order arrive after the walls: plan again in build order, with the framing dates.
            // After the views open their own first plan (right after 'ready'), so the truck's floor plan is the one shown.
            this.views.on('ready', () => setTimeout(async () => {
                if (!this.walls) return;
                this.plan();
                this.render();
                await this.views.sheetQueue;
                this.showTruck(this.trucks.find(t => t.panels > 1)?.no ?? 1);
            }, 0)),
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        this.bar?.remove();
        this.overlay?.remove();
        this.views.setPlanLabels(null);
        this.views.clearColors();
        this.views.showAll();
        this.panel.classList.remove('wide');
        this.panel.innerHTML = '';
        return true;
    }

    // Extension.onToolbarCreated: https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Extension/
    onToolbarCreated() {
        if (this.bar) return;
        this.bar = new DemoToolbar(this.viewer, 'dw-shipper', [
            { key: 'prev', icon: 'dw-icon-prev', tip: 'Previous truck', run: () => this.step(-1) },
            { key: 'next', icon: 'dw-icon-next', tip: 'Next truck', run: () => this.step(1) },
            { key: 'truck', icon: 'dw-icon-truck', tip: 'The truck, or the 3D model with its panels', run: () => this.setTruckShown(!this.truckShown), on: () => this.truckShown },
        ]);
    }

    async init(model) {
        try {
            const [map, rules, snapshot, takeoff, index, schedule] = await Promise.all([loadPropertyMap(), fetchJson('samples/takeoff-rules.json'),
                loadState(await stateFor('takeoff-snapshot')).catch(() => ({})), loadState(await stateFor('takeoff')).catch(() => ({})),
                loadState(await stateFor(INDEX_STATE)).catch(() => ({})), loadState(await stateFor('schedule')).catch(() => ({}))]);
            const { walls } = await getWallData(model, map);
            this.walls = walls;
            this.byExt = new Map(walls.map(w => [w.externalId, w]));
            this.rules = rules;
            this.overrides = takeoff.overrides || {};
            this.snapshot = new Map((snapshot.walls || []).map(w => [w.externalId, w]));
            this.index = index.panels || {};
            this.schedule = schedule?.activities?.length ? schedule : null;
            this.plan();
            this.render();
            this.showTruck(this.batches.flatMap(b => b.trucks).find(t => t.panels > 1)?.no ?? 1);
        } catch (err) {
            console.error(err);
            this.panel.querySelector('[data-status]').textContent = `Could not start the shipper: ${err.message || err}`;
        }
    }

    // --- The panels and the plan -----------------------------------------------------------------------------------------

    // Panels from the walls (the takeoff's), or from the shop drawings. Each: { key, wallKey, dbId, mark, level, wallType,
    // lengthIn, heightIn, thickIn, weightLb, shop }.
    panels() {
        const out = [];
        if (this.source === 'shops') {
            for (const e of Object.values(this.index)) {
                if (!e.frame) continue;
                const wall = this.byExt.get(e.key);
                out.push({ key: e.key, wallKey: e.key, dbId: wall?.dbId, mark: e.mark, level: e.level || wall?.level || NOT_SET, wallType: e.wallType,
                    lengthIn: e.lengthIn, heightIn: e.heightIn, thickIn: e.frame.studIn || 3.625, weightLb: panelWeight(entryLayout(e)), shop: true });
            }
            return out;
        }
        const weights = new Map(); // one layout per size and assembly
        for (const w of this.walls) {
            const asm = assemblyFor(w.wallType ?? NOT_SET, this.rules, this.overrides);
            if (asm.scope !== 'framed') continue;
            const snap = this.snapshot.get(w.externalId);
            const lengthIn = Number(snap?.length ?? w.length) * 12, heightIn = Number(snap?.heightFt) * 12;
            if (!(lengthIn > 6) || !(heightIn > 6)) continue;
            const pieces = Math.ceil(lengthIn / MAX_PANEL_IN - 1e-9), pieceIn = lengthIn / pieces;
            const code = /^_?([A-Z0-9][A-Z0-9.]*)\s*-/i.exec(w.wallType || '')?.[1] || 'W';
            const wkey = `${Math.round(pieceIn)}|${Math.round(heightIn)}|${asm.label}`;
            if (!weights.has(wkey)) {
                let lb = 0;
                try { lb = panelWeight(frameWall({ lengthIn: pieceIn, heightIn, openings: [], studIn: asm.studIn, rows: asm.rows, spacingIn: asm.spacingIn || this.rules.settings.studSpacingIn, mils: this.rules.settings.mils, member: asm.member })); } catch { /* an odd size */ }
                weights.set(wkey, lb);
            }
            for (let i = 0; i < pieces; i++) {
                out.push({ key: pieces > 1 ? `${w.externalId}#${i + 1}` : w.externalId, wallKey: w.externalId, dbId: w.dbId,
                    mark: `${code}-${w.dbId}${pieces > 1 ? `/${i + 1}` : ''}`, level: w.level || NOT_SET, wallType: w.wallType || NOT_SET,
                    lengthIn: pieceIn, heightIn, thickIn: asm.studIn || 3.625, weightLb: weights.get(wkey), shop: !!this.index[w.externalId] });
            }
        }
        return out;
    }

    // Batches and trucks; each panel colored by its batch; the date each floor's framing starts (the schedule's
    // framing activities linked to it, Demo 3).
    plan() {
        const levelOrder = this.views.levels.map(l => l.name);
        const needBy = {};
        if (this.schedule) {
            for (const a of linkActivities(this.schedule, levelOrder)) {
                if (a.scope === 'other' || a.stage !== 'Framed' || !a.level || !a.start) continue;
                if (!needBy[a.level] || a.start < needBy[a.level]) needBy[a.level] = a.start;
            }
        }
        this.all = this.panels();
        this.batches = planBatches(this.all, { levelOrder, needBy });
        this.batches.forEach((b, i) => { b.color = BATCH_COLORS[i % BATCH_COLORS.length]; for (const t of b.trucks) { t.batch = b; for (const s of t.stacks) for (const p of s.panels) p.color = b.color; } });
        this.trucks = this.batches.flatMap(b => b.trucks);
    }

    // --- Panel (the side panel) ------------------------------------------------------------------------------------------

    render() {
        const b = this.batches, total = this.trucks.length, lb = b.reduce((n, x) => n + x.weightLb, 0);
        const types = [...new Set(this.all.map(p => p.wallType))].sort();
        const shown = b.filter(x => !this.filter.batch || x.id === this.filter.batch);
        this.panel.innerHTML = `<div class="demo-panel ps">
            <h2>Panel Shipper <span class="muted">concept</span></h2>
            <div class="ps-source" role="radiogroup">
                <label><input type="radio" name="ps-src" value="walls" ${this.source === 'walls' ? 'checked' : ''}> Every framed wall</label>
                <label><input type="radio" name="ps-src" value="shops" ${this.source === 'shops' ? 'checked' : ''}> Shop drawing panels (${Object.keys(this.index).length})</label>
            </div>
            <div class="ps-filters">
                <label>Batch <select data-f="batch"><option value="">All delivery batches</option>${b.map(x => `<option value="${x.id}" ${x.id === this.filter.batch ? 'selected' : ''}>${x.id} · ${escapeHtml(x.level)}</option>`).join('')}</select></label>
                <label>Wall type <select data-f="type"><option value="">All wall types</option>${types.map(t => `<option ${t === this.filter.type ? 'selected' : ''}>${escapeHtml(t)}</option>`).join('')}</select></label>
                <label>Find panel <input type="search" data-f="find" value="${escapeHtml(this.filter.find)}" placeholder="Mark, e.g. 21002-61338"></label>
            </div>
            <p class="muted">${this.all.length.toLocaleString()} panels · ${b.length} batches · ${total} trucks · ${Math.round(lb).toLocaleString()} lb of framing.
                ${TRAILER.name}, deck ${fmtFtIn(TRAILER.widthIn)} wide, stacks up to ${fmtFtIn(TRAILER.stackIn)}, ${TRAILER.maxLb.toLocaleString()} lb.</p>
            <div class="ps-batches">${shown.map(x => `<div class="ps-batch"><div class="ps-bhead"><span class="ps-sw" style="background:${x.color}"></span><b>${x.id} · ${escapeHtml(x.level)}</b>
                    <span class="muted">${x.panels} panels · ${x.trucks.length} truck${x.trucks.length === 1 ? '' : 's'}${x.needBy ? ` · framing from ${fmtDay(x.needBy)}` : ''}</span></div>
                    <div class="ps-trucks">${x.trucks.map(t => `<button class="ps-truck ${t.no === this.truckNo ? 'active' : ''}" data-truck="${t.no}" title="${t.panels} panels, ${Math.round(t.weightLb).toLocaleString()} lb, ${Math.round(t.lengthIn / 12)} of 48 ft">
                        #${t.no}<small>${t.panels} · ${Math.round(t.lengthIn / 12)}'${t.wide ? ' · W' : ''}${t.over ? ' · L' : ''}</small></button>`).join('')}</div></div>`).join('')}</div>
            <div data-load></div>
        </div>`;
        const $ = (s) => this.panel.querySelector(s);
        this.panel.querySelectorAll('input[name="ps-src"]').forEach(r => r.onchange = () => { this.source = r.value; this.filter.batch = ''; this.plan(); this.render(); this.showTruck(this.trucks.find(t => t.panels > 1)?.no ?? 1); });
        $('[data-f="batch"]').onchange = (e) => { this.filter.batch = e.target.value; this.render(); const t = this.batches.find(x => x.id === this.filter.batch)?.trucks[0]; if (t) this.showTruck(t.no); };
        $('[data-f="type"]').onchange = (e) => { this.filter.type = e.target.value; this.showTruck(this.truckNo); };
        $('[data-f="find"]').onchange = (e) => this.find(e.target.value);
        this.panel.querySelectorAll('[data-truck]').forEach(x => x.onclick = () => this.showTruck(Number(x.dataset.truck)));
        this.renderLoad();
    }

    // The selected truck's panels: stack by stack, front to back, bottom to top.
    renderLoad() {
        const el = this.panel.querySelector('[data-load]'), t = this.truck;
        if (!el || !t) return;
        const urn = location.hash.slice(1);
        el.innerHTML = `<h3>Truck #${t.no} <span class="muted">${escapeHtml(t.batch.id)} · ${escapeHtml(t.batch.level)}</span></h3>
            <p class="muted">${t.panels} panels in ${t.stacks.length} stack${t.stacks.length === 1 ? '' : 's'} · ${Math.round(t.weightLb).toLocaleString()} lb · ${fmtFtIn(t.lengthIn)} of the 48' deck
                ${t.wide ? ' · <b class="warn">wide load</b> (panels over 8\'-6" across)' : ''}${t.over ? ' · <b class="warn">longer than the deck</b>' : ''}</p>
            <table class="ps-list"><thead><tr><th>Stack</th><th>Mark</th><th class="num">Length</th><th class="num">Height</th><th class="num">lb</th><th></th></tr></thead><tbody>
            ${t.stacks.flatMap((s, i) => s.panels.map((p, j) => `<tr class="${p.key === this.picked ? 'hi' : ''}" data-pick="${escapeHtml(p.key)}">
                <td>${i + 1}.${j + 1}</td><td><b>${escapeHtml(p.mark)}</b></td><td class="num">${fmtFtIn(p.lengthIn)}</td><td class="num">${fmtFtIn(p.heightIn)}</td><td class="num">${Math.round(p.weightLb)}</td>
                <td>${p.shop ? `<a href="panel.html?p=${encodeURIComponent(p.wallKey)}" target="_blank" rel="noopener" title="Its shop drawing">Shop ↗</a>` : `<a href="index.html?demo=06-shop-drawings&layout=split&panel=${encodeURIComponent(p.wallKey)}${urn ? `#${urn}` : ''}" target="_blank" rel="noopener" title="Draw its shop drawing (Demo 6)">Draw ↗</a>`}</td></tr>`)).join('')}
            </tbody></table>
            <div class="row"><button data-csv>Load list CSV</button></div>`;
        el.querySelectorAll('[data-pick]').forEach(r => r.onclick = (e) => { if (!e.target.closest('a')) this.pick(r.dataset.pick); });
        el.querySelector('[data-csv]').onclick = () => this.exportLoad();
    }

    exportLoad() {
        const t = this.truck;
        downloadCsv(`truck-${t.no}-${t.batch.level}.csv`, [[`Truck ${t.no}`, t.batch.id, t.batch.level, `${t.panels} panels`, `${Math.round(t.weightLb)} lb`], [],
            ['Stack', 'Mark', 'Level', 'Wall type', 'Length', 'Height', 'Depth (in)', 'Weight (lb)'],
            ...t.stacks.flatMap((s, i) => s.panels.map((p, j) => [`${i + 1}.${j + 1}`, p.mark, p.level, p.wallType, fmtFtIn(p.lengthIn), fmtFtIn(p.heightIn), p.thickIn, Math.round(p.weightLb)]))]);
    }

    // --- The truck (over the 3D pane), the floor plan beside it ------------------------------------------------------

    get truck() {
        return this.trucks.find(t => t.no === this.truckNo) || null;
    }

    step(d) {
        if (!this.trucks.length) return;
        const i = this.trucks.findIndex(t => t.no === this.truckNo);
        this.showTruck(this.trucks[(i + d + this.trucks.length) % this.trucks.length].no);
    }

    async showTruck(no) {
        this.truckNo = no;
        const t = this.truck;
        if (!t) return;
        if (!this.picked || !t.stacks.some(s => s.panels.some(p => p.key === this.picked))) this.picked = null;
        this.panel.querySelectorAll('[data-truck]').forEach(x => x.classList.toggle('active', Number(x.dataset.truck) === no));
        this.renderLoad();
        this.setTruckShown(this.truckShown ?? true);
        // The plan: the truck's floor, its batch's panels in the batch color, this truck's in orange, named.
        const mine = new Set(t.stacks.flatMap(s => s.panels.map(p => p.dbId)).filter(Boolean));
        const colors = new Map();
        for (const tr of t.batch.trucks) for (const s of tr.stacks) for (const p of s.panels) if (p.dbId) colors.set(p.dbId, t.batch.color);
        for (const id of mine) colors.set(id, '#ff6a00');
        this.views.setColors(colors);
        const marks = new Map(t.stacks.flatMap(s => s.panels.map(p => [p.dbId, p.mark.replace(/\/\d+$/, '')])));
        this.views.setPlanLabels((id) => (marks.has(id) ? { text: marks.get(id), color: '#ff6a00' } : null));
        if (!this.truckShown) this.views.isolate([...mine]);
        await this.views.showPlanFor([...mine]);
        this.bar?.refresh();
    }

    // The truck over the 3D pane, or the 3D model with the truck's panels.
    setTruckShown(on) {
        this.truckShown = on;
        const pane = document.getElementById('preview');
        if (!on) {
            this.overlay?.remove();
            this.overlay = null;
            const t = this.truck;
            if (t) this.views.isolate(t.stacks.flatMap(s => s.panels.map(p => p.dbId)).filter(Boolean));
            this.bar?.refresh();
            return;
        }
        if (!this.overlay) {
            this.overlay = document.createElement('div');
            this.overlay.className = 'ps-overlay';
            pane.appendChild(this.overlay);
            this.overlay.addEventListener('click', (e) => {
                const k = e.target.closest('[data-key]')?.dataset.key;
                if (k) this.pick(k);
                const act = e.target.closest('[data-act]')?.dataset.act;
                if (act === 'prev') this.step(-1);
                if (act === 'next') this.step(1);
                if (act === 'model') this.setTruckShown(false);
                if (act === 'only') this.views.setLayout(this.views.layout === '3d' ? 'split' : '3d');
            });
        }
        this.drawTruck();
        this.bar?.refresh();
    }

    drawTruck() {
        const t = this.truck;
        if (!this.overlay || !t) return;
        const faded = this.filter.type ? new Set(t.stacks.flatMap(s => s.panels).filter(p => p.wallType !== this.filter.type).map(p => p.key)) : null;
        const p = this.picked && t.stacks.flatMap(s => s.panels).find(x => x.key === this.picked);
        this.overlay.innerHTML = `<div class="ps-obar"><button data-act="prev" title="Previous truck">◀</button>
                <b>Truck #${t.no} of ${this.trucks.length}</b><span class="ps-sw" style="background:${t.batch.color}"></span><span>${escapeHtml(t.batch.id)} · ${escapeHtml(t.batch.level)}</span>
                <span class="muted">${t.panels} panels · ${Math.round(t.weightLb).toLocaleString()} lb · ${Math.round(t.lengthIn / 12)} of 48 ft${t.batch.needBy ? ` · framing from ${fmtDay(t.batch.needBy)}` : ''}</span>
                ${t.wide ? '<span class="ps-tag">WIDE LOAD</span>' : ''}${t.over ? '<span class="ps-tag">OVER LENGTH</span>' : ''}
                <button data-act="next" title="Next truck">▶</button>
                <span class="ps-oacts"><button data-act="only" title="The truck across the whole width, or beside the floor plan">${this.views.layout === '3d' ? 'Truck + plan' : 'Truck only'}</button>
                <button data-act="model" title="The 3D model with this truck's panels">3D model</button></span></div>
            <div class="ps-stage"><div class="ps-svg">${truckSvg(t, { highlight: this.picked, faded })}</div>
            ${p ? `<div class="ps-card"><b>${escapeHtml(p.mark)}</b> · ${escapeHtml(p.level)} · ${fmtFtIn(p.lengthIn)} × ${fmtFtIn(p.heightIn)} · ${Math.round(p.weightLb)} lb<br><span class="muted">${escapeHtml(p.wallType)}</span></div>` : ''}</div>
            <div class="ps-legend">${this.batches.map(b => `<span><i style="background:${b.color}"></i>${escapeHtml(b.id)} ${escapeHtml(b.level)}</span>`).join('')}</div>`;
    }

    // A panel picked (truck, list or search): highlighted on the truck and in its row, its wall selected on the plan.
    pick(key) {
        this.picked = this.picked === key ? null : key;
        const p = this.picked && this.all.find(x => x.key === this.picked);
        this.drawTruck();
        this.panel.querySelectorAll('[data-pick]').forEach(r => r.classList.toggle('hi', r.dataset.pick === this.picked));
        if (p?.dbId) this.views.select([p.dbId]);
    }

    find(text) {
        this.filter.find = text.trim();
        const q = this.filter.find.toLowerCase();
        if (!q) return;
        const t = this.trucks.find(tr => tr.stacks.some(s => s.panels.some(p => p.mark.toLowerCase().includes(q))));
        if (!t) { this.panel.querySelector('[data-f="find"]').setCustomValidity('No panel with that mark'); this.panel.querySelector('[data-f="find"]').reportValidity(); return; }
        this.panel.querySelector('[data-f="find"]').setCustomValidity('');
        const p = t.stacks.flatMap(s => s.panels).find(x => x.mark.toLowerCase().includes(q));
        this.showTruck(t.no).then(() => { this.picked = null; this.pick(p.key); });
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, PanelShipperExtension);
