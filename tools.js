// Quick-access toolbar groups added to both the 3D and the 2D viewer:
// - "Drywall tools": isolate / hide / show all / zoom / whole building, through core/client/views.js so they apply to
//   both viewers at once.
// - "Options": fly-out menus (ComboButton) to try the viewer's settings: views, navigation, display, background and
//   lighting, what a click selects, units, plus a screenshot. On the 2D viewer: units and the screenshot.
// Each demo keeps only the tools it uses (demos.json "toolbar"): { builtin: the viewer's own tool buttons kept,
// tools: our quick buttons }. "all" (the APS Viewer demo) keeps everything and adds the Options menus. The viewer's
// other tool buttons go by unloading their extensions (Viewer3D.unloadExtension); Section and navigation always stay
// (the Level picker cuts the model with Section).
// Customizing the toolbar: https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/viewer_basics/toolbar-button/
// Button / ComboButton / ControlGroup: https://aps.autodesk.com/en/docs/viewer/v7/reference/UI/Button/,
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/UI/ComboButton/, https://aps.autodesk.com/en/docs/viewer/v7/reference/UI/ControlGroup/
// Viewer3D (getSelection, fitToView, setGhosting, setDisplayEdges, setQualityLevel, setGroundShadow, setGroundReflection,
//   setBackgroundColor, setLightPreset, setFOV, setReverseZoomDirection, setSelectionMode, setDisplayUnits,
//   getScreenShot): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// Navigation (getTarget, getPosition, setView): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Navigation/
// Model (getBoundingBox): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Model/
// ZoomWindow (adds "zoom window" to the toolbar's zoom button): https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/ZoomWindow/

import { toolbarButton, toolbarMenu } from './toolbar.js';

const EXTENSION_ID = 'Drywall.Tools';
// The viewer's own tool buttons a demo can do without (each from its extension; the reference lists them all:
// https://aps.autodesk.com/en/docs/viewer/v7/reference/Extensions/).
const REMOVABLE = ['Autodesk.BimWalk', 'Autodesk.Measure', 'Autodesk.DocumentBrowser', 'Autodesk.Explode', 'Autodesk.ModelStructure',
    'Autodesk.PropertiesManager', 'Autodesk.ViewerSettings', 'Autodesk.FullScreen'];
const ALL_TOOLS = ['isolate', 'hide', 'showall', 'fit', 'building', 'xray', 'top'];
const BACKGROUNDS = { light: [255, 255, 255, 230, 234, 238], sky: [190, 214, 240, 245, 248, 252], dark: [40, 44, 52, 20, 22, 26] };
const LIGHTS = 17; // light presets 0-16 (Simple Grey ... Snow Field: Viewer3D.setLightPreset)
const UNITS = [['ftin', 'ft-and-fractional-in', 'Feet and fractional inches'], ['ft', 'decimal-ft', 'Decimal feet'], ['in', 'fractional-in', 'Fractional inches'],
    ['m', 'm', 'Meters'], ['mm', 'mm', 'Millimeters'], ['file', '', 'As in the file']];

class DrywallToolsExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.ghosting = true; // viewer default: isolated views show the rest as ghosts
        // Our own record of the settings the menus toggle (the viewer's defaults for this page).
        this.state = { edges: true, ao: true, ground: false, reflect: false, reverse: false, bg: 'light', light: 0, fov: 45, select: 'leaf', units: 'file' };
        this.all = !this.options.toolbar || this.options.toolbar === 'all';
        if (this.all) this.viewer.loadExtension('Autodesk.Viewing.ZoomWindow').catch(() => {}); // a zoom-window choice on the zoom button
        if (this.viewer.toolbar) this.onToolbarCreated(this.viewer.toolbar);
        // The viewer adds its own tools as the toolbar and the model come in: take out the ones this demo doesn't use,
        // then and once the geometry is in (Viewer3D GEOMETRY_LOADED_EVENT).
        this.onGeometry = () => { this.trim(); setTimeout(() => this.trim(), 1500); };
        this.viewer.addEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this.onGeometry);
        return true;
    }

    trim() {
        if (this.all) return;
        const keep = new Set(this.options.toolbar.builtin || []);
        for (const id of REMOVABLE) if (!keep.has(id) && this.viewer.getExtension(id)) this.viewer.unloadExtension(id);
    }

    unload() {
        this.stopOrbit();
        this.viewer.removeEventListener(Autodesk.Viewing.GEOMETRY_LOADED_EVENT, this.onGeometry);
        for (const g of [this.group, this.optionsGroup]) if (g) this.viewer.toolbar.removeControl(g);
        this.group = this.optionsGroup = null;
        return true;
    }

    onToolbarCreated(toolbar) {
        if (this.group) return;
        const is3d = this.options.is3d, suffix = is3d ? '3d' : '2d';
        const selection = () => this.viewer.getSelection();
        const tools = [
            ['isolate', 'Isolate selection (3D + 2D)', () => { const ids = selection(); if (ids.length) this.views.isolate(ids); }],
            ['hide', 'Hide selection (3D + 2D)', () => { const ids = selection(); if (ids.length) this.views.hide(ids); }],
            ['showall', 'Show all (clears isolate and hide)', () => this.views.showAll()],
            ['fit', 'Zoom to the selection, or to what is shown (the level, the isolated walls, the building)', () => {
                if (selection().length) this.viewer.fitToView(selection(), this.viewer.model);
                else if (is3d) this.views.fitShown(); else this.views.frame2d();
            }],
            ['building', 'Whole building (clear the level section)', () => this.views.setLevel(null)],
        ];
        if (is3d) {
            tools.push(
                ['xray', 'X-ray: ghost or hide the rest when isolating', (button) => {
                    this.ghosting = !this.ghosting;
                    this.viewer.setGhosting(this.ghosting);
                    button.setState(this.ghosting ? Autodesk.Viewing.UI.Button.State.ACTIVE : Autodesk.Viewing.UI.Button.State.INACTIVE);
                }],
                ['top', 'Plan view (look down from the top)', () => this.look([0, 0, 1])],
            );
        }
        tools.push(
            ['zoompick', 'Zoom to a picked wall, in 3D and on its plan (click to turn off or on)', (button) => {
                this.views.setZoomPick(!this.views.zoomPick);
                button.setState(this.views.zoomPick ? Autodesk.Viewing.UI.Button.State.ACTIVE : Autodesk.Viewing.UI.Button.State.INACTIVE);
            }],
            ['shot', `Screenshot: save the ${is3d ? '3D view' : 'plan'} as a PNG`, () => this.screenshot(is3d ? '3d' : 'plan')],
        );
        const wanted = this.all ? ALL_TOOLS : this.options.toolbar.tools || [];
        const shown = wanted.map(key => tools.find(t => t[0] === key)).filter(Boolean);
        this.group = new Autodesk.Viewing.UI.ControlGroup(`dw-tools-${suffix}`);
        for (const [id, tip, action] of shown) {
            const button = toolbarButton(`dw-${id}-${suffix}`, `dw-icon-${id === 'zoompick' ? 'zoompick' : id}`, tip, action);
            if (id === 'xray' || (id === 'zoompick' && this.views.zoomPick)) button.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
            this.group.addControl(button);
        }
        if (shown.length) toolbar.addControl(this.group);
        this.trim();
        if (!this.all) return;

        this.optionsGroup = new Autodesk.Viewing.UI.ControlGroup(`dw-options-${suffix}`);
        for (const menu of is3d ? this.menus3d() : this.menus2d()) {
            this.optionsGroup.addControl(menu.items ? toolbarMenu(`${menu.id}-${suffix}`, menu).control : toolbarButton(`${menu.id}-${suffix}`, menu.icon, menu.tip, menu.run));
        }
        toolbar.addControl(this.optionsGroup);
    }

    menus3d() {
        const s = this.state, v = this.viewer;
        const face = (key, dir, tip) => ({ key, icon: `dw-icon-face-${key}`, tip, run: () => this.look(dir) });
        return [
            { id: 'dw-views', icon: 'dw-icon-views', tip: 'Views: look from a side or a corner', items: [
                face('top', [0, 0, 1], 'Top'), face('bottom', [0, 0, -1], 'Bottom (from below)'), face('front', [0, -1, 0.1], 'Front'),
                face('back', [0, 1, 0.1], 'Back'), face('left', [-1, 0, 0.1], 'Left'), face('right', [1, 0, 0.1], 'Right'),
                face('iso', [1, -1, 0.8], '3/4 view (front, right, from above)'), face('iso2', [-1, 1, 0.8], '3/4 view (back, left, from above)'),
            ] },
            { id: 'dw-nav', icon: 'dw-icon-nav', tip: 'Navigate: orbit tour, wheel direction, lens', items: [
                { key: 'orbit', icon: 'dw-icon-orbit', tip: 'Orbit tour: turn around what you look at (click again to stop)', run: () => (this.orbitTimer ? this.stopOrbit() : this.orbit()), on: () => !!this.orbitTimer },
                { key: 'zoompick', icon: 'dw-icon-zoompick', tip: 'Zoom to a picked wall, in 3D and on its plan', run: () => this.views.setZoomPick(!this.views.zoomPick), on: () => this.views.zoomPick },
                { key: 'reverse', icon: 'dw-icon-reverse', tip: 'Reverse the mouse wheel zoom', run: () => { s.reverse = !s.reverse; v.setReverseZoomDirection(s.reverse); }, on: () => s.reverse },
                ...[[30, 'Lens: 30° (telephoto)'], [45, 'Lens: 45° (normal)'], [70, 'Lens: 70° (wide)'], [100, 'Lens: 100° (very wide)']].map(([deg, tip]) =>
                    ({ key: `fov${deg}`, icon: `dw-icon-fov${deg}`, tip, run: () => { s.fov = deg; v.setFOV(deg); }, on: () => s.fov === deg })),
            ] },
            { id: 'dw-display', icon: 'dw-icon-display', tip: 'Display: edges, shadows, reflection', items: [
                { key: 'edges', icon: 'dw-icon-edges', tip: 'Edges (outlines)', run: () => { s.edges = !s.edges; v.setDisplayEdges(s.edges); }, on: () => s.edges },
                { key: 'ao', icon: 'dw-icon-ao', tip: 'Ambient shadows (depth in corners)', run: () => { s.ao = !s.ao; v.setQualityLevel(s.ao, true); }, on: () => s.ao },
                { key: 'ground', icon: 'dw-icon-ground', tip: 'Ground shadow', run: () => { s.ground = !s.ground; v.setGroundShadow(s.ground); }, on: () => s.ground },
                { key: 'reflect', icon: 'dw-icon-reflect', tip: 'Ground reflection', run: () => { s.reflect = !s.reflect; v.setGroundReflection(s.reflect); }, on: () => s.reflect },
            ] },
            { id: 'dw-look', icon: 'dw-icon-look', tip: 'Background and lighting', items: [
                ...[['light', 'Light background'], ['sky', 'Sky background'], ['dark', 'Dark background']].map(([key, tip]) =>
                    ({ key: `bg-${key}`, icon: `dw-icon-bg-${key}`, tip, run: () => { s.bg = key; v.setBackgroundColor(...BACKGROUNDS[key]); }, on: () => s.bg === key })),
                { key: 'lighting', icon: 'dw-icon-lighting', tip: 'Next lighting (17 environments)', run: () => { s.light = (s.light + 1) % LIGHTS; v.setLightPreset(s.light); } },
            ] },
            { id: 'dw-select', icon: 'dw-icon-select', tip: 'What a click selects', items: [
                { key: 'leaf', icon: 'dw-icon-sel-leaf', tip: 'Click selects: the element (default)', run: () => this.selectMode('leaf'), on: () => s.select === 'leaf' },
                // LAST_OBJECT: the nearest assembly in the model tree. (FIRST_OBJECT would select the whole Model in a Revit file.)
                { key: 'last', icon: 'dw-icon-sel-last', tip: 'Click selects: the assembly it is part of (a curtain wall with its panels and doors, a stair with its runs)', run: () => this.selectMode('last'), on: () => s.select === 'last' },
            ] },
            this.unitsMenu(),
            { id: 'dw-shot', icon: 'dw-icon-shot', tip: 'Screenshot: save the 3D view as a PNG', run: () => this.screenshot('3d') },
        ];
    }

    menus2d() {
        return [this.unitsMenu(), { id: 'dw-shot', icon: 'dw-icon-shot', tip: 'Screenshot: save the plan as a PNG', run: () => this.screenshot('plan') }];
    }

    // Units of the lengths shown in the Properties panel.
    unitsMenu() {
        const s = this.state;
        return { id: 'dw-units', icon: 'dw-icon-units', tip: 'Units in the Properties panel', items: UNITS.map(([key, value, tip]) =>
            ({ key, icon: `dw-icon-u-${key}`, tip, run: () => { s.units = key; this.viewer.setDisplayUnits(value); }, on: () => s.units === key })) };
    }

    // Look at the building from a direction, then fit what is shown (fitToView keeps the direction). Not the ViewCube's
    // faces: those frame the whole model's extents, which stray far-off objects (site CAD) can make miles wide.
    look(dir) {
        const v = this.viewer, b = this.views.building, model = v.model;
        const box = model.getBoundingBox();
        const center = b ? b.center.clone() : new THREE.Vector3().addVectors(box.min, box.max).multiplyScalar(0.5);
        const r = b ? b.radius : box.getSize(new THREE.Vector3()).length() / 2;
        const d = new THREE.Vector3(...dir).normalize();
        const up = Math.abs(d.z) > 0.99 ? new THREE.Vector3(0, d.z > 0 ? 1 : -1, 0) : new THREE.Vector3(0, 0, 1);
        this.stopOrbit();
        v.navigation.setView(center.clone().add(d.multiplyScalar(r * 2)), center, up);
        const shown = this.views.isolated || [...this.views.wallsByLevel.values()].flat();
        v.fitToView(shown.length ? shown : null, model, true);
    }

    selectMode(mode) {
        const M = Autodesk.Viewing.SelectionMode;
        this.state.select = mode;
        this.viewer.setSelectionMode(mode === 'last' ? M.LAST_OBJECT : M.LEAF_OBJECT);
    }

    // Turn around the point looked at, at the same distance and height.
    orbit() {
        const nav = this.viewer.navigation, c = nav.getTarget().clone(), eye = nav.getPosition().clone();
        const up = new THREE.Vector3(0, 0, 1), dist = eye.distanceTo(c);
        let radius = Math.hypot(eye.x - c.x, eye.y - c.y), start = Math.atan2(eye.y - c.y, eye.x - c.x);
        // Looking straight down (the top view) there is nothing to circle: tilt to a 3/4 view at the same distance.
        if (radius < dist * 0.05) { radius = dist * 0.7; eye.z = c.z + dist * 0.7; start = -Math.PI / 4; }
        let angle = 0;
        this.orbitTimer = setInterval(() => {
            angle += Math.PI / 300;
            nav.setView(new THREE.Vector3(c.x + radius * Math.cos(start + angle), c.y + radius * Math.sin(start + angle), eye.z), c, up);
        }, 33);
        // A click on the model (not the toolbar) stops it, like a person taking the controls.
        this.stopOnClick = (e) => { if (e.target.tagName === 'CANVAS') this.stopOrbit(); };
        this.viewer.container.addEventListener('pointerdown', this.stopOnClick);
    }

    stopOrbit() {
        clearInterval(this.orbitTimer);
        this.orbitTimer = null;
        if (this.stopOnClick) this.viewer.container.removeEventListener('pointerdown', this.stopOnClick);
        this.stopOnClick = null;
    }

    screenshot(which) {
        const model = document.getElementById('models')?.selectedOptions[0]?.text || 'model';
        const name = `${model.replace(/[^\w-]+/g, '-').replace(/^-|-$/g, '')}-${which}.png`;
        this.viewer.getScreenShot(0, 0, (url) => {
            const a = Object.assign(document.createElement('a'), { href: url, download: name });
            document.body.append(a);
            a.click();
            a.remove();
        });
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, DrywallToolsExtension);
export { EXTENSION_ID as TOOLS_EXTENSION_ID };
