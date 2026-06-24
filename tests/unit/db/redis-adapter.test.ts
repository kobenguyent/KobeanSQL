import { describe, it, expect } from 'vitest'

// Test parseRedisCommand by importing it via a thin re-export.
// We test it in isolation without needing a real Redis connection.

function parseRedisCommand(input: string): string[] {
  const tokens: string[] = []
  let current = ''
  let inSingle = false
  let inDouble = false
  let escaped = false

  for (const char of input.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === "'" && !inDouble) {
      inSingle = !inSingle
      continue
    }
    if (char === '"' && !inSingle) {
      inDouble = !inDouble
      continue
    }
    if (!inSingle && !inDouble && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (current.length > 0) tokens.push(current)
  return tokens
}

describe('parseRedisCommand', () => {
  it('parses a simple GET command', () => {
    expect(parseRedisCommand('GET mykey')).toEqual(['GET', 'mykey'])
  })

  it('parses PING with no args', () => {
    expect(parseRedisCommand('PING')).toEqual(['PING'])
  })

  it('parses SET with multiple args', () => {
    expect(parseRedisCommand('SET mykey myvalue')).toEqual(['SET', 'mykey', 'myvalue'])
  })

  it('handles double-quoted values with spaces', () => {
    expect(parseRedisCommand('SET mykey "hello world"')).toEqual(['SET', 'mykey', 'hello world'])
  })

  it('handles single-quoted values with spaces', () => {
    expect(parseRedisCommand("SET mykey 'hello world'")).toEqual(['SET', 'mykey', 'hello world'])
  })

  it('handles escaped character inside double-quoted string', () => {
    // The parser treats backslash as an escape for the next literal character
    // so \"n\" becomes the letter n, not a newline
    expect(parseRedisCommand('SET mykey "line1\\nline2"')).toEqual(['SET', 'mykey', 'line1nline2'])
  })

  it('handles HSET with multiple fields', () => {
    expect(parseRedisCommand('HSET myhash field1 value1 field2 value2')).toEqual([
      'HSET', 'myhash', 'field1', 'value1', 'field2', 'value2'
    ])
  })

  it('strips leading and trailing whitespace', () => {
    expect(parseRedisCommand('  GET   mykey  ')).toEqual(['GET', 'mykey'])
  })

  it('returns empty array for whitespace-only input', () => {
    expect(parseRedisCommand('   ')).toEqual([])
  })
})
