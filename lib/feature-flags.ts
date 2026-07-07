/**
 * Simple compile-time feature flags. Flip a value to enable/disable a feature
 * everywhere it is referenced (UI entry points and route guards).
 */

/**
 * The "Present" full-screen results reveal (projector mode) at
 * /tabulator/[eventId]/present. Hidden for now; flip to true to bring back the
 * dashboard button and the route.
 */
export const PRESENT_FEATURE_ENABLED = false;
