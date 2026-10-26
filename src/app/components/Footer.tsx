import { Link } from 'react-router'

import { RELEASE_TAG, RELEASE_VERSION, releaseLabel } from '../lib/release'
import { Container } from './ui'
import { Logo } from './Nav'

const columns = [
  {
    title: 'Harness',
    links: [
      ['Setup', '/'],
      ['Workbench', '/workbench'],
      ['Programming bible · COS-G', '/cosg'],
      ['COS-G worksheet', '/cosg/worksheet'],
    ],
  },
  {
    title: 'Directory',
    links: [
      ['All tools', '/directory'],
      ['Static only', '/directory?safety=static'],
      ['Sandboxed runs', '/directory?safety=sandbox'],
      ['Live attach', '/directory?safety=live'],
      ['Your rack', '/rack'],
    ],
  },
  {
    title: 'Safety',
    links: [
      ['The three levels', '/safety#levels'],
      ['Legal scope', '/safety#scope'],
      ['How entries are checked', '/safety#vetting'],
      ['Corrections', '/safety#corrections'],
    ],
  },
  {
    title: 'Project',
    links: [
      ['About the directory', '/safety#about'],
      ['Export your rack', '/rack'],
      ['Contribute an entry', '/safety#contributing'],
    ],
  },
]

export function Footer() {
  return (
    <footer className="mt-24 border-t border-line">
      <Container className="py-14">
        <div className="grid gap-10 sm:grid-cols-2 lg:grid-cols-[1.4fr_repeat(3,1fr)]">
          <div className="max-w-xs">
            <Logo />
            <p className="mt-4 text-[14px] leading-relaxed text-muted">One model, one directory, one workbench. The tool directory sits beside it.</p>
          </div>
          {columns.map((col) => (
            <div key={col.title}>
              <p className="text-[13px] font-medium">{col.title}</p>
              <ul className="mt-4 flex flex-col gap-2.5">
                {col.links.map(([label, to]) => (
                  <li key={label}>
                    <Link to={to} className="text-[14px] text-muted transition-colors hover:text-fg">
                      {label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-16 flex flex-col-reverse items-start justify-between gap-4 border-t border-line pt-6 sm:flex-row sm:items-center">
          <div className="flex flex-col gap-2">
            <p className="text-[13px] text-faint">© {new Date().getFullYear()} Red Queen. Nothing here executes your files.</p>
            {/* The running copy names its own release: the version from
                package.json and the tag the bytes were built from, both baked
                in at build time. The title says it in words for a reader who
                cannot see the dot. */}
            <p className="text-[12.5px] text-faint" title={`Version ${RELEASE_VERSION || 'unknown'}${RELEASE_TAG ? `, release ${RELEASE_TAG}` : ', no release tag'}`}>
              Version <span className="font-mono tabular-nums text-muted">{releaseLabel()}</span>
            </p>
          </div>
          <Logo className="text-muted" />
        </div>
      </Container>
    </footer>
  )
}
