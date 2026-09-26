/// import * as Autodesk from "@types/forge-viewer";
// Viewer bootstrap from Autodesk's Simple Viewer tutorial:
// https://get-started.aps.autodesk.com/tutorials/simple-viewer/viewer

import { CONFIG } from './config.js';

// viewables:read token from the local server, or from the token service on the static review site.
async function getAccessToken(callback) {
    try {
        const resp = await fetch(CONFIG.tokenUrl);
        const body = await resp.json();
        if (!resp.ok) throw new Error(body.error || resp.statusText);
        callback(body.access_token, body.expires_in);
    } catch (err) {
        alert(`Could not obtain access token: ${err.message}`);
        console.error(err);
    }
}

export function initViewer(container) {
    return new Promise(function (resolve) {
        Autodesk.Viewing.Initializer({ env: 'AutodeskProduction', getAccessToken }, function () {
            const config = {
                extensions: ['Autodesk.DocumentBrowser'],
            };
            const viewer = new Autodesk.Viewing.GuiViewer3D(container, config);
            viewer.start();
            viewer.setTheme('light-theme');
            resolve(viewer);
        });
    });
}

export function loadModel(viewer, urn) {
    return new Promise(function (resolve, reject) {
        function onDocumentLoadSuccess(doc) {
            resolve(viewer.loadDocumentNode(doc, doc.getRoot().getDefaultGeometry()));
        }
        function onDocumentLoadFailure(code, message, errors) {
            reject({ code, message, errors });
        }
        viewer.setLightPreset(0);
        Autodesk.Viewing.Document.load('urn:' + urn, onDocumentLoadSuccess, onDocumentLoadFailure);
    });
}
