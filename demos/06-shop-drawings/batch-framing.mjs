// Yield between bounded chunks; cache standalone template calculation only.
// Linked model identities, engineering selections and their source keys are
// resolved independently. Cache scope is one export, never shared across models.
import { cleanPanel } from './generator.mjs';
import { exportPlans, snapshotFromPanel, detailingFromPanel, resolveFramingPlan } from './framing-plan.mjs';

export async function resolvePlanBatch(set, engineering = null, { chunkSize = 25, cacheLimit = 128, onProgress = () => {},
    yieldTask = () => new Promise(resolve => setTimeout(resolve, 0)) } = {}) {
    if (!Number.isInteger(chunkSize) || chunkSize < 1 || chunkSize > 100) throw new Error('Batch chunk size must be 1 to 100 panels.');
    const out = exportPlans({ ...set, panels: [] }, engineering), cache = new Map();
    const stats = { panels: set.panels?.length || 0, resolved: 0, templateHits: 0, cacheEntries: 0 };
    for (let i=0;i<stats.panels;i++) {
        const panel = cleanPanel(set.panels[i]), snapshot = snapshotFromPanel(panel, { documentId: set.source?.documentId ?? null });
        const key = !panel.revit && !engineering ? JSON.stringify({ ...panel, id: '', mark: '', group: '', level: '', wallType: '' }) : null;
        let plan;
        if (key && cache.has(key)) {
            plan = structuredClone(cache.get(key));
            plan.source.identity = { ...snapshot.identity }; plan.source.fingerprint = snapshot.fingerprint;
            plan.source.lock = { ...snapshot.lock }; stats.templateHits++;
        } else {
            plan = resolveFramingPlan(snapshot, detailingFromPanel(panel), null, engineering); stats.resolved++;
            if (key && plan.source && cache.size < cacheLimit) cache.set(key, structuredClone(plan));
        }
        out.plans.push(plan);
        if ((i+1)%chunkSize===0 || i+1===stats.panels) {
            onProgress({ done: i+1, total: stats.panels });
            if (i+1<stats.panels) await yieldTask();
        }
    }
    stats.cacheEntries=cache.size;
    return { output: out, stats };
}
