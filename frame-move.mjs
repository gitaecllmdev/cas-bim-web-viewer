// How far to move the camera to show something (pure; tested in tests/frame-move.test.js). From how it sits in the
// view now: share, its size as a share of the view (1: it would just fill it), and onScreen, its middle in view.
// Keep the view while it can be seen at a useful size; bring it in at the same scale when it is the right size but off
// screen; zoom (to the target share) only when it is too small to find, or, with max, much bigger than the view.
// Returns { move: 'keep' } | { move: 'pan', share } | { move: 'zoom', share }.
export function frameMove({ share, onScreen }, { min = 0.05, max = Infinity, target = 0.15 } = {}) {
    if (!(share > 0) || !Number.isFinite(share)) return { move: 'zoom', share: target };
    const sizeOk = share >= min && share <= max;
    if (sizeOk && onScreen) return { move: 'keep' };
    if (sizeOk) return { move: 'pan', share };
    return { move: 'zoom', share: target };
}

// One wall picked: kept while it can be seen on screen (at least minPx across, the selection marking it; min where the
// view's size is not known), else shown at about 1/10 of the view (a good part of its floor around it); on the plan the
// same. A filtered set (a floor, a scope): kept from 1/3 of the view up to 1.6 times it, else fitted with a little room.
export const PICK = { min: 0.03, minPx: 16, target: 0.1 };
export const SET = { min: 0.33, max: 1.6, target: 0.85 };
