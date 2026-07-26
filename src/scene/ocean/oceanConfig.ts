// Shared constants for the ocean / shoreline system.
//
// The authored board frame (katan-kit.glb) puts the rock cliff between
// y = -0.080 and y = 0.330, the beach shelf at 0.280..0.410 and the turf top
// at 0.460. Sea level sits a little way up the rock face so surf breaks
// against stone instead of hovering under a floating prism.
export const SEA_LEVEL = 0.052

// The cliff silhouette is the coastal vertex ring scaled by this factor.
// Measured from the glTF: cliff half-extent 4.6116 / vertex ring 4.330.
export const CLIFF_SCALE = 1.085

// Half-size of the square the island distance field covers, in world units.
export const FIELD_EXTENT = 12
export const FIELD_RESOLUTION = 256

// Radius of the ocean disc. Fog swallows it long before this, but a large
// disc keeps a believable horizon if the sky owner opens the fog up.
export const OCEAN_RADIUS = 420
