import path from 'node:path'

export function resolveBundlePath(root: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) throw new Error('rin5_bundle_path_escape')
  const absoluteRoot = path.resolve(root)
  const resolved = path.resolve(absoluteRoot, relativePath)
  if (resolved !== absoluteRoot && !resolved.startsWith(`${absoluteRoot}${path.sep}`)) {
    throw new Error('rin5_bundle_path_escape')
  }
  return resolved
}
