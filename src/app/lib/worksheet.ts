import { useCallback, useEffect, useState } from 'react'

import { cleanWorksheets, newId, type CosgLetter, type Worksheet, type WorksheetOutcome } from './validate.ts'

export type { CosgLetter, Worksheet, WorksheetOutcome }

export type WorksheetDraft = Omit<Worksheet, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

export const letterNames: Record<CosgLetter, string> = {
  C: 'Crash risks',
  O: 'Orphaned strings, directories and programs',
  S: 'Syntax errors',
  G: 'Ghosts',
}

export const outcomeLabels: Record<WorksheetOutcome, string> = {
  open: 'In progress',
  implemented: 'Implemented',
  retry: 'Back through the cycle',
}

const KEY = 'red-queen-cosg-worksheets'
const LETTERS: CosgLetter[] = ['C', 'O', 'S', 'G']

export const emptyDraft = (): WorksheetDraft => ({
  letter: 'C',
  title: '',
  definition: '',
  action: '',
  test: '',
  outcome: 'open',
  notes: '',
})

export function useWorksheets() {
  const [items, setItems] = useState<Worksheet[]>(() => {
    try {
      return cleanWorksheets(JSON.parse(localStorage.getItem(KEY) ?? '[]'))
    } catch {
      return []
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(items))
    } catch {
      // Storage full or blocked: the worksheet still works for this session.
    }
  }, [items])

  const save = useCallback((draft: WorksheetDraft) => {
    const now = new Date().toISOString()
    setItems((previous) => {
      if (draft.id) {
        return previous.map((item) =>
          item.id === draft.id ? { ...item, ...draft, id: item.id, createdAt: item.createdAt, updatedAt: now } : item,
        )
      }
      return [{ ...draft, id: newId(), createdAt: now, updatedAt: now }, ...previous]
    })
  }, [])

  const remove = useCallback((id: string) => {
    setItems((previous) => previous.filter((item) => item.id !== id))
  }, [])

  const clear = useCallback(() => setItems([]), [])

  return { items: [...items].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), save, remove, clear }
}

const cleanLine = (text: string) => text.replace(/\s*\n+\s*/g, ' ').trim()

export function worksheetsMarkdown(items: Worksheet[]): string {
  const lines = [
    '# COS-G worksheet',
    '',
    `${items.length} finding${items.length === 1 ? '' : 's'} worked through the C / O / S / G loop. Companion to cosg-report.md.`,
    '',
  ]

  if (items.length === 0) {
    lines.push('_No worksheets saved yet._', '')
    return lines.join('\n')
  }

  for (const letter of LETTERS) {
    const group = items.filter((item) => item.letter === letter)
    if (group.length === 0) continue
    lines.push(`## ${letter} — ${letterNames[letter]}`, '')
    for (const item of group) {
      lines.push(`### ${cleanLine(item.title)}`, '')
      if (item.definition) lines.push(`- **Defined:** ${cleanLine(item.definition)}`)
      if (item.action) lines.push(`- **Course of action:** ${cleanLine(item.action)}`)
      if (item.test) lines.push(`- **Tested:** ${cleanLine(item.test)}`)
      lines.push(`- **Outcome:** ${outcomeLabels[item.outcome]}`)
      if (item.notes) lines.push(`- **Notes:** ${cleanLine(item.notes)}`)
      lines.push(`- **Updated:** ${new Date(item.updatedAt).toISOString().slice(0, 10)}`)
      lines.push('')
    }
  }

  lines.push('---', '', '_Saved in Red Queen, in this browser. Read-only: nothing here executed a sample._', '')
  return lines.join('\n')
}
