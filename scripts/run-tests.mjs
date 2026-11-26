import { build } from 'esbuild'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const temporary = await mkdtemp(join(tmpdir(), 'railsketch-tests-'))
const smoke = process.argv.includes('--smoke')

try {
  const entries = smoke
    ? [join(root, 'smoke-test.ts')]
    : (await readdir(join(root, 'tests'))).filter((name) => name.endsWith('.test.ts')).sort().map((name) => join(root, 'tests', name))
  if (entries.length === 0) throw new Error('No test files found')
  await build({
    entryPoints: entries,
    outdir: temporary,
    outExtension: { '.js': '.mjs' },
    bundle: true,
    platform: 'node',
    format: 'esm',
    define: { 'import.meta.env.DEV': 'false' },
    banner: {
      js: 'globalThis.requestAnimationFrame ??= () => 1; globalThis.cancelAnimationFrame ??= () => {};',
    },
  })
  const files = (await readdir(temporary)).filter((name) => name.endsWith('.mjs')).map((name) => join(temporary, name))
  const result = spawnSync(process.execPath, [...(smoke ? [] : ['--test']), ...files], { cwd: root, stdio: 'inherit' })
  if (result.error) throw result.error
  process.exitCode = result.status ?? 1
} finally {
  await rm(temporary, { recursive: true, force: true })
}
