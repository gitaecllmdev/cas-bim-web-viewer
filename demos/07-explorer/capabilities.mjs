// Demo 7's capability catalog: what the APS Viewer can do, where to try it here, and the APS docs for each. Plain data
// (no viewer), so the list can be tested and copied into Teams or Excel.
// how: 'try' (in this demo; `at` is the section to jump to), 'demo' (another demo, `demo` = its id), 'on' (always
// there: the toolbar or the page itself), 'possible' (the APS Viewer can, not built in these demos).

const V = 'https://aps.autodesk.com/en/docs/viewer/v7/';
const ext = (name) => `${V}reference/Extensions/${name}/`;
const ref = (name) => `${V}reference/Viewing/${name}/`;

export const HOW = {
    try: 'Try it here',
    demo: 'In another demo',
    on: 'On the toolbar / always on',
    possible: 'Possible, not built yet',
};

export const CAPABILITIES = [
    { group: 'Open and stream the model', items: [
        { name: 'Revit, IFC, Navisworks, DWG, PDF and 60+ other formats', how: 'on', what: 'Each file is translated once (Model Derivative) into SVF2, which streams into any browser. This model is a Revit file.', api: 'Model Derivative', doc: 'https://aps.autodesk.com/en/docs/model-derivative/v2/developers_guide/supported-translations/supported-translation/' },
        { name: '3D views and 2D sheets from one file', how: 'try', at: 'layout', what: 'The 3D model and every sheet and plan view in the file, opened side by side.', api: 'BubbleNode, Viewer3D.loadDocumentNode', doc: ref('BubbleNode') },
        { name: 'Large models, streamed', how: 'try', at: 'stats', what: 'Tens of thousands of objects load progressively; the view is usable before the last one arrives.', api: 'Viewer3D', doc: ref('Viewer3D') },
        { name: 'Federated models (architecture + structure + MEP)', how: 'possible', what: 'Several models in one view, aligned, each one switchable.', api: 'AggregatedView', doc: `${V}developers_guide/advanced_options/aggregated-view/` },
        { name: 'Compare two versions', how: 'possible', what: 'Added, removed and changed objects between two uploads of the same model.', api: 'DiffTool', doc: `${V}developers_guide/viewer_basics/difftool/` },
        { name: 'PDF drawings without translation', how: 'possible', what: 'Open a PDF set directly, with the same measure and markup tools.', api: 'PDFExtension', doc: ext('PDFExtension') },
    ] },
    { group: 'Find and filter', items: [
        { name: 'Every object keeps its Revit properties', how: 'try', at: 'pick', what: 'Click anything: category, type, level and every parameter.', api: 'Model.getProperties, getBulkProperties', doc: ref('Model') },
        { name: 'Search any text', how: 'try', at: 'find', what: 'Find every object with a word in any property (a type, a mark, a fire rating) and isolate the results.', api: 'Viewer3D.search', doc: ref('Viewer3D') },
        { name: 'Groups from the properties', how: 'try', at: 'groups', what: 'Framing walls (from the takeoff rules), shaft walls, curtain wall, doors, MEP… counted and isolated in one click.', api: 'getBulkProperties, Viewer3D.isolate', doc: ref('Viewer3D') },
        { name: 'Isolate, ghost or hide', how: 'try', at: 'groups', what: 'Show a group alone, with the rest see-through for context, or take it away.', api: 'Viewer3D.isolate, setGhosting, hide', doc: ref('Viewer3D') },
        { name: 'Select an element or its whole assembly', how: 'on', what: 'Toolbar Options ⌖: a click picks the element, or the assembly it is part of (a curtain wall with its panels and doors, a stair with its runs).', api: 'Viewer3D.setSelectionMode', doc: ref('Viewer3D') },
        { name: 'Model browser and properties panel', how: 'try', at: 'panels', what: 'The built-in tree of every object and the built-in properties panel.', api: 'ModelStructureExtension, PropertiesManagerExtension', doc: ext('ModelStructureExtension') },
        { name: 'Back to the Revit element', how: 'demo', demo: '06-shop-drawings', what: 'Each object carries its Revit unique ID, so a web page (the panel QR pages) can point at the exact element.', api: 'Model.getExternalIdMapping', doc: ref('Model') },
    ] },
    { group: 'Show and color', items: [
        { name: 'Color by any property', how: 'try', at: 'color', what: 'Workset, phase, fire rating, type, stud size, level…: a color per value with a legend; click a value to isolate it.', api: 'Viewer3D.setThemingColor', doc: ref('Viewer3D') },
        { name: 'Section planes and a section box', how: 'try', at: 'cut', what: 'Cut across or along the building, a plan cut, or a box with handles to drag.', api: 'SectionExtension', doc: ext('SectionExtension') },
        { name: 'Explode', how: 'try', at: 'cut', what: 'Pull the model apart from the middle (radial) or by its object tree (hierarchy).', api: 'Viewer3D.explode, ExplodeExtension', doc: ext('ExplodeExtension') },
        { name: 'Display and lighting', how: 'try', at: 'display', what: 'Edges, ambient shadows, ground shadow and reflection, lighting environments, background.', api: 'Viewer3D.setDisplayEdges, setQualityLevel, setGroundShadow, setLightPreset', doc: ref('Viewer3D') },
        { name: 'Display units', how: 'on', what: 'Toolbar Options ⇿: lengths in the properties in feet and inches, decimal feet, inches, meters or millimeters.', api: 'Viewer3D.setDisplayUnits', doc: ref('Viewer3D') },
        { name: 'Wireframe', how: 'possible', what: 'Lines only. Autodesk advises against it on large models like this one.', api: 'WireframesExtension', doc: ext('WireframesExtension') },
    ] },
    { group: 'Move around', items: [
        { name: 'Orbit, pan, zoom, ViewCube, home', how: 'on', what: 'Mouse, trackpad or touch; the ViewCube turns to any face.', api: 'Navigation, ViewCubeUi', doc: ext('ViewCubeUi') },
        { name: 'Preset views and an orbit tour', how: 'try', at: 'move', what: 'Top, front, side and 3/4 views around the building, and a slow turn around it.', api: 'Navigation.setView, Viewer3D.fitToView', doc: ref('Navigation') },
        { name: 'Walk inside', how: 'try', at: 'move', what: 'First person: W A S D to walk, the mouse to look around.', api: 'BimWalkExtension', doc: ext('BimWalkExtension') },
        { name: 'Zoom window', how: 'try', at: 'move', what: 'Drag a box to zoom into it, in 3D or on a sheet.', api: 'ZoomWindow', doc: ext('ZoomWindow') },
        { name: 'Field of view', how: 'try', at: 'move', what: 'Wide angle to telephoto.', api: 'Viewer3D.setFOV', doc: ref('Viewer3D') },
        { name: 'Mouse wheel direction', how: 'on', what: 'Toolbar Options ✥: reverse the wheel zoom for people used to other CAD tools.', api: 'Viewer3D.setReverseZoomDirection', doc: ref('Viewer3D') },
        { name: 'Full screen', how: 'try', at: 'move', what: 'The viewer alone on the screen (a projector or a tablet on site).', api: 'FullScreenExtension', doc: ext('FullScreenExtension') },
        { name: 'Tablets and phones', how: 'demo', demo: '05-field-layout', what: 'Touch gestures; big buttons for crews in the field.', api: 'Viewer3D', doc: ref('Viewer3D') },
    ] },
    { group: 'Measure and mark up', items: [
        { name: 'Distance and angle in 3D', how: 'try', at: 'move', what: 'Snaps to the model geometry, in feet and fractional inches.', api: 'MeasureExtension', doc: ext('MeasureExtension') },
        { name: 'Area, arc and calibrate on a sheet', how: 'try', at: 'measure2d', what: 'Area and arc measuring are 2D tools; calibrate a scale on any drawing.', api: 'MeasureExtension.activate(mode)', doc: ext('MeasureExtension') },
        { name: 'Draw areas on the plan', how: 'try', at: 'edit2d', what: 'Polygons with their area, editable (move a corner, an edge, the shape).', api: 'Edit2D', doc: `${V}developers_guide/advanced_options/edit2d-setup/` },
        { name: 'Markups on the model or a sheet', how: 'try', at: 'markup', what: 'Arrows, clouds, boxes, circles, text and freehand, saved with the view and reopened.', api: 'MarkupsCore', doc: ext('MarkupsCore') },
        { name: 'Screenshots', how: 'try', at: 'shots', what: 'The 3D view or the plan as an image, to drop in an email or an RFI.', api: 'Viewer3D.getScreenShot', doc: ref('Viewer3D') },
    ] },
    { group: '2D + 3D together', items: [
        { name: 'The plan beside the model', how: 'try', at: 'layout', what: '3D, split or 2D; both viewers share selection, isolation and colors.', api: 'Viewer3D (two viewers)', doc: ref('Viewer3D') },
        { name: 'Pick in either, see it in both', how: 'try', at: 'link', what: 'Pick a wall in 3D and its floor plan opens with the wall highlighted; pick it on the plan and 3D follows.', api: 'Viewer3D.select, SELECTION_CHANGED_EVENT', doc: ref('Viewer3D') },
        { name: 'Floor by floor', how: 'try', at: 'floors', what: 'A level cut in 3D and that level\'s plan in 2D, a floor at a time.', api: 'SectionExtension.setSectionBox', doc: ext('SectionExtension') },
        { name: 'Colors on the plan', how: 'try', at: 'link', what: 'The same colors paint the walls on the sheet.', api: 'Viewer3D.setThemingColor', doc: ref('Viewer3D') },
        { name: 'Labels on the plan', how: 'demo', demo: '02-takeoff', what: 'Stud sizes written on the walls of the floor plan.', api: 'Viewer3D.hitTest, clientToWorld', doc: ref('Viewer3D') },
        { name: 'Sheet-to-sheet hyperlinks', how: 'possible', what: 'Click a callout on a sheet to open the sheet it points to (when the file has them).', api: 'HyperlinkExtension', doc: ext('HyperlinkExtension') },
        { name: 'CAD layers on and off', how: 'possible', what: 'For DWG and PDF drawings; Revit sheets don\'t have layers.', api: 'LayerManagerExtension, Viewer3D.setLayerVisible', doc: ext('LayerManagerExtension') },
    ] },
    { group: 'Review and share', items: [
        { name: 'Saved views and a tour', how: 'try', at: 'saved', what: 'Camera, cuts, isolation, colors and the floor, saved by name and played back in order.', api: 'Viewer3D.getState, restoreState', doc: ref('Viewer3D') },
        { name: 'Links that open a level or a demo', how: 'on', what: 'The page link keeps the demo, the level and the layout, so it can be sent.', api: 'Page link (no APS call)', doc: ref('Viewer3D') },
        { name: 'Punch items pinned on walls', how: 'demo', demo: '04-punch', what: 'Issues placed in 3D or on the plan, with markup and a jump to each.', api: 'Viewer3D.hitTest', doc: ref('Viewer3D') },
        { name: 'Install progress and the P6 schedule in 4D', how: 'demo', demo: '03-progress', what: 'Walls colored by stage; the schedule as a Gantt and a date slider.', api: 'Viewer3D.setThemingColor', doc: ref('Viewer3D') },
        { name: 'Takeoff from the model', how: 'demo', demo: '02-takeoff', what: 'Studs, track, board and openings by level and framing type; CSV.', api: 'getBulkProperties', doc: ref('Model') },
        { name: 'Shop drawings with QR codes', how: 'demo', demo: '06-shop-drawings', what: 'Framing elevations per panel, printed with a QR code to the panel\'s page.', api: 'Viewer3D', doc: ref('Viewer3D') },
    ] },
    { group: 'Build on it', items: [
        { name: 'Custom tools (extensions)', how: 'demo', demo: '01-wall-types', what: 'Every demo here is an extension: our own buttons, panels and logic inside the viewer.', api: 'Extension', doc: `${V}developers_guide/viewer_basics/extensions/` },
        { name: 'Add our own 3D geometry', how: 'possible', what: 'Show generated framing, clearance zones or equipment that isn\'t in the Revit file.', api: 'SceneBuilder, ModelBuilder', doc: ext('SceneBuilder') },
        { name: 'Icons anchored in 3D', how: 'demo', demo: '04-punch', what: 'The punch pins are clickable icons placed in the model, the same tool used for sensors.', api: 'Data Visualization (SpriteViewable)', doc: 'https://aps.autodesk.com/en/docs/dataviz/v1/developers_guide/examples/sprites/create_sprite_style/' },
        { name: 'Sensors and heatmaps (digital twin)', how: 'possible', what: 'Live device data on those icons, and heatmaps over rooms or floors.', api: 'Data Visualization extension', doc: 'https://aps.autodesk.com/en/docs/dataviz/v1/developers_guide/overview/' },
        { name: 'On a map', how: 'possible', what: 'Show the model\'s geographic location and coordinates.', api: 'GeolocationExtension', doc: ext('GeolocationExtension') },
        { name: 'Any browser, no install, no Autodesk login', how: 'on', what: 'Viewers only get a read-only viewing token from our server; nothing to install.', api: 'Authentication (2-legged token)', doc: 'https://aps.autodesk.com/en/docs/oauth/v2/reference/http/gettoken-POST/' },
    ] },
];

export const allCapabilities = () => CAPABILITIES.flatMap(g => g.items.map(i => ({ ...i, group: g.group })));

// For Teams / Excel: a table (HTML for rich paste, tab-separated for plain text).
const COLUMNS = [['group', 'Area'], ['name', 'Capability'], ['what', 'What it does'], ['status', 'Here'], ['api', 'APS API'], ['doc', 'Docs']];
const statusOf = (i, demoName) => (i.how === 'demo' ? `In ${demoName(i.demo)}` : HOW[i.how]);
export function capabilityTable(items, demoName = (id) => id) {
    const rows = items.map(i => ({ ...i, status: statusOf(i, demoName) }));
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<table><thead><tr>${COLUMNS.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${COLUMNS.map(([k]) => `<td>${k === 'doc' ? `<a href="${esc(r.doc)}">${esc(r.doc)}</a>` : esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const text = [COLUMNS.map(([, h]) => h), ...rows.map(r => COLUMNS.map(([k]) => String(r[k]).replace(/[\t\n]/g, ' ')))].map(r => r.join('\t')).join('\n');
    return { html, text };
}
