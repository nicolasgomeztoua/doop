import { useState } from 'react'
import type { Frame } from '../../shared/types'
import { useStore } from '../lib/store'
import { api } from '../lib/api'
import { deleteFrameTracked } from '../lib/history'
import { cn } from '@/lib/utils'
import { Panel, PanelClose, PanelDisclosure, PanelHeader } from './ui/panel'
import { Collapsible, CollapsibleContent } from './ui/collapsible'
import { Button } from './ui/button'
import { Input } from './ui/input'
import { Field } from './ui/field'
import { SourceHtmlEditor } from './design/SourceHtmlEditor'
import { SaveStatus } from './design/SaveStatus'
import { saveDesignPatch } from '../lib/designEditor'
import { openSelectionExport, useExportSelectionReady } from '../lib/exportSelection'

const HTML_OPEN_KEY = 'doop:inspector-html'

/* the export row's buttons: the standard button, tightened, and tall enough
   to hit on a phone */
const exportBtn = 'px-[11px] py-[5px] text-xs no-underline max-md:min-h-9'

export function Inspector({
  frame,
  surface = 'floating',
  className,
}: {
  frame: Frame
  /* 'inline' when the inspector is filling a mobile Sheet */
  surface?: 'floating' | 'inline'
  className?: string
}) {
  const select = useStore((s) => s.select)
  /* the raw HTML editor is a power tool — collapsed by default so the panel
     reads as frame properties, not a code dump; the choice sticks */
  const [showHtml, setShowHtml] = useState(() => localStorage.getItem(HTML_OPEN_KEY) === '1')
  const [copiedUrl, setCopiedUrl] = useState(false)
  const exportReady = useExportSelectionReady()
  function commitMeta(patch: Partial<Frame>) {
    void saveDesignPatch(frame.id, patch)
  }

  return (
    <Panel
      surface={surface}
      className={cn(
        surface === 'floating' && 'right-3 top-3 max-h-[calc(100%-24px)] w-[340px] transition-[right] duration-150',
        'max-md:overflow-y-auto max-md:overscroll-contain',
        className,
      )}
    >
      <PanelHeader>
        Frame
        <PanelClose onClick={() => select(null)} />
      </PanelHeader>
      <div className="grid grid-cols-2 gap-2.5 border-b border-line-soft px-4 py-3.5">
        <Field label="Name" className="col-span-full">
          <NumberlessInput
            key={frame.id}
            value={frame.name}
            onCommit={(v) => v.trim() && commitMeta({ name: v.trim() })}
          />
        </Field>
        <Field label="X">
          <NumInput value={frame.x} onCommit={(v) => commitMeta({ x: v })} />
        </Field>
        <Field label="Y">
          <NumInput value={frame.y} onCommit={(v) => commitMeta({ y: v })} />
        </Field>
        <Field label="Width">
          <NumInput value={frame.width} onCommit={(v) => commitMeta({ width: Math.max(120, v) })} />
        </Field>
        <Field label="Height">
          <NumInput value={frame.height} onCommit={(v) => commitMeta({ height: Math.max(80, v) })} />
        </Field>
      </div>
      <div className="flex flex-wrap items-center gap-2 border-b border-line-soft px-3.5 py-2.5">
        <span className="mr-0.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-ink-faint">Export</span>
        <Button className={exportBtn} disabled={!exportReady} onClick={() => void openSelectionExport(frame.id)}>
          Export…
        </Button>
        <Button
          className={exportBtn}
          title="Add to design memory — will be used as reference"
          onClick={() => api.pinReference(frame.canvasId, frame.id).catch(console.error)}
        >
          ☆ Pin
        </Button>
        <Button
          className={exportBtn}
          title="Public image URL — always renders the current design; paste it as og:image or a blog featured image"
          onClick={() => {
            navigator.clipboard.writeText(`${location.origin}/i/${frame.id}.png?scale=2`).then(() => {
              setCopiedUrl(true)
              window.setTimeout(() => setCopiedUrl(false), 1500)
            }, console.error)
          }}
        >
          {copiedUrl ? '✓ copied' : 'Copy image URL'}
        </Button>
      </div>
      <Collapsible
        className="flex min-h-0 flex-col"
        open={showHtml}
        onOpenChange={(next) => {
          setShowHtml(next)
          localStorage.setItem(HTML_OPEN_KEY, next ? '1' : '0')
        }}
      >
        <PanelDisclosure>
          <span>{'</>'} HTML</span>
        </PanelDisclosure>
        <CollapsibleContent className="flex min-h-0 flex-col">
          <SourceHtmlEditor key={frame.id} frame={frame} />
        </CollapsibleContent>
      </Collapsible>
      <SaveStatus frameId={frame.id} />
      <footer className="flex items-center justify-end border-t border-line-soft px-4 py-2.5">
        <Button variant="bare-danger" size="sm" onClick={() => deleteFrameTracked(frame)}>
          Delete frame
        </Button>
      </footer>
    </Panel>
  )
}

function NumberlessInput({ value, onCommit }: { value: string; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  /* a committed or remote value replaces whatever was being typed */
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(value)
  }
  return (
    <Input
      variant="mono"
      inputSize="sm"
      className="font-sans font-semibold max-md:min-h-10"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => draft !== value && onCommit(draft)}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}

function NumInput({ value, onCommit }: { value: number; onCommit: (v: number) => void }) {
  const [draft, setDraft] = useState(String(value))
  const [seen, setSeen] = useState(value)
  if (seen !== value) {
    setSeen(value)
    setDraft(String(value))
  }
  return (
    <Input
      variant="mono"
      inputSize="sm"
      className="max-md:min-h-10"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const n = Math.round(Number(draft))
        if (!Number.isNaN(n) && n !== value) onCommit(n)
        else setDraft(String(value))
      }}
      onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
    />
  )
}
