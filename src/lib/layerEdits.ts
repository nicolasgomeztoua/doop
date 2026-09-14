import type { Frame } from '../../shared/types'
import { useStore } from './store'
import { commitDesignEdit, currentSourceElement, saveDesignPatch, useDesignEditor } from './designEditor'
import { parseDesign, sourceElement } from './designDocument'
import { moveElement, replaceElement, shiftElement, type DropTarget, type MovedElement } from './layers'

/** Source edits from either upstream panel share the same transaction path. */
export function canEditFrame(frame: Frame, selector?: string): boolean {
  const state = useStore.getState()
  const editor = useDesignEditor.getState()
  const live = state.canvas?.frames.find((f) => f.id === frame.id)
  let error: string | null = null
  if (!live || live.html !== frame.html) error = 'This frame changed. Review the latest design and try again.'
  else if (editor.inlineFrameId === frame.id) error = 'Finish text editing before changing this layer.'
  else if (state.streams[frame.id]) error = 'An agent is updating this frame. Try again when it finishes.'
  else if (selector) {
    const el = sourceElement(parseDesign(frame.html), selector)
    const picked = editor.selection
    if (
      !el ||
      (picked?.frameId === frame.id && picked.selector === selector && !currentSourceElement(frame.html, picked))
    )
      error = 'This layer changed. Select it again in Layers before editing.'
    else if (el.closest('[data-doop-locked]')) error = 'Unlock this layer or its parent first.'
  }
  if (error) useDesignEditor.setState({ error, saved: false })
  return !error
}

export function saveFrameHtml(frame: Frame, html: string): boolean {
  if (!canEditFrame(frame)) {
    useDesignEditor.setState((s) => ({ unsavedHtml: { ...s.unsavedHtml, [frame.id]: html } }))
    return false
  }
  void saveDesignPatch(frame.id, { html })
  const picked = useStore.getState().selectedElement
  if (picked?.frameId === frame.id) {
    useStore.getState().setSelectedElement(null)
    useStore.getState().pickElement(picked)
  }
  return true
}

export function deleteLayer(frame: Frame, selector: string) {
  if (canEditFrame(frame, selector)) void commitDesignEdit(frame.id, selector, { type: 'delete' })
}

export function duplicateLayer(frame: Frame, selector: string) {
  if (canEditFrame(frame, selector)) void commitDesignEdit(frame.id, selector, { type: 'duplicate' })
}

export function replaceLayerHtml(frame: Frame, selector: string, outerHtml: string): boolean {
  const html = replaceElement(frame.html, selector, outerHtml)
  if (html === null) return false
  if (!canEditFrame(frame, selector)) {
    useDesignEditor.setState((s) => ({ unsavedHtml: { ...s.unsavedHtml, [frame.id]: html } }))
    return false
  }
  return saveFrameHtml(frame, html)
}

function commitMove(frame: Frame, moved: MovedElement | null): boolean {
  if (!moved || !saveFrameHtml(frame, moved.html)) return false
  useStore.getState().select(frame.id)
  useStore.getState().setSelectedElement({ frameId: frame.id, selector: moved.selector })
  return true
}

export function moveLayer(frame: Frame, selector: string, target: DropTarget): boolean {
  return canEditFrame(frame, selector) && commitMove(frame, moveElement(frame.html, selector, target))
}

export function shiftLayer(frame: Frame, selector: string, dir: -1 | 1): boolean {
  return canEditFrame(frame, selector) && commitMove(frame, shiftElement(frame.html, selector, dir))
}
