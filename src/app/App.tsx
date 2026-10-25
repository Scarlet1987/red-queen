import { AnimatePresence, motion } from 'motion/react'
import { useEffect } from 'react'
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router'

import { Footer } from './components/Footer'
import { Nav } from './components/Nav'
import { QuickJump } from './components/QuickJump'
import { Sidebar } from './components/Sidebar'
import { HarnessProvider } from './lib/harness'
import { JumpProvider } from './lib/jump'
import { RackProvider } from './lib/rack'
import { RefineProvider } from './lib/refine'
import { Bible } from './pages/Bible'
import { Cosg } from './pages/Cosg'
import { Worksheet } from './pages/Worksheet'
import { Directory } from './pages/Directory'
import { Harness } from './pages/Harness'
import { Rack } from './pages/Rack'
import { Safety } from './pages/Safety'
import { ToolPage } from './pages/Tool'
import { Workbench } from './pages/Workbench'

function ScrollToTop() {
  const { pathname, hash } = useLocation()
  useEffect(() => {
    if (hash) {
      const target = document.getElementById(hash.slice(1))
      if (target) {
        target.scrollIntoView()
        return
      }
    }
    window.scrollTo({ top: 0 })
  }, [pathname, hash])
  return null
}

function Pages() {
  const location = useLocation()
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.main
        key={location.pathname}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -6 }}
        transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
        className="min-h-[70vh]"
      >
        <Routes location={location}>
          <Route index element={<Harness />} />
          <Route path="workbench" element={<Workbench />} />
          <Route path="directory" element={<Directory />} />
          <Route path="tool/:slug" element={<ToolPage />} />
          <Route path="rack" element={<Rack />} />
          <Route path="safety" element={<Safety />} />
          <Route path="cosg" element={<Cosg />} />
          <Route path="cosg/bible" element={<Bible />} />
          <Route path="cosg/worksheet" element={<Worksheet />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </motion.main>
    </AnimatePresence>
  )
}

export function App() {
  return (
    <BrowserRouter>
      <HarnessProvider>
        <RackProvider>
          <RefineProvider>
            <JumpProvider>
              <ScrollToTop />
              <Nav />
              <div className="mx-auto w-full max-w-[1440px] xl:grid xl:grid-cols-[216px_minmax(0,1fr)]">
                <Sidebar />
                <div className="min-w-0">
                  <Pages />
                  <Footer />
                </div>
              </div>
              <QuickJump />
            </JumpProvider>
          </RefineProvider>
        </RackProvider>
      </HarnessProvider>
    </BrowserRouter>
  )
}
