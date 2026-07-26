import type { DevelopmentCard, Resource, Resources } from '../game/types'
import { RESOURCES } from '../game/types'

export const RESOURCE_IMAGE: Record<Resource, string> = {
  brick: '/assets/resource-brick.webp',
  lumber: '/assets/resource-lumber.webp',
  ore: '/assets/resource-ore.webp',
  grain: '/assets/resource-grain.webp',
  wool: '/assets/resource-wool.webp',
}

export const RESOURCE_LABEL: Record<Resource, string> = {
  brick: 'Brick',
  lumber: 'Lumber',
  ore: 'Ore',
  grain: 'Grain',
  wool: 'Wool',
}

export const DEVELOPMENT_CARDS = ['knight', 'road-building', 'year-of-plenty', 'monopoly', 'victory-point'] as const satisfies readonly DevelopmentCard[]

export const DEVELOPMENT_ART: Record<DevelopmentCard, string> = {
  knight: '/assets/ui/development-knight.webp',
  'road-building': '/assets/ui/development-road-building.webp',
  'year-of-plenty': '/assets/ui/development-year-of-plenty.webp',
  monopoly: '/assets/ui/development-monopoly.webp',
  'victory-point': '/assets/ui/development-victory-point.webp',
}

export const DEVELOPMENT_NAME: Record<DevelopmentCard, string> = {
  knight: 'Knight',
  'road-building': 'Road Building',
  'year-of-plenty': 'Year of Plenty',
  monopoly: 'Monopoly',
  'victory-point': 'Victory Point',
}

export const DEVELOPMENT_SHORT: Record<DevelopmentCard, string> = {
  knight: 'Move robber · steal 1',
  'road-building': 'Place 2 free roads',
  'year-of-plenty': 'Take any 2',
  monopoly: 'Claim one resource',
  'victory-point': 'Hidden point',
}

export type HandCard = { key: string; resource: Resource; index: number; stacked: number }

/**
 * Turns a resource count into card objects. Three lumber is three cards, not a
 * chip reading "3". Above the threshold a resource collapses into one stack
 * carrying a numeral, which also keeps the rendered node count inside the
 * animation budget. Shared so the trade table shows the same hand as the HUD
 * rather than a second widget that merely resembles it.
 */
export const buildHand = (resources: Resources): HandCard[] => {
  const total = RESOURCES.reduce((sum, resource) => sum + resources[resource], 0)
  const threshold = total <= 12 ? 4 : total <= 18 ? 3 : total <= 26 ? 2 : 1
  const cards: HandCard[] = []
  for (const resource of RESOURCES) {
    const count = resources[resource]
    if (!count) continue
    if (count > threshold) cards.push({ key: `${resource}-stack`, resource, index: 0, stacked: count })
    else for (let index = 0; index < count; index += 1) cards.push({ key: `${resource}-${index}`, resource, index, stacked: 0 })
  }
  return cards
}

/** Counts a partial resource map. */
export const resourceTotal = (values: Partial<Resources>) => RESOURCES.reduce((sum, resource) => sum + (values[resource] ?? 0), 0)

/** One card object per unit held, for a face-up stack that has to be countable. */
export const spreadResources = (values: Partial<Resources>) =>
  RESOURCES.flatMap((resource) => Array.from({ length: values[resource] ?? 0 }, (_, index) => ({ key: `${resource}-${index}`, resource })))

/** "2 lumber, 1 ore", or "nothing". Used in every trade label and live region. */
export const describeResources = (values: Partial<Resources>) => {
  const parts = RESOURCES.filter((resource) => values[resource]).map((resource) => `${values[resource]} ${RESOURCE_LABEL[resource].toLowerCase()}`)
  return parts.length ? parts.join(', ') : 'nothing'
}

export type BuildKind = 'road' | 'settlement' | 'city' | 'development'

export const BUILD_COSTS: Record<BuildKind, Partial<Resources>> = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, grain: 1, wool: 1 },
  city: { ore: 3, grain: 2 },
  development: { ore: 1, grain: 1, wool: 1 },
}
