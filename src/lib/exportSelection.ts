import { useDesignEditor, waitForDesignSaves } from './designEditor'
import { inspectElement } from './frameBridge'
import { useStore } from './store'
import { layerName, parseDesign, sourceElement } from './designDocument'

export function useExportSelectionReady() {
  const busy = useDesignEditor((s) => s.busy || !!s.inlineFrameId)
  const ids = useStore((s) => s.selectedIds)
  return !busy && ids.length > 0
}

/** Measure on demand against the same saved source that the renderer exports. */
export async function openSelectionExport(frameId?: string) {
  await waitForDesignSaves()
  const state = useStore.getState()
  const picked = frameId ? null : state.selectedElement
  if (!picked || state.selectedIds.length !== 1) {
    state.openExport(frameId)
    return
  }
  const frame = state.canvas?.frames.find((f) => f.id === picked.frameId)
  if (!frame) return
  const info = await inspectElement(frame.id, picked.selector, frame.html)
  const now = useStore.getState()
  if (now.selectedElement !== picked || now.canvas?.frames.find((f) => f.id === frame.id)?.html !== frame.html) return
  if (!info) {
    useDesignEditor.setState({ error: 'The selected element is not ready to export. Select it again and retry.' })
    return
  }
  const el = sourceElement(parseDesign(frame.html), picked.selector)
  now.openElementExport(frame.id, { rect: info.rect, label: el ? layerName(el) : info.tag })
}
