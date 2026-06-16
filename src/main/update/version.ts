const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export const normalizeVersion = (v: string) => v.trim().replace(/^v/i, '')

export function compareVersions(a: string, b: string): number {
  const na = normalizeVersion(a), nb = normalizeVersion(b)
  if (na === nb) return 0
  
  // Basic validation: must start with a digit
  if (!/^\d/.test(na) || !/^\d/.test(nb)) return 0

  const [v1, p1] = na.split('-'), [v2, p2] = nb.split('-')
  
  // Normalize core version parts to same length for collator (e.g. 1.2 -> 1.2.0)
  const c1 = v1.split('.'), c2 = v2.split('.')
  while (c1.length < c2.length) c1.push('0')
  while (c2.length < c1.length) c2.push('0')
  
  const core = collator.compare(c1.join('.'), c2.join('.'))
  if (core !== 0) return core
  if (!p1 && p2) return 1
  if (p1 && !p2) return -1
  return collator.compare(p1 || '', p2 || '')
}

export const isNewerVersion = (a: string, b: string) => compareVersions(a, b) > 0
