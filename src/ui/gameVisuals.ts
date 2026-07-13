import type { DevelopmentCard, Resource, Resources } from '../game/types'

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

export type BuildKind = 'road' | 'settlement' | 'city' | 'development'

export const BUILD_COSTS: Record<BuildKind, Partial<Resources>> = {
  road: { brick: 1, lumber: 1 },
  settlement: { brick: 1, lumber: 1, grain: 1, wool: 1 },
  city: { ore: 3, grain: 2 },
  development: { ore: 1, grain: 1, wool: 1 },
}
