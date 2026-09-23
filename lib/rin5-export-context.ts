import { AsyncLocalStorage } from 'node:async_hooks'

const exportTokenStore = new AsyncLocalStorage<string>()

export function runWithRin5ExportToken<T>(token: string, operation: () => Promise<T>): Promise<T> {
  return exportTokenStore.run(token, operation)
}

export function currentRin5ExportToken(): string | undefined {
  return exportTokenStore.getStore()
}
