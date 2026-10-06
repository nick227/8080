import { readFile } from 'node:fs/promises'

/** Resolve the actual CSS entry point so tests include every registered preset. */
export async function loadStyles(url = new URL('../src/styles/globals.css', import.meta.url)) {
  const source = await readFile(url, 'utf8')
  const imports = [...source.matchAll(/@import\s+['"]([^'"]+)['"];?/g)]
  let result = source
  for (const match of imports) {
    result = result.replace(match[0], await loadStyles(new URL(match[1], url)))
  }
  return result
}
