// Generic choices are deliberately separate from physical layout and from future Revit family/type bindings.
export const TYPE_OPTIONS = Object.freeze({
    main: [ ['grid-main-9-16', '9/16" main runner'], ['grid-main-15-16', '15/16" main runner'] ],
    cross: [ ['grid-tee-9-16', '9/16" cross tee'], ['grid-tee-15-16', '15/16" cross tee'] ],
    trim: [ ['grid-wall-angle', 'Wall angle'], ['grid-shadow-trim', 'Shadow trim'] ],
    joist: [ ['362S162-33', '362S162-33'], ['362S162-43', '362S162-43'], ['600S162-43', '600S162-43'], ['600S162-54', '600S162-54'] ],
    track: [ ['362T125-33', '362T125-33'], ['362T125-43', '362T125-43'], ['600T125-43', '600T125-43'], ['600T125-54', '600T125-54'] ]
});
export function typeGroup(role, mode) {
    if (role === 'main-runner') return 'main';
    if (role.startsWith('cross-tee')) return 'cross';
    if (role === 'joist') return 'joist';
    if (role === 'opening-frame') return 'track';
    if (role === 'perimeter') return mode === 'grid' ? 'trim' : 'track';
    return null;
}
export function selectedType(selections, role, mode) {
    const group = typeGroup(role, mode), key = group && selections?.[group], match = TYPE_OPTIONS[group]?.find(([id]) => id === key);
    return match ? { key: match[0], name: match[1] } : null;
}
export function validateTypes(selections) {
    return selections == null || (typeof selections === 'object' && !Array.isArray(selections) && Object.entries(selections).every(([group, key]) => Object.hasOwn(TYPE_OPTIONS,group) && (key === '' || TYPE_OPTIONS[group].some(([id]) => id === key))));
}
