import { useMemo, useState } from 'react'
import type { Frame } from '../../../shared/types'
import { designSelector, layerName, parseDesign } from '../../lib/designDocument'
import { commitDesignEdit } from '../../lib/designEditor'
import { useStore } from '../../lib/store'
import { Button } from '../ui/button'
import { DesignInput } from './Controls'

export function LayerAssets({ frames, query }: { frames: Frame[]; query: string }) {
  const [url, setUrl] = useState('')
  const selected = useStore((s) => s.selectedElement)
  const frameId = useStore((s) => s.selectedId)
  const assets = useMemo(
    () =>
      frames
        .flatMap((frame) => {
          const doc = parseDesign(frame.html)
          return [...doc.querySelectorAll('img, svg')].map((el) => ({
            frameId: frame.id,
            selector: designSelector(el),
            name: layerName(el),
            src: el.tagName === 'IMG' ? el.getAttribute('src') : null,
          }))
        })
        .filter((asset) => asset.name.toLowerCase().includes(query.toLowerCase())),
    [frames, query],
  )
  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-3">
      <div className="mb-3 space-y-2">
        <DesignInput label="New image URL" value={url} onCommit={setUrl} />
        <Button
          size="sm"
          disabled={!frameId || !url}
          onClick={() => {
            if (frameId)
              void commitDesignEdit(frameId, selected?.frameId === frameId ? selected.selector : 'body', {
                type: 'insert',
                kind: 'image',
                src: url,
              })
          }}
        >
          Insert image
        </Button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        {assets.map((asset) => (
          <button
            key={`${asset.frameId}:${asset.selector}`}
            className="overflow-hidden rounded border border-line text-left"
            onClick={() => {
              useStore.getState().select(asset.frameId)
              useStore.getState().pickElement({ frameId: asset.frameId, selector: asset.selector })
            }}
          >
            {asset.src ? (
              <img src={asset.src} alt="" className="h-20 w-full object-contain" />
            ) : (
              <span className="grid h-20 place-items-center text-ink-faint">SVG</span>
            )}
            <span className="block truncate p-2 text-xs">{asset.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
