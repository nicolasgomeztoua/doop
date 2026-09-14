import { useEffect, useMemo, useRef, useState } from 'react'
import type { Frame } from '../../../shared/types'
import { elementHtml } from '../../lib/layers'
import { replaceLayerHtml, saveFrameHtml } from '../../lib/layerEdits'
import { useStore } from '../../lib/store'
import { Textarea } from '../ui/textarea'

/** Preserve a typing session's source and flush its last edit when changing panels. */
export function SourceHtmlEditor({ frame, selector }: { frame: Frame; selector?: string }) {
  const source = useMemo(
    () => (selector ? (elementHtml(frame.html, selector) ?? '') : frame.html),
    [frame.html, selector],
  )
  const [draft, setDraft] = useState(source)
  const [focused, setFocused] = useState(false)
  const baseline = useRef(frame)
  const pending = useRef<{ timer: number; run(): void } | null>(null)
  useEffect(
    () => () => {
      if (pending.current) {
        window.clearTimeout(pending.current.timer)
        pending.current.run()
      }
    },
    [],
  )
  const [seen, setSeen] = useState(source)
  if (source !== seen) {
    setSeen(source)
    if (!focused) setDraft(source)
  }
  return (
    <Textarea
      aria-label={selector ? 'Element HTML' : 'Frame HTML'}
      variant="bare"
      className="min-h-[240px] flex-1 bg-[#17171b] p-3 font-mono text-[11.5px] leading-[1.55] text-[#e9e9ee] [tab-size:2] md:text-[11.5px]"
      value={draft}
      spellCheck={false}
      onFocus={() => {
        setFocused(true)
        baseline.current = frame
      }}
      onBlur={() => {
        setFocused(false)
        if (pending.current) {
          window.clearTimeout(pending.current.timer)
          pending.current.run()
        }
      }}
      onChange={(e) => {
        const value = e.target.value
        setDraft(value)
        if (pending.current) window.clearTimeout(pending.current.timer)
        const run = () => {
          pending.current = null
          const ok = selector
            ? replaceLayerHtml(baseline.current, selector, value)
            : saveFrameHtml(baseline.current, value)
          if (ok)
            baseline.current = useStore.getState().canvas?.frames.find((f) => f.id === frame.id) ?? baseline.current
        }
        pending.current = { timer: window.setTimeout(run, 700), run }
      }}
    />
  )
}
