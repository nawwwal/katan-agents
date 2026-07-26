import type { PlayerColor } from '../game/types'

export const PLAYER_COLORS: Record<PlayerColor, string> = {
  coral: '#d8563b',
  blue: '#287bd2',
  amber: '#e3a525',
  ivory: '#eee6cd',
}

/**
 * Roof tints. These used to carry ownership at full saturation, which a blind
 * art director called the loudest placeholder signal in the frame — primary
 * red, yellow and blue roofs read as Monopoly, not as a built village. They are
 * now four plausible roofing materials that happen to lean towards their
 * player's hue: weathered clay tile, blue-grey slate, ochre pantile, pale
 * shingle. Ownership moved to the banner, pennant, painted trim and the colour
 * ring set into the terrace, which is a better top-down read anyway.
 */
export const PLAYER_ROOF: Record<PlayerColor, string> = {
  coral: '#8d5340',
  blue: '#5a6875',
  amber: '#95764b',
  ivory: '#a2957e',
}

/** Banner and pennant cloth: the loudest, most saturated read of ownership. */
export const PLAYER_BANNER: Record<PlayerColor, string> = {
  coral: '#e04a2c',
  blue: '#2079d8',
  amber: '#f0aa17',
  ivory: '#f3ebd4',
}

/**
 * Legal-target beacons.
 *
 * Louder than any other player channel, because a beacon is not a piece: it is
 * game UI standing in the world, and it has to survive being read at a glance
 * across pale sand, bleached beach, dark forest canopy, grey rock, golden
 * wheat, red clay and blue water in the same frame. Every hue here is pushed to
 * high chroma so hue alone separates it from the terrain it lands on, and every
 * one of them is always paired with `BEACON_FRAME` — the bright half holds
 * against dark ground, the dark half holds against pale ground, which is the
 * same trick that made the roads legible.
 *
 * Ivory has no saturated form, so it is pushed cool instead. A warm near-white
 * is exactly the marker the audit could not find on a sand-coloured island.
 */
export const PLAYER_BEACON: Record<PlayerColor, string> = {
  coral: '#ff5a2d',
  blue: '#3aa8ff',
  amber: '#ffc41c',
  ivory: '#dff1ff',
}

/** The dark half of every beacon: ground pool, mast, collar, ghost kerbstone. */
export const BEACON_FRAME = '#05070b'

/**
 * The chosen target, while a confirm is outstanding. Cyan is the one hue no
 * player and no biome on this island owns, so "picked" never reads as "yours".
 */
export const BEACON_PENDING = '#7ceeff'

const KEY_BY_HEX = new Map<string, PlayerColor>(
  (Object.entries(PLAYER_COLORS) as Array<[PlayerColor, string]>).map(([key, hex]) => [hex.toLowerCase(), key]),
)

/**
 * GameScene hands pieces a resolved hex, so this maps it back to the palette
 * key the structure models need. Unowned pieces fall back to ivory.
 */
export const colorKeyFromHex = (hex?: string): PlayerColor => KEY_BY_HEX.get((hex ?? '').toLowerCase()) ?? 'ivory'

/** Painted trim on kerbstones and small accents. */
export const PLAYER_TRIM: Record<PlayerColor, string> = {
  coral: '#c04728',
  blue: '#2b78cd',
  amber: '#cf941c',
  ivory: '#ded3b4',
}

/**
 * Road paving. Roads are the one piece a player has to trace across the whole
 * board at a glance, so the setts carry the loudest, cleanest hue in the kit —
 * brighter than the roof tiles so a route never gets confused with a building,
 * and saturated enough to hold against both dark forest and pale sand.
 */
export const PLAYER_ROAD: Record<PlayerColor, string> = {
  coral: '#e8552c',
  blue: '#2586e6',
  amber: '#f0a911',
  // Ivory is the one hue the pale cobble albedo can blow out into a
  // checkerboard, so it is pulled down and warmed rather than brightened.
  ivory: '#ded0a4',
}
