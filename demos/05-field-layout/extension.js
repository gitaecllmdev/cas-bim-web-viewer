// Demo 05: Field Layout Tablet Viewer
// Spec and acceptance criteria: demos/05-field-layout/README.md
// Big-button front end for core/client/views.js: level = 3D section box + that level's plan in the 2D pane.
// Section extension (setSectionBox): https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/SectionExtension/
// Measure extension (activate, deactivate, units/precision): https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/MeasureExtension/
// Viewer3D (setDisplayUnits, setDisplayUnitsPrecision, loadDocumentNode): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Document / BubbleNode (2D viewables, levelName): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Document/
import { onModelReady, escapeHtml } from '../../helpers.js';

const EXTENSION_ID = 'Drywall.FieldLayout';
const UNITS = 'fractional-in';
const PRECISION = 4; // 1/16"
const LAYOUTS = { '3d': '3D', split: '3D + plan', '2d': 'Plan' };

class FieldLayoutExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.panel = this.options.panel;
        this.measuring = null; // '3d' | '2d' | null
        this.panel.innerHTML = `<div class="demo-panel touch"><h2>Field Layout</h2><p class="muted">Waiting for a model…</p></div>`;
        const rerender = () => { if (this.ready) this.render(); };
        this.stops = [
            onModelReady(this.viewer, () => this.units()),
            this.views.on('ready', () => { this.ready = true; this.render(); }),
            this.views.on('level', rerender),
            this.views.on('sheet', () => { this.units(); if (this.measuring === '2d') this.measuring = null; rerender(); }),
        ];
        return true;
    }

    unload() {
        this.stops.forEach(stop => stop());
        for (const [viewer] of this.views.active) viewer.getExtension('Autodesk.Measure')?.deactivate();
        this.panel.innerHTML = '';
        return true;
    }

    // Fractional inches at 1/16" in both viewers (the Measure tool reads these display units).
    units() {
        for (const [viewer] of this.views.active) {
            viewer.setDisplayUnits(UNITS);
            viewer.setDisplayUnitsPrecision(PRECISION);
        }
    }

    render() {
        const { views } = this;
        const level = views.level?.name;
        const current = views.model2d?.getDocumentNode();
        const levelSheets = views.sheets.filter(s => level && s.levelName === level);
        this.panel.innerHTML = `<div class="demo-panel touch"><h2>Field Layout</h2>
            <p class="muted">${level ? `<b>${escapeHtml(level)}</b>` : 'Whole building'} · ${current ? `plan: ${escapeHtml(current.name())}` : 'no plan open'} · units 1/16"</p>
            <h3>View</h3>
            <div class="row">${Object.entries(LAYOUTS).map(([k, label]) => `<button data-layout-btn="${k}" class="${views.layout === k ? 'active' : ''}">${label}</button>`).join('')}</div>
            <h3>Level <span class="muted">(cuts the 3D model and opens that floor's plan)</span></h3>
            <div class="row">${views.levels.map(l => `<button data-level="${escapeHtml(l.name)}" class="${l.name === level ? 'active' : ''}">${escapeHtml(l.name)}</button>`).join('')
                || '<span class="warn">No levels found in this model.</span>'}</div>
            <div class="row"><button data-level="">Whole building</button></div>
            <h3>Measure</h3>
            <div class="row"><button data-measure="3d" class="${this.measuring === '3d' ? 'active' : ''}">📏 In 3D</button>
                <button data-measure="2d" class="${this.measuring === '2d' ? 'active' : ''}" ${views.model2d ? '' : 'disabled'}>📏 On the plan</button></div>
            <h3>Plans &amp; sheets ${level ? `for ${escapeHtml(level)}` : ''}</h3>
            <div class="row">${levelSheets.map(s => `<button data-sheet="${views.sheets.indexOf(s)}" class="${s.node === current ? 'active' : ''}">${escapeHtml(s.node.name())}</button>`).join('')
                || `<span class="muted">${level ? 'No 2D views for this level.' : 'Pick a level, or choose any view below.'}</span>`}</div>
            <div class="row"><select data-all-sheets style="flex:1">${views.sheets.map((s, i) => `<option value="${i}" ${s.node === current ? 'selected' : ''}>${escapeHtml(s.node.name())}</option>`).join('')}</select>
                <button data-open>Open</button></div>
            <p class="note">Selecting a wall on the plan selects it in 3D too. Use the ◎ / ⊘ / ◉ toolbar buttons to isolate, hide or show all in both views.</p></div>`;
        const $$ = (s) => this.panel.querySelectorAll(s);
        $$('[data-layout-btn]').forEach(b => b.onclick = () => { views.setLayout(b.dataset.layoutBtn); this.render(); });
        $$('[data-level]').forEach(b => b.onclick = () => views.setLevel(b.dataset.level || null));
        $$('[data-measure]').forEach(b => b.onclick = () => this.toggleMeasure(b.dataset.measure));
        $$('[data-sheet]').forEach(b => b.onclick = () => views.openSheet(views.sheets[Number(b.dataset.sheet)].node));
        this.panel.querySelector('[data-open]').onclick = () => views.openSheet(views.sheets[Number(this.panel.querySelector('[data-all-sheets]').value)]?.node);
    }

    async toggleMeasure(where) {
        const target = where === '3d' ? this.views.viewer3d : this.views.viewer2d;
        for (const [viewer] of this.views.active) viewer.getExtension('Autodesk.Measure')?.deactivate();
        if (this.measuring === where || !target?.model) {
            this.measuring = null;
        } else {
            this.units();
            const measure = target.getExtension('Autodesk.Measure') || await target.loadExtension('Autodesk.Measure');
            measure.activate('distance');
            this.measuring = where;
        }
        this.render();
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, FieldLayoutExtension);
