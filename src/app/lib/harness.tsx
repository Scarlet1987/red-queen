import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'

import { cleanHarness, type ModelProvider, type StoredHarness } from './validate'

// The harness is the front door: one model, one project directory, then the
// workbench. Everything here is local to the browser — model names and
// endpoints in localStorage, the folder handle in IndexedDB.
export type { ModelProvider }

export interface ModelConfig {
  id: string
  label: string
  provider: ModelProvider
  baseUrl: string
  model: string
}

export interface HarnessDirectory {
  name: string
}

export const modelPresets: { provider: ModelProvider; label: string; baseUrl: string; note: string }[] = [
  { provider: 'ollama', label: 'Ollama', baseUrl: 'http://localhost:11434/v1', note: 'Local' },
  { provider: 'lmstudio', label: 'LM Studio', baseUrl: 'http://localhost:1234/v1', note: 'Local' },
  { provider: 'llamacpp', label: 'llama.cpp', baseUrl: 'http://localhost:8080/v1', note: 'Local' },
  { provider: 'custom', label: 'Custom endpoint', baseUrl: '', note: 'OpenAI-compatible' },
]

const STATE_KEY = 'red-queen-harness'
const HANDLE_KEY = 'project'

const emptyStored: StoredHarness = { models: [], activeId: null, directory: null }

// ---------------------------------------------------------------------------
// IndexedDB, for the directory handle only
// ---------------------------------------------------------------------------

const DB_NAME = 'red-queen-harness'
const DB_STORE = 'handles'

// Exported so the clean-uninstall action can drop the folder handle too.
export const HARNESS_DB = DB_NAME

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB is unavailable in this browser.'))
      return
    }
    const request = indexedDB.open(DB_NAME, 1)
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE)
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('Could not open IndexedDB.'))
  })
}

async function putHandle(handle: unknown): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(DB_STORE, 'readwrite')
    transaction.objectStore(DB_STORE).put(handle, HANDLE_KEY)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error ?? new Error('Could not store the folder handle.'))
  })
  db.close()
}

async function deleteHandle(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const transaction = db.transaction(DB_STORE, 'readwrite')
      transaction.objectStore(DB_STORE).delete(HANDLE_KEY)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => resolve()
    })
    db.close()
  } catch {
    // IndexedDB unavailable: nothing to delete.
  }
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface HarnessState {
  models: ModelConfig[]
  active: ModelConfig | null
  directory: HarnessDirectory | null
  ready: boolean
  error: string
  clearError: () => void
  addModel: (model: Omit<ModelConfig, 'id'>) => ModelConfig
  removeModel: (id: string) => void
  setActive: (id: string) => void
  chooseDirectory: () => Promise<void>
  forgetDirectory: () => void
  resetHarness: () => void
}

const HarnessContext = createContext<HarnessState | null>(null)

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID()
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
}

export function HarnessProvider({ children }: { children: ReactNode }) {
  const [stored, setStored] = useState<StoredHarness>(() => {
    try {
      return cleanHarness(JSON.parse(localStorage.getItem(STATE_KEY) ?? 'null'))
    } catch {
      return emptyStored
    }
  })
  const [error, setError] = useState('')

  useEffect(() => {
    try {
      localStorage.setItem(STATE_KEY, JSON.stringify(stored))
    } catch {
      // Storage blocked: setup still works for this session.
    }
  }, [stored])

  const addModel = useCallback((model: Omit<ModelConfig, 'id'>) => {
    const created: ModelConfig = { ...model, id: newId(), baseUrl: model.baseUrl.replace(/\/$/, '') }
    setStored((current) => ({
      ...current,
      models: [...current.models, created],
      activeId: current.activeId ?? created.id,
    }))
    return created
  }, [])

  const removeModel = useCallback((id: string) => {
    setStored((current) => {
      const models = current.models.filter((model) => model.id !== id)
      return { ...current, models, activeId: current.activeId === id ? (models[0]?.id ?? null) : current.activeId }
    })
  }, [])

  const setActive = useCallback((id: string) => {
    setStored((current) => (current.models.some((model) => model.id === id) ? { ...current, activeId: id } : current))
  }, [])

  const chooseDirectory = useCallback(async () => {
    setError('')
    const picker = (window as unknown as { showDirectoryPicker?: (options?: { mode?: string }) => Promise<{ name: string }> }).showDirectoryPicker
    if (!picker) {
      setError('This browser cannot grant a folder. Use a Chromium-based browser for the harness.')
      return
    }
    try {
      const handle = await picker({ mode: 'readwrite' })
      await putHandle(handle)
      setStored((current) => ({ ...current, directory: { name: handle.name } }))
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === 'AbortError') return
      setError(caught instanceof Error ? `Could not use that folder: ${caught.message}` : 'Could not use that folder.')
    }
  }, [])

  const forgetDirectory = useCallback(() => {
    void deleteHandle()
    setStored((current) => ({ ...current, directory: null }))
  }, [])

  const resetHarness = useCallback(() => {
    void deleteHandle()
    setStored(emptyStored)
    setError('')
  }, [])

  const value = useMemo<HarnessState>(() => {
    const active = stored.models.find((model) => model.id === stored.activeId) ?? null
    return {
      models: stored.models,
      active,
      directory: stored.directory,
      ready: Boolean(active && stored.directory),
      error,
      clearError: () => setError(''),
      addModel,
      removeModel,
      setActive,
      chooseDirectory,
      forgetDirectory,
      resetHarness,
    }
  }, [stored, error, addModel, removeModel, setActive, chooseDirectory, forgetDirectory, resetHarness])

  return <HarnessContext.Provider value={value}>{children}</HarnessContext.Provider>
}

export function useHarness(): HarnessState {
  const ctx = useContext(HarnessContext)
  if (!ctx) throw new Error('useHarness outside HarnessProvider')
  return ctx
}
