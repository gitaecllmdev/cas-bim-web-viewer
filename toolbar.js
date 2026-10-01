// Toolbar buttons and fly-out menus, shared by the quick tools (tools.js) and each demo's own buttons: a demo puts what it
// does on the 3D toolbar (DemoToolbar), next to the few general tools it keeps (demos.json "toolbar").
// Icons are text glyphs (main.css, .dw-icon-*).
// Customizing the toolbar: https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/viewer_basics/toolbar-button/
// Button / ComboButton / ControlGroup: https://aps.autodesk.com/en/docs/viewer/v7/reference/UI/Button/,
//   https://aps.autodesk.com/en/docs/viewer/v7/reference/UI/ComboButton/, https://aps.autodesk.com/en/docs/viewer/v7/reference/UI/ControlGroup/
// Extension.onToolbarCreated (called after load when the toolbar exists): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Extension/

export function toolbarButton(id, icon, tip, action) {
    const button = new Autodesk.Viewing.UI.Button(id);
    button.setIcon(icon);
    button.setToolTip(tip);
    button.onClick = () => action(button);
    return button;
}

// A fly-out menu. Each item: { key, icon, tip, run(), on() } where on() says whether it is the current choice (or
// switched on). Returns the ComboButton and mark() to re-mark the choices after something else changed them.
export function toolbarMenu(id, { icon, tip, items }) {
    const combo = new Autodesk.Viewing.UI.ComboButton(id);
    combo.setIcon(icon);
    combo.setToolTip(tip);
    const buttons = items.map(item => {
        const b = new Autodesk.Viewing.UI.Button(`${id}-${item.key}`);
        b.setIcon(item.icon);
        b.setToolTip(item.tip);
        b.onClick = () => {
            item.run();
            mark();
            combo.restoreDefault();
        };
        combo.addControl(b);
        return [b, item];
    });
    // The current choices get a mark of their own (dw-on): the fly-out resets its buttons' states, and an active
    // button would become the menu's icon (the toolbar's "last used tool"), so the menu keeps its own (saveAsDefault /
    // restoreDefault).
    const mark = () => buttons.forEach(([b, item]) => (item.on?.() ? b.addClass('dw-on') : b.removeClass('dw-on')));
    combo.saveAsDefault();
    mark();
    combo.restoreDefault();
    return { control: combo, mark };
}

// A demo's own group on the 3D toolbar. specs: [{ key, icon, tip, run(button), on() }] for a button (on(): shown as
// switched on), or [{ key, icon, tip, items }] for a menu. Build it from the demo extension's onToolbarCreated(toolbar).
export class DemoToolbar {
    constructor(viewer, id, specs) {
        this.viewer = viewer;
        this.group = new Autodesk.Viewing.UI.ControlGroup(id);
        this.marks = [];
        for (const spec of specs) {
            if (spec.items) {
                const { control, mark } = toolbarMenu(`${id}-${spec.key}`, spec);
                this.group.addControl(control);
                this.marks.push(mark);
            } else {
                const b = toolbarButton(`${id}-${spec.key}`, spec.icon, spec.tip, (button) => { spec.run(button); this.refresh(); });
                this.group.addControl(b);
                if (spec.on) this.marks.push(() => (spec.on() ? b.addClass('dw-on') : b.removeClass('dw-on')));
            }
        }
        viewer.toolbar.addControl(this.group);
        this.refresh();
    }

    // Re-mark the current choices (call after the demo's panel changed one).
    refresh() {
        this.marks.forEach(mark => mark());
    }

    remove() {
        this.viewer.toolbar?.removeControl(this.group);
    }
}
