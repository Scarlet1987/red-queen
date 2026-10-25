// Clean uninstallability is part of the doctrine: leaving must not strand
// orphaned keys or an IndexedDB handle behind. This is the only place that
// knows every key Red Queen writes.
import { HARNESS_DB } from './harness'

const LOCAL_KEYS = [
  'red-queen-rack',
  'red-queen-refinements',
  'red-queen-cosg-worksheets',
  'red-queen-harness',
  'red-queen-conversation',
  'red-queen-preview-url',
]

const SESSION_KEYS = ['red-queen-endpoint-key']

export const storedOnDevice = [
  'Your rack and refinements',
  'COS-G worksheets',
  'The harness model list and folder handle',
  'The workbench conversation, preview URL and endpoint key',
]

export function clearLocalData(): void {
  for (const key of LOCAL_KEYS) {
    try {
      localStorage.removeItem(key)
    } catch {
      // Storage blocked: nothing to remove.
    }
  }
  for (const key of SESSION_KEYS) {
    try {
      sessionStorage.removeItem(key)
    } catch {
      // Storage blocked: nothing to remove.
    }
  }
  try {
    indexedDB.deleteDatabase(HARNESS_DB)
  } catch {
    // No IndexedDB in this browser: no handle to remove.
  }
}
