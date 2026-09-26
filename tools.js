// Quick-access toolbar group ("Drywall tools") added to both the 3D and the 2D viewer.
// Actions go through core/client/views.js, so they apply to both viewers at once.
// Customizing the toolbar: https://aps.autodesk.com/en/docs/viewer/v7/developers_guide/viewer_basics/toolbar-button/
// Button / ControlGroup: https://aps.autodesk.com/en/docs/viewer/v7/reference/classes/Button/ and .../classes/ControlGroup/
// Viewer3D (getSelection, fitToView, setGhosting): https://aps.autodesk.com/en/docs/viewer/v7/reference/Viewing/Viewer3D/
// ViewCubeUi (setViewCube): https://aps.autodesk.com/en/docs/viewer/v7/reference/classes/ViewCubeUi/

const EXTENSION_ID = 'Drywall.Tools';

class DrywallToolsExtension extends Autodesk.Viewing.Extension {
    load() {
        this.views = this.options.views;
        this.ghosting = true; // viewer default: isolated views show the rest as ghosts
        if (this.viewer.toolbar) this.onToolbarCreated(this.viewer.toolbar);
        return true;
    }

    unload() {
        if (this.group) this.viewer.toolbar.removeControl(this.group);
        this.group = null;
        return true;
    }

    onToolbarCreated(toolbar) {
        if (this.group) return;
        const is3d = this.options.is3d;
        const selection = () => this.viewer.getSelection();
        const tools = [
            ['isolate', 'Isolate selection (3D + 2D)', () => { const ids = selection(); if (ids.length) this.views.isolate(ids); }],
            ['hide', 'Hide selection (3D + 2D)', () => { const ids = selection(); if (ids.length) this.views.hide(ids); }],
            ['showall', 'Show all (clears isolate and hide)', () => this.views.showAll()],
            ['fit', 'Zoom to selection', () => this.viewer.fitToView(selection().length ? selection() : null, this.viewer.model)],
            ['building', 'Whole building (clear the level section)', () => this.views.setLevel(null)],
        ];
        if (is3d) {
            tools.push(
                ['xray', 'X-ray: ghost or hide the rest when isolating', (button) => {
                    this.ghosting = !this.ghosting;
                    this.viewer.setGhosting(this.ghosting);
                    button.setState(this.ghosting ? Autodesk.Viewing.UI.Button.State.ACTIVE : Autodesk.Viewing.UI.Button.State.INACTIVE);
                }],
                ['top', 'Plan view (look down from the top)', () => this.viewer.getExtension('Autodesk.ViewCubeUi')?.setViewCube('top')],
            );
        }
        this.group = new Autodesk.Viewing.UI.ControlGroup(`dw-tools-${is3d ? '3d' : '2d'}`);
        for (const [id, tip, action] of tools) {
            const button = new Autodesk.Viewing.UI.Button(`dw-${id}-${is3d ? '3d' : '2d'}`);
            button.setIcon(`dw-icon-${id}`);
            button.setToolTip(tip);
            button.onClick = () => action(button);
            if (id === 'xray') button.setState(Autodesk.Viewing.UI.Button.State.ACTIVE);
            this.group.addControl(button);
        }
        toolbar.addControl(this.group);
    }
}

Autodesk.Viewing.theExtensionManager.registerExtension(EXTENSION_ID, DrywallToolsExtension);
export { EXTENSION_ID as TOOLS_EXTENSION_ID };
