import assert from 'node:assert/strict'
import { RESOURCES } from '../game/types'
import { BUILD_COSTS, DEVELOPMENT_ART, DEVELOPMENT_CARDS, DEVELOPMENT_NAME, DEVELOPMENT_SHORT, RESOURCE_IMAGE, RESOURCE_LABEL } from './gameVisuals'

for (const resource of RESOURCES) {
  assert.ok(RESOURCE_IMAGE[resource], `missing image for ${resource}`)
  assert.ok(RESOURCE_LABEL[resource], `missing label for ${resource}`)
}

for (const card of DEVELOPMENT_CARDS) {
  assert.ok(DEVELOPMENT_ART[card], `missing art for ${card}`)
  assert.ok(DEVELOPMENT_NAME[card], `missing name for ${card}`)
  assert.ok(DEVELOPMENT_SHORT[card], `missing visual shorthand for ${card}`)
}

for (const [build, cost] of Object.entries(BUILD_COSTS)) {
  assert.ok(Object.values(cost).some((amount) => amount && amount > 0), `${build} needs a visible cost`)
  for (const resource of Object.keys(cost)) assert.ok(RESOURCES.includes(resource as (typeof RESOURCES)[number]), `${build} has an unknown resource`)
}

console.log('game visual contracts passed')
