// Drawing/export presentation from a resolved plan; never changes members or fabrication values.
export function reviewInfo(plan) {
    return { unresolved: (plan?.issues || []).filter(i => i.severity === 'needs-resolution').map(i => i.message) };
}
export function sourceInfo(modelLinked) {
    return modelLinked ? {
        sourceNote: 'Imported from Revit. Model geometry is locked; web-added openings are study only. Verify the dimensions in the field.',
        keyplanNote: 'REVIT IMPORT: NO KEY PLAN SUPPLIED',
        linkNote: 'Imported in the Panel Shop Generator. Export JSON to keep the editable set.',
    } : {
        sourceNote: 'Entered by hand in the Panel Shop Generator (no model). Verify the dimensions in the field.',
        keyplanNote: 'NO MODEL: SIZES ENTERED BY HAND',
        linkNote: 'Entered in the Panel Shop Generator: share this panel with its Copy link.',
    };
}

export function labelReview(plan, layout) {
    if (layout?.issues?.length) return 'CHECK FAILED - DO NOT FABRICATE';
    if (reviewInfo(plan).unresolved.length) return 'PRELIMINARY - DO NOT FABRICATE';
    return null;
}
