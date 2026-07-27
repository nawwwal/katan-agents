/**
 * One plain-text table, a few hundred tokens, readable without scrolling.
 *
 * A passing line says nothing beyond its number. A failing line adds the one
 * detail needed to find it and nothing else, because the whole point of this
 * harness is that reading a QA result should cost less than running it.
 */

export type Check = {
  name: string
  ok: boolean
  /** The measurement behind the verdict. Always a number, never a sentence. */
  value: number
  unit?: string
  /** Printed only on failure. */
  note?: string
}

export const renderTable = (title: string, checks: Check[]) => {
  const width = Math.max(4, ...checks.map((check) => check.name.length))
  const lines = [`${title}`]
  for (const check of checks) {
    const measure = check.unit ? `${check.value} ${check.unit}` : String(check.value)
    lines.push(`  ${check.name.padEnd(width)}  ${check.ok ? 'pass' : 'FAIL'}  ${measure}`)
    if (!check.ok && check.note) lines.push(`  ${' '.repeat(width)}        ${check.note}`)
  }
  return lines.join('\n')
}

export const summarise = (checks: Check[]) => {
  const failed = checks.filter((check) => !check.ok)
  return { total: checks.length, failed: failed.length, names: failed.map((check) => check.name) }
}
