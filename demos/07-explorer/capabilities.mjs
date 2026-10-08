// Demo 0's capability catalog: what the APS Viewer can do, where to try it here, and the APS docs for each. Plain data
// (no viewer), so the list can be tested and copied into Teams or Excel.
// how: 'try' (in this demo; `at` is the section to jump to), 'demo' (another demo, `demo` = its id), 'on' (always
// there: the toolbar or the page itself), 'possible' (APS can, not built in these demos), 'not' (APS can't, or only
// another way, said in `what`).
// doc: the APS reference docs; src 'blog' (an APS blog post: Autodesk's, but not in the reference docs, so these demos
// don't use it) or 'sample' (a code sample on GitHub, not an Autodesk product).
// Researched 2026-10-01 from the APS docs, the APS blog (news recaps to September 2026) and the samples linked there.

const V = 'https://aps.autodesk.com/en/docs/viewer/v7/';
const ext = (name) => `${V}reference/Extensions/${name}/`;
const ref = (name) => `${V}reference/Viewing/${name}/`;

export const HOW = {
    try: 'Try it here',
    demo: 'In another demo',
    on: 'On the toolbar / always on',
    possible: 'Possible, not built yet',
    not: 'Not possible / another way',
};
export const SOURCES = { blog: 'APS blog', sample: 'Code sample' };

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
    { group: 'More viewer extensions (APS blog and samples)', items: [
        { name: 'Revit levels and a 2D minimap', how: 'possible', what: 'A level picker and a floor-plan minimap that follows the camera (handy when walking), from the Revit levels in the file.', api: 'Autodesk.AEC.LevelsExtension, Autodesk.AEC.Minimap3DExtension (AECModelData)', doc: `https://aps.autodesk.com/blog/add-revit-levels-and-2d-minimap-your-3d`, src: 'blog' },
        { name: 'Click on a sheet, find the spot in 3D', how: 'possible', what: 'Map a point in a sheet viewport to the 3D model, e.g. drop a punch item on the plan and see it on the wall.', api: 'AecModelData viewports (get2DTo3DMatrix)', doc: `https://aps.autodesk.com/blog/mapping-between-sheets-and-3d-views-aec-models`, src: 'blog' },
        { name: 'Search the text on drawings', how: 'possible', what: 'Find room names, notes or tags printed on PDF and DWG sheets, with their position on the page.', api: 'Autodesk.StringExtractor', doc: `https://aps.autodesk.com/blog/search-text-2d-document-autodeskstringextractor-extension`, src: 'blog' },
        { name: 'Compare two drawing versions', how: 'possible', what: 'Overlay two versions of a sheet (split screen, or added and removed in red and blue).', api: 'Autodesk.Viewing.PixelCompare', doc: `https://aps.autodesk.com/blog/compare-two-2d-documents-using-aps-viewer`, src: 'blog' },
        { name: 'Visual clusters', how: 'possible', what: 'Pull the model apart into piles by category (walls, doors, MEP…) to see what it is made of.', api: 'Autodesk.VisualClusters', doc: `https://aps.autodesk.com/blog/vibe-coding-part-1-build-aps-viewer-minutes`, src: 'blog' },
        { name: 'Terrain and maps (Esri)', how: 'possible', what: 'Real terrain and basemaps under the building, drawing on the terrain, GeoJSON export.', api: 'Geo.Terrain, Geo.Tools (sample extensions)', doc: 'https://github.com/wallabyway/geo-three-ext', src: 'sample' },
        { name: 'Smooth navigation', how: 'possible', what: 'A viewer option (beta) that reduces flicker and popping while moving through large models.', api: 'Viewer option (beta)', doc: `https://aps.autodesk.com/blog/august-news-recap-0`, src: 'blog' },
        { name: 'The viewer inside an AI chat', how: 'possible', what: 'The model, its properties and dashboards shown inside an AI assistant conversation.', api: 'APS Viewer in AI chat (MCP)', doc: `https://aps.autodesk.com/blog/embedding-aps-viewer-ai-chats-mcp-apps`, src: 'blog' },
    ] },
    { group: 'Beyond the viewer (APS platform)', items: [
        { name: 'Run Revit in the cloud', how: 'possible', what: 'A Revit add-in runs on Autodesk\'s servers with no Revit on the desk: create framing or families, set parameters, export schedules, sheets and PDFs. This is how "push framing back to Revit" would work, as a job rather than live.', api: 'Automation API (Design Automation) for Revit', doc: `https://aps.autodesk.com/en/docs/design-automation/v3/developers_guide/overview/` },
        { name: 'Work on Revit cloud models', how: 'possible', what: 'Those jobs can open and save Revit cloud (worksharing) models directly, Revit 2022 and later.', api: 'Automation API: Revit cloud model integration', doc: `https://aps.autodesk.com/en/docs/design-automation/v3/developers_guide/revit_specific/revit-cloud-model-integration/` },
        { name: 'Query walls and parameters without a viewer', how: 'possible', what: 'GraphQL queries for elements and parameters of published Revit 2024+ models in Forma (ACC). Read-only; event subscriptions in public beta (September 2026).', api: 'AEC Data Model API', doc: `https://aps.autodesk.com/en/docs/aecdatamodel/v1/developers_guide/overview/` },
        { name: 'Property index and version diffs', how: 'possible', what: 'Index the properties and bounding boxes of a model in Forma / BIM 360 and list what changed between two versions (walls added, removed, retyped).', api: 'Model Properties API', doc: `https://aps.autodesk.com/en/docs/acc/v1/overview/field-guide/model-properties/` },
        { name: 'Issues in Forma (ACC)', how: 'possible', what: 'Create and read issues with their pins on the model, so the punch list could live in the project\'s own issue log.', api: 'Issues API', doc: `https://aps.autodesk.com/en/docs/acc/v1/overview/field-guide/issues/` },
        { name: 'Clash results', how: 'possible', what: 'Read the clash tests that Model Coordination runs in Forma (ACC), e.g. framing against ducts.', api: 'Model Coordination API', doc: `https://aps.autodesk.com/en/docs/acc/v1/overview/field-guide/model-coordination/mcfg-clash/` },
        { name: 'React to a new model version', how: 'possible', what: 'A notification when a new version is uploaded, to translate it and refresh the takeoff and shop drawings without anyone asking.', api: 'Webhooks API', doc: `https://aps.autodesk.com/en/docs/webhooks/v1/developers_guide/overview/` },
        { name: 'Shared parameters in the cloud', how: 'possible', what: 'Keep the company\'s parameter definitions in one cloud library and load them into Revit projects and families.', api: 'Parameters API', doc: `https://aps.autodesk.com/en/docs/parameters/v1/overview/introduction/` },
        { name: 'Share part of a model with other apps', how: 'possible', what: 'Send a chosen set of elements (say, the framing walls) to Inventor, Rhino, Power BI and other connectors.', api: 'Data Exchange', doc: `https://aps.autodesk.com/en/docs/fdxgraph/v1/developers_guide/overview/` },
        { name: 'Digital twin for the owner', how: 'possible', what: 'Assets, spaces and live sensor streams after handover.', api: 'Tandem Data API', doc: `https://aps.autodesk.com/en/docs/tandem/v1/developers_guide/overview/` },
        { name: 'Export to other formats', how: 'possible', what: 'Besides the viewer format: IFC from Revit, OBJ, STL, STEP, thumbnails.', api: 'Model Derivative', doc: `https://aps.autodesk.com/en/docs/model-derivative/v2/developers_guide/supported-translations/supported-translation/` },
    ] },
    { group: 'What it can\'t do (or only another way)', items: [
        { name: 'Edit the Revit model live in the browser', how: 'not', what: 'The viewer is read-only. Changes go back through Revit itself or a cloud Revit job (Automation API), as a new version.', api: 'Viewer (read-only)', doc: ref('Viewer3D') },
        { name: 'Edit together in real time', how: 'not', what: 'Everyone sees the published version; there is no co-editing. Saved views, markups and issues are how people comment.', api: 'Viewer', doc: ref('Viewer3D') },
        { name: 'Run a clash detection in the viewer', how: 'not', what: 'Not built in. Model Coordination in Forma (ACC) runs clashes; the API reads the results.', api: 'Model Coordination API', doc: `https://aps.autodesk.com/en/docs/acc/v1/overview/field-guide/model-coordination/mcfg-clash/` },
        { name: 'Write properties back from the viewer', how: 'not', what: 'Not from the viewer, and the AEC Data Model API is read-only too. Writing goes through a Revit job (Automation API) or Revit.', api: 'AEC Data Model API (read-only)', doc: `https://aps.autodesk.com/en/docs/aecdatamodel/v1/developers_guide/overview/` },
        { name: 'Photorealistic rendering', how: 'not', what: 'The viewer has lighting environments, not ray-traced renders; renders come from Revit or 3ds Max (also available as cloud jobs).', api: 'Viewer3D.setLightPreset', doc: ref('Viewer3D') },
        { name: 'Read P6 directly', how: 'not', what: 'Primavera P6 is not an Autodesk product and has no APS connector: its exports (XER, Excel, PDF) are imported, as Demo 3 does.', api: '(none)', doc: ref('Viewer3D') },
        { name: 'Free without limits', how: 'not', what: 'APS has free and paid tiers for cloud APIs (since early 2026); translations and data APIs count against them. The AEC Data Model is included with subscriptions from 6 October 2026.', api: 'APS business model', doc: `https://aps.autodesk.com/blog/september-news-recap-2`, src: 'blog' },
    ] },
];

export const allCapabilities = () => CAPABILITIES.flatMap(g => g.items.map(i => ({ ...i, group: g.group })));

// For Teams / Excel: a table (HTML for rich paste, tab-separated for plain text).
const COLUMNS = [['group', 'Area'], ['name', 'Capability'], ['what', 'What it does'], ['status', 'Here'], ['api', 'APS API'], ['doc', 'Docs'], ['source', 'Source']];
const statusOf = (i, demoName) => (i.how === 'demo' ? `In ${demoName(i.demo)}` : HOW[i.how]);
export function capabilityTable(items, demoName = (id) => id) {
    const rows = items.map(i => ({ ...i, status: statusOf(i, demoName), source: SOURCES[i.src] || 'APS docs' }));
    const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const html = `<table><thead><tr>${COLUMNS.map(([, h]) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map(r => `<tr>${COLUMNS.map(([k]) => `<td>${k === 'doc' ? `<a href="${esc(r.doc)}">${esc(r.doc)}</a>` : esc(r[k])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    const text = [COLUMNS.map(([, h]) => h), ...rows.map(r => COLUMNS.map(([k]) => String(r[k]).replace(/[\t\n]/g, ' ')))].map(r => r.join('\t')).join('\n');
    return { html, text };
}
