// Demo 08: Panel Shipper (a concept). Pick a floor: its framed panels are packed on trucks as tightly as they go
// (shipping.mjs), each truck showing what it carries against what its trailer can (deck length, weight, stack height),
// and the order to load it (front row first, bottom to top; unloading is the reverse). The plan is yours to change:
// drag panels between trucks, to "Not loaded", to "New truck" or onto the truck view; a truck repacks itself and says
// when something no longer fits; "Fill" packs a truck from the panels not loaded; each truck its own trailer. Saved per
// floor ('shipper' state). The truck in 3D over the 3D pane (truck.mjs), the floor plan beside it with each truck's
// walls in its color and the selected truck's load numbers on its walls.
// Panels: every framed wall of the takeoff (split into panels of 40 ft or less, weights and studs from a framing layout
// of each), or only the panels drawn in Demo 6 (their own layouts; their shop drawings a click away).
// Shared views (colors, isolate, select, plan labels, levels): core/client/views.js.
import { loadState, saveState, fetchJson, escapeHtml, downloadCsv, stateFor, onModelReady, loadPropertyMap, getWallData } from '../../helpers.js';
import { DemoToolbar } from '../../toolbar.js';
import { assemblyFor } from '../02-takeoff/calc.mjs';
import { frameWall, fmtFtIn } from '../common/framing.mjs';
import { INDEX_STATE, entryLayout } from '../06-shop-drawings/panels.mjs';
import { linkActivities, fmtDay } from '../03-progress/p6.mjs';
import { TRAILERS, panelWeight, studCount, packTruck, autoPack, fill, place, loadSequence, capacity, shippable } from './shipping.mjs';
import { truckSvg } from './truck.mjs';

const EXTENSION_ID = 'Drywall.PanelShipper';
const MAX_PANEL_IN = 40 * 12; // a longer wall is split into equal panels no longer than this
const TRUCK_COLORS = ['#e8a33d', '#5b8fd6', '#6bb26b', '#c96bc9', '#d9534f', '#3fb8af', '#a0784b', '#7f7fd5', '#e377c2', '#8c8c3e', '#17becf', '#bc8f8f'];
const NOT_LOADED = '#9aa0a6';
const NOT_SET = 'Not set';
const color = (i) => TRUCK_COLORS[i % TRUCK_COLORS.length];

class PanelShipperExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.panel.classList.add('wide');
        this.source = 'walls'; // 'walls': every framed wall; 'shops': the panels drawn in Demo 6
        this.trailerKey = 'flat48'; // for new trucks
        this.sel = 0; // the selected truck
        this.picked = null; // a panel key
        this.truckShown = true;
        this.panel.innerHTML = '<div class="demo-panel ps"><h2>Panel Shipper</h2><p class="muted" data-status>Waiting for a model…</p></div>';
        this.bindPanel();
        this.stops = [
            onModelReady(this.viewer, (model) => this.init(model)),
            // The floors and their order arrive after the walls: the floor list in build order, after the views open
            // their own first plan (right after 'ready'), so the floor's plan is the one shown.
            this.views.on('ready', () => setTimeout(async () => {
                if (!this.walls) return;
                await this.views.sheetQueue;
                this.loadLevel(this.levelChosen ? this.level : null); // the first floor in build order, unless one was picked
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
            { key: 'prev', icon: 'dw-icon-prev', tip: 'Previous truck', run: () => this.select(this.sel - 1) },
            { key: 'next', icon: 'dw-icon-next', tip: 'Next truck', run: () => this.select(this.sel + 1) },
            { key: 'truck', icon: 'dw-icon-truck', tip: 'The truck, or the 3D model with its panels', run: () => this.setTruckShown(!this.truckShown), on: () => this.truckShown },
        ]);
    }

    async init(model) {
        try {
            this.names = { shipper: await stateFor('shipper') };
            const [map, rules, snapshot, takeoff, index, schedule, saved] = await Promise.all([loadPropertyMap(), fetchJson('samples/takeoff-rules.json'),
                loadState(await stateFor('takeoff-snapshot')).catch(() => ({})), loadState(await stateFor('takeoff')).catch(() => ({})),
                loadState(await stateFor(INDEX_STATE)).catch(() => ({})), loadState(await stateFor('schedule')).catch(() => ({})),
                loadState(this.names.shipper).catch(() => ({}))]);
            const { walls } = await getWallData(model, map);
            this.walls = walls;
            this.byExt = new Map(walls.map(w => [w.externalId, w]));
            this.rules = rules;
            this.overrides = takeoff.overrides || {};
            this.snapshot = new Map((snapshot.walls || []).map(w => [w.externalId, w]));
            this.index = index.panels || {};
            this.schedule = schedule?.activities?.length ? schedule : null;
            this.saved = { plans: {}, ...saved };
            this.loadLevel(null);
        } catch (err) {
            console.error(err);
            this.panel.querySelector('[data-status]').textContent = `Could not start the shipper: ${err.message || err}`;
        }
    }

    // --- Panels ----------------------------------------------------------------------------------------------------------

    // Every panel of the source: { key, wallKey, dbId, mark, level, wallType, lengthIn, heightIn, thickIn, weightLb, studs, shop }.
    buildPanels() {
        const out = [];
        if (this.source === 'shops') {
            for (const e of Object.values(this.index)) {
                if (!e.frame) continue;
                const wall = this.byExt.get(e.key), lay = entryLayout(e);
                out.push({ key: e.key, wallKey: e.key, dbId: wall?.dbId, mark: e.mark, level: e.level || wall?.level || NOT_SET, wallType: e.wallType,
                    lengthIn: e.lengthIn, heightIn: e.heightIn, thickIn: e.frame.studIn || 3.625, weightLb: panelWeight(lay), studs: studCount(lay), shop: true });
            }
        } else {
            const sizes = new Map(); // one layout per size and assembly: { lb, studs }
            for (const w of this.walls) {
                const asm = assemblyFor(w.wallType ?? NOT_SET, this.rules, this.overrides);
                if (asm.scope !== 'framed') continue;
                const snap = this.snapshot.get(w.externalId);
                const lengthIn = Number(snap?.length ?? w.length) * 12, heightIn = Number(snap?.heightFt) * 12;
                if (!(lengthIn > 6) || !(heightIn > 6)) continue;
                const pieces = Math.ceil(lengthIn / MAX_PANEL_IN - 1e-9), pieceIn = lengthIn / pieces;
                const code = /^_?([A-Z0-9][A-Z0-9.]*)\s*-/i.exec(w.wallType || '')?.[1] || 'W';
                const sizeKey = `${Math.round(pieceIn)}|${Math.round(heightIn)}|${asm.label}`;
                if (!sizes.has(sizeKey)) {
                    let lay = null;
                    try { lay = frameWall({ lengthIn: pieceIn, heightIn, openings: [], studIn: asm.studIn, rows: asm.rows, spacingIn: asm.spacingIn || this.rules.settings.studSpacingIn, mils: this.rules.settings.mils, member: asm.member }); } catch { /* an odd size */ }
                    sizes.set(sizeKey, { lb: panelWeight(lay), studs: studCount(lay) });
                }
                const { lb, studs } = sizes.get(sizeKey);
                for (let i = 0; i < pieces; i++) {
                    out.push({ key: pieces > 1 ? `${w.externalId}#${i + 1}` : w.externalId, wallKey: w.externalId, dbId: w.dbId,
                        mark: `${code}-${w.dbId}${pieces > 1 ? `/${i + 1}` : ''}`, level: w.level || NOT_SET, wallType: w.wallType || NOT_SET,
                        lengthIn: pieceIn, heightIn, thickIn: asm.studIn || 3.625, weightLb: lb, studs, shop: !!this.index[w.externalId] });
                }
            }
        }
        this.all = new Map(out.map(p => [p.key, p]));
        // The floors with panels, in build order (the model's levels bottom to top), and the date each one's framing
        // starts (the schedule's framing activities linked to it, Demo 3).
        const order = this.views.levels.map(l => l.name), have = new Set(out.map(p => p.level));
        this.levels = [...order.filter(l => have.has(l)), ...[...have].filter(l => !order.includes(l)).sort()];
        this.needBy = {};
        if (this.schedule) {
            for (const a of linkActivities(this.schedule, order)) {
                if (a.scope === 'other' || a.stage !== 'Framed' || !a.level || !a.start) continue;
                if (!this.needBy[a.level] || a.start < this.needBy[a.level]) this.needBy[a.level] = a.start;
            }
        }
    }

    // The floor to open on: among those with panels that can ship, the first in build order whose framing is scheduled,
    // else the one with the most panels.
    firstLevel() {
        const count = new Map();
        for (const p of this.all.values()) if (shippable(p, TRAILERS.flat53)) count.set(p.level, (count.get(p.level) || 0) + 1);
        const can = this.levels.filter(l => count.get(l));
        return can.find(l => this.needBy[l]) || [...can].sort((a, b) => count.get(b) - count.get(a))[0] || this.levels[0];
    }

    get planKey() {
        return `${this.source}|${this.level}`;
    }

    // A floor's trucks: as saved (when its panels are still the floor's), else packed afresh. level null: the first floor
    // in build order with framing scheduled (chosen once the floors and the schedule are known).
    loadLevel(level) {
        this.buildPanels();
        this.level = level && this.levels.includes(level) ? level : this.firstLevel();
        const keys = new Set([...this.all.values()].filter(p => p.level === this.level).map(p => p.key));
        const saved = this.saved.plans[this.planKey];
        const savedKeys = saved && [...saved.trucks.flatMap(t => t.keys), ...saved.pool];
        if (saved && savedKeys.length === keys.size && savedKeys.every(k => keys.has(k))) {
            this.trucks = saved.trucks.map(t => ({ trailer: TRAILERS[t.trailer] ? t.trailer : 'flat48', keys: [...t.keys] }));
            this.pool = [...saved.pool];
        } else {
            this.autoPlan(false);
        }
        this.sel = 0;
        this.picked = null;
        this.repackAll();
        this.render();
        this.show();
    }

    autoPlan(save = true) {
        const panels = [...this.all.values()].filter(p => p.level === this.level);
        const { trucks, unshippable } = autoPack(panels, TRAILERS[this.trailerKey]);
        this.trucks = trucks.map(t => ({ trailer: this.trailerKey, keys: [...t.placed] })); // in the order they went on: packed again the same
        this.pool = unshippable.map(p => p.key);
        if (save) { this.repackAll(); this.save(); this.sel = 0; this.render(); this.show(); }
    }

    // A truck's load from its panels in the order they went on (the same load each time). tidy: biggest first again.
    repack(t, tidy = false) {
        t.packed = packTruck(t.keys.map(k => this.all.get(k)).filter(Boolean), TRAILERS[t.trailer], { keepOrder: !tidy });
        if (tidy) t.keys = [...t.packed.placed, ...t.packed.overflow.map(p => p.key)];
    }

    repackAll() {
        for (const t of this.trucks) this.repack(t);
    }

    save() {
        this.saved.plans[this.planKey] = { trucks: this.trucks.map(t => ({ trailer: t.trailer, keys: t.keys })), pool: this.pool };
        saveState(this.names.shipper, this.saved).catch(err => console.warn('Shipping plan not saved:', err.message));
    }

    // --- Changes: drag and drop, fill, trailer, remove ------------------------------------------------------------------

    // A panel to a truck (its index), to 'pool' (not loaded) or to 'new' (a new truck).
    move(key, target) {
        if (!this.all.has(key)) return;
        const from = this.trucks.find(t => t.keys.includes(key));
        if (target === 'new') { this.trucks.push({ trailer: this.trailerKey, keys: [] }); target = this.trucks.length - 1; }
        const to = target === 'pool' ? null : this.trucks[Number(target)];
        if (from === to && to) return;
        if (from) { from.keys = from.keys.filter(k => k !== key); this.repack(from); } else this.pool = this.pool.filter(k => k !== key);
        // Onto a truck: added to its load as it is (where it fits, else flagged: it does not fit), nothing else moves.
        if (to) {
            const p = this.all.get(key);
            if (!place(to.packed, p)) to.packed.overflow.push(p);
            to.keys.push(key);
            this.sel = this.trucks.indexOf(to);
        } else this.pool.push(key);
        this.picked = key;
        this.save();
        this.render();
        this.show();
    }

    // As many of the panels not loaded as fit, onto a truck.
    fillTruck(i) {
        const t = this.trucks[i];
        const placed = fill(t.packed, this.pool.map(k => this.all.get(k)).filter(Boolean));
        if (!placed.length) { this.note(`Nothing more fits on truck ${i + 1}.`); return; }
        const keys = new Set(placed.map(p => p.key));
        t.keys.push(...keys);
        this.pool = this.pool.filter(k => !keys.has(k));
        this.repack(t);
        this.sel = i;
        this.save();
        this.render();
        this.show();
        this.note(`${placed.length} panel${placed.length === 1 ? '' : 's'} added to truck ${i + 1}.`);
    }

    // Biggest panels first again; kept only when that fits as many (a load packed with the others can fit more).
    tidyTruck(i) {
        const t = this.trucks[i], was = t.packed, keys = t.keys;
        this.repack(t, true);
        if (t.packed.overflow.length > was.overflow.length) {
            t.packed = was;
            t.keys = keys;
            this.note(`Truck ${i + 1} already fits more as it is; kept.`);
            return;
        }
        this.sel = i;
        this.save();
        this.render();
        this.show();
    }

    setTrailer(i, key) {
        this.trucks[i].trailer = key;
        this.repack(this.trucks[i]);
        this.save();
        this.render();
        this.show();
    }

    removeTruck(i) {
        this.pool.push(...this.trucks[i].keys);
        this.trucks.splice(i, 1);
        this.sel = Math.max(0, Math.min(this.sel, this.trucks.length - 1));
        this.save();
        this.render();
        this.show();
    }

    select(i) {
        if (!this.trucks.length) return;
        this.sel = (i + this.trucks.length) % this.trucks.length;
        this.render();
        this.show();
    }

    note(text) {
        const el = this.panel.querySelector('[data-note]');
        if (el) el.textContent = text;
    }

    // --- The side panel ---------------------------------------------------------------------------------------------------

    bindPanel() {
        const p = this.panel;
        p.addEventListener('dragstart', (e) => {
            const chip = e.target.closest?.('[data-key]');
            if (!chip) return;
            e.dataTransfer.setData('text/plain', chip.dataset.key);
            e.dataTransfer.effectAllowed = 'move';
            this.dragging = chip.dataset.key;
        });
        p.addEventListener('dragover', (e) => {
            const zone = e.target.closest?.('[data-drop]');
            if (!zone) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            p.querySelectorAll('.drop-over').forEach(z => z !== zone && z.classList.remove('drop-over'));
            zone.classList.add('drop-over');
        });
        p.addEventListener('dragleave', (e) => e.target.closest?.('[data-drop]')?.classList.remove('drop-over'));
        p.addEventListener('drop', (e) => {
            const zone = e.target.closest?.('[data-drop]');
            if (!zone) return;
            e.preventDefault();
            this.move(e.dataTransfer.getData('text/plain') || this.dragging, zone.dataset.drop);
        });
        p.addEventListener('click', (e) => {
            const t = e.target.closest?.('[data-act]');
            if (!t) { const chip = e.target.closest?.('[data-key]'); if (chip) this.pick(chip.dataset.key); return; }
            const v = t.dataset.v;
            ({ select: () => this.select(Number(v)), fill: () => this.fillTruck(Number(v)), remove: () => this.removeTruck(Number(v)),
                unload: () => this.move(v, 'pool'), auto: () => this.autoPlan(), csv: () => this.exportLoad(), tidy: () => this.tidyTruck(Number(v)) })[t.dataset.act]?.();
        });
        p.addEventListener('change', (e) => {
            const t = e.target;
            if (t.name === 'ps-src') { this.source = t.value; this.buildPanels(); this.loadLevel(this.level); }
            else if (t.dataset.level !== undefined) { this.levelChosen = true; this.loadLevel(t.value); }
            else if (t.dataset.newTrailer !== undefined) this.trailerKey = t.value;
            else if (t.dataset.trailer !== undefined) this.setTrailer(Number(t.dataset.trailer), t.value);
            else if (t.dataset.find !== undefined) this.find(t.value);
        });
    }

    render() {
        const lv = [...this.all.values()].filter(p => p.level === this.level);
        const lb = lv.reduce((n, p) => n + p.weightLb, 0), studs = lv.reduce((n, p) => n + (p.studs || 0), 0);
        const trailerOptions = (sel) => Object.entries(TRAILERS).map(([k, t]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${escapeHtml(t.name)}</option>`).join('');
        const chip = (key) => {
            const p = this.all.get(key), t = this.trucks.find(x => x.keys.includes(key));
            const bad = t?.packed.overflow.some(o => o.key === key), n = t ? loadSequence(t.packed).find(s => s.panel.key === key)?.n : null;
            return `<span class="ps-chip ${bad ? 'bad' : ''} ${key === this.picked ? 'hi' : ''}" draggable="true" data-key="${escapeHtml(key)}"
                title="${escapeHtml(`${n ? `#${n} ` : ''}${p.mark} · ${fmtFtIn(p.lengthIn)} x ${fmtFtIn(p.heightIn)} · ${Math.round(p.weightLb)} lb · ${p.studs || 0} studs${bad ? ' · does not fit' : ''}`)}">${n ? `<b>${n}</b> ` : ''}${escapeHtml(p.mark)}${t ? `<i data-act="unload" data-v="${escapeHtml(key)}" title="Take it off: Not loaded">×</i>` : ''}</span>`;
        };
        const bar = (label, frac, text) => `<div class="ps-bar ${frac > 1.0001 ? 'over' : ''}" title="${escapeHtml(text)}"><span>${label}</span><i><b style="width:${Math.min(100, Math.round(frac * 100))}%"></b></i><em>${escapeHtml(text)}</em></div>`;
        const card = (t, i) => {
            const k = t.packed, c = capacity(k), tr = TRAILERS[t.trailer];
            return `<div class="ps-tcard ${i === this.sel ? 'sel' : ''} ${c.full ? 'over' : ''}" data-drop="${i}">
                <div class="ps-thead"><span class="ps-sw" style="background:${color(i)}"></span><button class="link" data-act="select" data-v="${i}"><b>Truck ${i + 1}</b></button>
                    <select data-trailer="${i}" title="What it is">${trailerOptions(t.trailer)}</select>
                    <button data-act="fill" data-v="${i}" title="Pack as many panels as still fit, from Not loaded">Fill</button>
                    <button data-act="tidy" data-v="${i}" title="Repack this truck biggest panels first (after many changes by hand)">Repack</button>
                    <button data-act="remove" data-v="${i}" title="Remove the truck: its panels go to Not loaded">✕</button></div>
                ${bar('Deck', c.deck, `${fmtFtIn(k.lengthIn)} of ${fmtFtIn(tr.lengthIn)}`)}
                ${bar('Weight', c.weight, `${Math.round(k.weightLb).toLocaleString()} of ${tr.maxLb.toLocaleString()} lb`)}
                ${bar('Stack', c.height, `${fmtFtIn(c.tallIn)} of ${fmtFtIn(tr.stackIn)}`)}
                <div class="ps-tmeta">${k.panels} panels · ${k.studs.toLocaleString()} studs${c.wide ? ' · <b class="warn">wide load</b>' : ''}${k.overflow.length ? ` · <b class="warn">${k.overflow.length} do not fit</b>` : ''}</div>
                ${i === this.sel ? `<div class="ps-chips">${t.keys.map(chip).join('')}</div>` : ''}
            </div>`;
        };
        this.panel.innerHTML = `<div class="demo-panel ps">
            <h2>Panel Shipper <span class="muted">concept</span></h2>
            <div class="ps-source">
                <label><input type="radio" name="ps-src" value="walls" ${this.source === 'walls' ? 'checked' : ''}> Every framed wall</label>
                <label><input type="radio" name="ps-src" value="shops" ${this.source === 'shops' ? 'checked' : ''}> Shop drawing panels (${Object.keys(this.index).length})</label>
            </div>
            <div class="ps-filters">
                <label>Level <select data-level>${this.levels.map(l => `<option ${l === this.level ? 'selected' : ''}>${escapeHtml(l)}</option>`).join('')}</select></label>
                <label>New trucks <select data-new-trailer>${trailerOptions(this.trailerKey)}</select></label>
                <label>Find panel <input type="search" data-find placeholder="Mark, e.g. 21002-61338"></label>
            </div>
            <p class="ps-sum"><b>${escapeHtml(this.level)}</b>: ${lv.length.toLocaleString()} panels · ${studs.toLocaleString()} studs · ${Math.round(lb).toLocaleString()} lb on
                <b>${this.trucks.length} truck${this.trucks.length === 1 ? '' : 's'}</b>${this.needBy[this.level] ? ` · framing from ${fmtDay(this.needBy[this.level])}` : ''}
                <button data-act="auto" title="Pack the floor afresh (your changes on this floor are replaced)">Auto-pack</button></p>
            <p class="muted">Drag a panel to another truck, to <b>New truck</b>, to <b>Not loaded</b> or onto the truck view; × takes it off. A truck repacks itself
                (biggest panels first, on stacks they fit on, side by side, then new rows) and says when something no longer fits. Numbers: the order to load (front row first,
                bottom to top); unload in reverse. <span data-note class="ps-note"></span></p>
            <div class="ps-trucklist">${this.trucks.map(card).join('')}
                <div class="ps-tnew" data-drop="new">+ New truck <span class="muted">(drop a panel here)</span></div></div>
            <div class="ps-pool" data-drop="pool"><div class="ps-thead"><b>Not loaded</b> <span class="muted">${this.pool.length} panel${this.pool.length === 1 ? '' : 's'}${this.pool.some(k => !shippable(this.all.get(k), TRAILERS.flat53)) ? ' · some too long or too wide for any trailer' : ''}</span></div>
                <div class="ps-chips">${this.pool.map(chip).join('') || '<span class="muted">Drop panels here to take them off the trucks.</span>'}</div></div>
            <div data-seq>${this.seqHtml()}</div>
        </div>`;
    }

    // The selected truck's loading sequence.
    seqHtml() {
        const t = this.trucks[this.sel];
        if (!t) return '';
        const seq = loadSequence(t.packed), urn = location.hash.slice(1);
        return `<h3>Truck ${this.sel + 1}: loading sequence <button data-act="csv">CSV</button></h3>
            <table class="ps-list"><thead><tr><th>#</th><th>Mark</th><th>Row · lane · level</th><th class="num">Length</th><th class="num">Height</th><th class="num">lb</th><th></th></tr></thead><tbody>
            ${seq.map(s => `<tr class="${s.panel.key === this.picked ? 'hi' : ''}" data-key="${escapeHtml(s.panel.key)}"><td><b>${s.n}</b></td><td>${escapeHtml(s.panel.mark)}</td><td>${s.row} · ${s.lane} · ${s.level}</td>
                <td class="num">${fmtFtIn(s.panel.lengthIn)}</td><td class="num">${fmtFtIn(s.panel.heightIn)}</td><td class="num">${Math.round(s.panel.weightLb)}</td>
                <td>${s.panel.shop ? `<a href="panel.html?p=${encodeURIComponent(s.panel.wallKey)}" target="_blank" rel="noopener">Shop ↗</a>` : `<a href="index.html?demo=06-shop-drawings&layout=split&panel=${encodeURIComponent(s.panel.wallKey)}${urn ? `#${urn}` : ''}" target="_blank" rel="noopener" title="Draw its shop drawing (Demo 6)">Draw ↗</a>`}</td></tr>`).join('')}
            </tbody></table>`;
    }

    exportLoad() {
        const t = this.trucks[this.sel];
        if (!t) return;
        downloadCsv(`truck-${this.sel + 1}-${this.level}.csv`, [[`Truck ${this.sel + 1}`, this.level, TRAILERS[t.trailer].name, `${t.packed.panels} panels`, `${t.packed.studs} studs`, `${Math.round(t.packed.weightLb)} lb`], [],
            ['Load #', 'Mark', 'Row', 'Lane', 'Level in stack', 'Wall type', 'Length', 'Height', 'Depth (in)', 'Studs', 'Weight (lb)'],
            ...loadSequence(t.packed).map(s => [s.n, s.panel.mark, s.row, s.lane, s.level, s.panel.wallType, fmtFtIn(s.panel.lengthIn), fmtFtIn(s.panel.heightIn), s.panel.thickIn, s.panel.studs || 0, Math.round(s.panel.weightLb)])]);
    }

    // --- The truck (over the 3D pane) and the floor plan ---------------------------------------------------------------

    async show() {
        this.drawTruck();
        // The plan: each truck's walls in its color, the panels not loaded grey, the selected truck's load numbers.
        const colors = new Map();
        this.trucks.forEach((t, i) => { for (const k of t.keys) { const p = this.all.get(k); if (p?.dbId) colors.set(p.dbId, color(i)); } });
        for (const k of this.pool) { const p = this.all.get(k); if (p?.dbId) colors.set(p.dbId, NOT_LOADED); }
        this.views.setColors(colors);
        const t = this.trucks[this.sel];
        const numbers = new Map(t ? loadSequence(t.packed).map(s => [s.panel.dbId, `#${s.n}`]) : []);
        this.views.setPlanLabels((id) => (numbers.has(id) ? { text: numbers.get(id), color: color(this.sel) } : null));
        const ids = [...this.all.values()].filter(p => p.level === this.level && p.dbId).map(p => p.dbId);
        if (!this.truckShown && t) this.views.isolate(t.keys.map(k => this.all.get(k)?.dbId).filter(Boolean));
        await this.views.showPlanFor(ids);
        this.bar?.refresh();
    }

    setTruckShown(on) {
        this.truckShown = on;
        if (!on) {
            this.overlay?.remove();
            this.overlay = null;
            const t = this.trucks[this.sel];
            if (t) this.views.isolate(t.keys.map(k => this.all.get(k)?.dbId).filter(Boolean));
        } else {
            this.views.showAll();
            this.drawTruck();
        }
        this.bar?.refresh();
    }

    drawTruck() {
        if (!this.truckShown) return;
        if (!this.overlay) {
            const o = this.overlay = document.createElement('div');
            o.className = 'ps-overlay';
            document.getElementById('preview').appendChild(o);
            o.addEventListener('click', (e) => {
                const k = e.target.closest('[data-key]')?.dataset.key;
                if (k) this.pick(k);
                const act = e.target.closest('[data-oact]')?.dataset.oact;
                if (act === 'prev') this.select(this.sel - 1);
                if (act === 'next') this.select(this.sel + 1);
                if (act === 'model') this.setTruckShown(false);
                if (act === 'only') { this.views.setLayout(this.views.layout === '3d' ? 'split' : '3d'); this.drawTruck(); }
            });
            // Drop a panel on the truck: onto the truck shown.
            o.addEventListener('dragover', (e) => { e.preventDefault(); o.classList.add('drop-over'); });
            o.addEventListener('dragleave', () => o.classList.remove('drop-over'));
            o.addEventListener('drop', (e) => { e.preventDefault(); o.classList.remove('drop-over'); this.move(e.dataTransfer.getData('text/plain') || this.dragging, this.sel); });
        }
        const t = this.trucks[this.sel];
        if (!t) { this.overlay.innerHTML = '<div class="ps-obar"><b>No trucks</b></div><div class="ps-stage"><p class="muted" style="margin:auto">Drop a panel on "New truck" or press Auto-pack.</p></div>'; return; }
        const k = t.packed, c = capacity(k), tr = TRAILERS[t.trailer], p = this.picked && this.all.get(this.picked);
        this.overlay.innerHTML = `<div class="ps-obar"><button data-oact="prev" title="Previous truck">◀</button>
                <span class="ps-sw" style="background:${color(this.sel)}"></span><b>Truck ${this.sel + 1} of ${this.trucks.length}</b><span>${escapeHtml(this.level)} · ${escapeHtml(tr.name)}</span>
                <span class="muted">${k.panels} panels · ${k.studs.toLocaleString()} studs · ${Math.round(k.weightLb).toLocaleString()} lb (${Math.round(c.weight * 100)}%) · deck ${Math.round(c.deck * 100)}% · stack ${fmtFtIn(c.tallIn)}</span>
                ${c.wide ? '<span class="ps-tag">WIDE LOAD</span>' : ''}${k.overflow.length ? `<span class="ps-tag bad">${k.overflow.length} DO NOT FIT</span>` : ''}
                <button data-oact="next" title="Next truck">▶</button>
                <span class="ps-oacts"><button data-oact="only" title="The truck across the whole width, or beside the floor plan">${this.views.layout === '3d' ? 'Truck + plan' : 'Truck only'}</button>
                <button data-oact="model" title="The 3D model with this truck's panels">3D model</button></span></div>
            <div class="ps-stage"><div class="ps-svg">${truckSvg(k, { color: color(this.sel), highlight: this.picked })}</div>
            ${p ? `<div class="ps-card"><b>${escapeHtml(p.mark)}</b> · ${fmtFtIn(p.lengthIn)} × ${fmtFtIn(p.heightIn)} · ${Math.round(p.weightLb)} lb · ${p.studs || 0} studs<br><span class="muted">${escapeHtml(p.wallType)}</span></div>` : ''}</div>
            <div class="ps-legend">${this.trucks.map((x, i) => `<span><i style="background:${color(i)}"></i>Truck ${i + 1}</span>`).join('')}<span><i style="background:${NOT_LOADED}"></i>Not loaded</span>
                <span class="muted">Drop a panel here to put it on this truck</span></div>`;
    }

    // A panel picked (truck, chip, sequence or search): highlighted everywhere, its wall selected on the plan.
    pick(key) {
        this.picked = this.picked === key ? null : key;
        const p = this.picked && this.all.get(this.picked);
        const i = p ? this.trucks.findIndex(t => t.keys.includes(p.key)) : -1;
        if (i >= 0 && i !== this.sel) { this.sel = i; this.render(); this.show(); } else {
            this.drawTruck();
            this.panel.querySelectorAll('[data-key]').forEach(el => el.classList.toggle('hi', el.dataset.key === this.picked));
        }
        if (p?.dbId) this.views.select([p.dbId]);
    }

    find(text) {
        const q = text.trim().toLowerCase();
        if (!q) return;
        const p = [...this.all.values()].find(x => x.mark.toLowerCase().includes(q));
        if (!p) { this.note(`No panel matches "${text}".`); return; }
        if (p.level !== this.level) { this.levelChosen = true; this.loadLevel(p.level); }
        this.picked = null;
        this.pick(p.key);
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, PanelShipperExtension);
