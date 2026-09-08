import { createContext, useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { canvasLoadProgress, type AssetProgress } from '../lib/canvasLoading'
import { Logo } from './Logo'
import { Progress } from './ui/progress'

export const CanvasAssetProgress = createContext<((frameId: string, progress: AssetProgress | null) => void) | null>(
  null,
)

export function CanvasLoadingScreen({
  frames,
  children,
}: {
  frames: readonly { id: string }[] | null
  children: ReactNode
}) {
  const [reports, setReports] = useState<Record<string, AssetProgress | null>>({})
  const [revealed, setRevealed] = useState(false)
  const [progress, setProgress] = useState(0)
  const content = useRef<HTMLDivElement>(null)
  const finished = useRef(false)
  const report = useCallback((frameId: string, next: AssetProgress | null) => {
    if (finished.current) return
    setReports((previous) => {
      const current = previous[frameId]
      if (current?.pending === next?.pending && current?.total === next?.total) return previous
      return { ...previous, [frameId]: next }
    })
  }, [])
  const { value, ready } = canvasLoadProgress(frames, reports)
  // New styles can discover more assets. Keep the bar moving forward.
  const nextProgress = Math.max(progress, value)
  if (nextProgress !== progress) setProgress(nextProgress)

  useLayoutEffect(() => {
    content.current?.toggleAttribute('inert', !revealed)
  }, [revealed])

  useEffect(() => {
    if (revealed) return
    // Inert prevents focus; the capture listener also pauses canvas hotkeys.
    const blockShortcuts = (event: Event) => event.stopImmediatePropagation()
    window.addEventListener('keydown', blockShortcuts, true)
    window.addEventListener('paste', blockShortcuts, true)
    return () => {
      window.removeEventListener('keydown', blockShortcuts, true)
      window.removeEventListener('paste', blockShortcuts, true)
    }
  }, [revealed])

  useEffect(() => {
    if (revealed || !ready) return
    finished.current = true
    setRevealed(true)
  }, [ready, revealed])

  return (
    <CanvasAssetProgress.Provider value={report}>
      {/* Keep layout and resource loading active behind the opaque screen. */}
      <div ref={content} aria-hidden={!revealed || undefined}>
        {children}
      </div>
      {!revealed && (
        <div data-testid="canvas-loading-screen" className="fixed inset-0 z-[100] grid place-items-center bg-surface">
          <div className="flex -translate-y-4 flex-col items-center gap-8">
            <Logo className="size-16" />
            <Progress
              value={progress}
              aria-label="Loading canvas"
              className="h-[3px] w-40 bg-line-soft [&_[data-slot=progress-indicator]]:bg-ink motion-reduce:[&_[data-slot=progress-indicator]]:transition-none"
            />
          </div>
        </div>
      )}
    </CanvasAssetProgress.Provider>
  )
}
