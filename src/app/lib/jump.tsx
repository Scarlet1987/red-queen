import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

// The quick-jump palette is opened from the header and from Cmd/Ctrl+K. It is
// the only navigation added for power users: the header keeps two links.
interface JumpState {
  open: boolean
  setOpen: (open: boolean) => void
}

const JumpContext = createContext<JumpState | null>(null)

export function JumpProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const value = useMemo(() => ({ open, setOpen }), [open])
  return <JumpContext.Provider value={value}>{children}</JumpContext.Provider>
}

export function useJump(): JumpState {
  const ctx = useContext(JumpContext)
  if (!ctx) throw new Error('useJump outside JumpProvider')
  return ctx
}
