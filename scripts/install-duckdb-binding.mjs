#!/usr/bin/env node
// Force-installs a @duckdb/node-bindings-<os>-<arch> package into node_modules.
// Needed when cross-building (e.g. packaging a Windows app from macOS) because
// npm's os/cpu filtering on optionalDependencies refuses to install mismatched
// platform bindings even with --force.
//
// Usage: node scripts/install-duckdb-binding.mjs <os>-<arch> [version]

import { execSync } from 'node:child_process'
import { rmSync, mkdirSync, existsSync, readdirSync, renameSync } from 'node:fs'
import path from 'node:path'

const platform = process.argv[2]
const version = process.argv[3] ?? '1.5.2-r.1'

if (!platform || !/^(darwin|linux|win32)-(arm64|x64)$/.test(platform)) {
  console.error(`usage: install-duckdb-binding.mjs <os>-<arch> [version]
  where <os>-<arch> is one of: darwin-arm64, darwin-x64, linux-x64, linux-arm64, win32-x64`)
  process.exit(1)
}

const pkgName = `@duckdb/node-bindings-${platform}`
const pkgSpec = `${pkgName}@${version}`
const targetDir = path.resolve('node_modules/@duckdb', `node-bindings-${platform}`)
const sentinel = path.join(targetDir, 'duckdb.node')

if (existsSync(sentinel)) {
  console.log(`${pkgName} already installed`)
  process.exit(0)
}

console.log(`fetching ${pkgSpec}…`)
const tarballDir = path.resolve('node_modules/@duckdb')
mkdirSync(tarballDir, { recursive: true })

const before = new Set(readdirSync(tarballDir).filter((f) => f.endsWith('.tgz')))
execSync(`npm pack ${pkgSpec} --silent --pack-destination "${tarballDir}"`, { stdio: 'inherit' })
const after = readdirSync(tarballDir).filter((f) => f.endsWith('.tgz'))
const tarball = after.find((f) => !before.has(f))
if (!tarball) {
  console.error('npm pack did not produce a tarball')
  process.exit(1)
}
const tarballPath = path.join(tarballDir, tarball)

rmSync(targetDir, { recursive: true, force: true })
mkdirSync(targetDir, { recursive: true })

execSync(`tar -xzf "${tarballPath}" -C "${targetDir}" --strip-components 1`, { stdio: 'inherit' })
rmSync(tarballPath)

if (!existsSync(sentinel)) {
  console.error(`extraction succeeded but ${sentinel} is missing`)
  process.exit(1)
}
console.log(`${pkgName} installed → ${targetDir}`)
