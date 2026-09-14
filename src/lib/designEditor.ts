import { create } from 'zustand'
import type { Frame } from '../../shared/types'
import { api, ApiError } from './api'
import { useStore } from './store'
import { recordUpdate, trackSave } from './history'
import { editDesign, parseDesign, sourceElement, type DesignEdit } from './designDocument'

export interface ElementSelection {
  frameId: string
  selector: string
  identity: string
  fallback?: { selector: string; identity: string }
}
interface EditorState {
  /** Identity of the shared selection, used to reject stale positional selectors. */
  selection: ElementSelection | null
  busy: boolean
  error: string | null
  saved: boolean
  inlineFrameId: string | null
  unsavedHtml: Record<string, string>
}

export const useDesignEditor = create<EditorState>(() => ({
  selection: null,
  busy: false,
  error: null,
  saved: false,
  inlineFrameId: null,
  unsavedHtml: {},
}))

useStore.subscribe((state, before) => {
  const pick = state.selectedElement
  if (state.canvas?.id !== before.canvas?.id)
    useDesignEditor.setState({ selection: null, inlineFrameId: null, error: null, saved: false })
  if (state.canvas?.id !== before.canvas?.id || pick !== before.selectedElement) {
    const own = useDesignEditor.getState().selection
    const frame = pick && state.canvas?.frames.find((f) => f.id === pick.frameId)
    const el = frame && typeof DOMParser !== 'undefined' ? sourceElement(parseDesign(frame.html), pick!.selector) : null
    useDesignEditor.setState({
      selection:
        el && pick
          ? {
              ...pick,
              identity: el.outerHTML,
              ...(pick.frameId === own?.frameId && pick.selector === own.selector && el.outerHTML === own.identity
                ? { fallback: own.fallback }
                : {}),
            }
          : null,
      error: null,
      saved: false,
    })
  } else {
    const selection = useDesignEditor.getState().selection
    const frame = selection && state.canvas?.frames.find((f) => f.id === selection.frameId)
    if (frame && selection?.fallback && !sourceElement(parseDesign(frame.html), selection.selector)) {
      const el = sourceElement(parseDesign(frame.html), selection.fallback.selector)
      if (el && el.outerHTML === selection.fallback.identity) {
        const next = {
          frameId: frame.id,
          ...selection.fallback,
          fallback: { selector: selection.selector, identity: selection.identity },
        }
        useDesignEditor.setState({ selection: next })
        state.setSelectedElement({ frameId: frame.id, selector: next.selector })
      }
    }
  }
})

function anchored(selector: string) {
  return selector.startsWith('[data-doop-node=') || selector.startsWith('#')
}

/** An unanchored positional selector must never silently retarget after a remote edit. */
export function currentSourceElement(html: string, selection: ElementSelection) {
  const el = sourceElement(parseDesign(html), selection.selector)
  if (!el) return null
  if (!anchored(selection.selector) && el.outerHTML !== selection.identity) return null
  return el
}

export function commitDesignEdit(frameId: string, selector: string, edit: DesignEdit): Promise<void> {
  const frame = useStore.getState().canvas?.frames.find((f) => f.id === frameId)
  if (!frame) return Promise.resolve()
  const selected = useDesignEditor.getState().selection
  try {
    if (useDesignEditor.getState().inlineFrameId === frameId)
      throw new Error('Finish text editing before changing this layer.')
    if (
      selected?.frameId === frameId &&
      selected.selector === selector &&
      !currentSourceElement(frame.html, selected)
    ) {
      throw new Error('This layer changed. Select it again in Layers before editing.')
    }
    if (useStore.getState().streams[frameId])
      throw new Error('An agent is updating this frame. Try again when it finishes.')
    const result = editDesign(frame.html, selector, edit)
    if (result.html === frame.html) return Promise.resolve()
    const el = sourceElement(parseDesign(result.html), result.selector)
    const follows = useStore.getState().selectedId === frameId && (!selected || selected.selector === selector)
    if (follows && el) {
      useDesignEditor.setState({
        selection: {
          frameId,
          selector: result.selector,
          identity: el.outerHTML,
          fallback:
            selected && result.selector !== selected.selector
              ? { selector: selected.selector, identity: selected.identity }
              : selected?.fallback,
        },
      })
    }
    let accepted = false
    const pending = saveDesignPatch(frameId, { html: result.html }, () => {
      accepted = true
    })
    if (follows) useStore.getState().setSelectedElement({ frameId, selector: result.selector })
    return pending.then(() => {
      const current = useDesignEditor.getState().selection
      if (!accepted && follows && current?.frameId === frameId && current.selector === result.selector) {
        useDesignEditor.setState({ selection: selected })
        useStore.getState().setSelectedElement(selected ? { frameId, selector: selected.selector } : null)
      }
    })
  } catch (err) {
    useDesignEditor.setState({ error: err instanceof Error ? err.message : 'Could not edit this layer.' })
    return Promise.resolve()
  }
}

let saveQueue: Promise<void> = Promise.resolve()
let queuedWrites = 0

interface SaveBatch {
  confirmed: Frame
  pending: number
  blockedHtml: boolean
  error?: string
  latestHtml?: string
  optimisticHtml: Set<string>
}
const saveBatches = new Map<string, SaveBatch>()

export function dismissUnsavedHtml(frameId: string) {
  useDesignEditor.setState((state) => {
    const unsavedHtml = { ...state.unsavedHtml }
    delete unsavedHtml[frameId]
    return { unsavedHtml }
  })
}

/** One write at a time, optimistic local rendering, rollback on error, and a
 * compare-and-swap HTML precondition so remote work is never silently replaced. */
export function saveDesignPatch(frameId: string, patch: Partial<Frame>, onSuccess?: () => void): Promise<void> {
  const before = useStore.getState().canvas?.frames.find((f) => f.id === frameId)
  if (!before) return Promise.resolve()
  if (Object.entries(patch).every(([key, value]) => before[key as keyof Frame] === value)) return Promise.resolve()
  const key = `${before.canvasId}:${frameId}`
  const batch: SaveBatch = saveBatches.get(key) ?? {
    confirmed: before,
    pending: 0,
    blockedHtml: false,
    optimisticHtml: new Set<string>(),
  }
  saveBatches.set(key, batch)
  batch.pending++
  if (patch.html !== undefined) {
    batch.latestHtml = patch.html
    batch.optimisticHtml.add(patch.html)
  }
  useDesignEditor.setState({ busy: true, error: null, saved: false })
  queuedWrites++
  useStore.getState().patchFrameLocal(frameId, patch)
  const pending = saveQueue
    .then(async () => {
      // Resolve the precondition and undo baseline at dispatch, after earlier
      // writes have settled. Never use an earlier optimistic enqueue snapshot.
      const baseline = batch.confirmed
      let accepted = false
      let failure: unknown
      const currentHtml = useStore.getState().canvas?.frames.find((frame) => frame.id === frameId)?.html
      if (
        patch.html !== undefined &&
        currentHtml !== undefined &&
        currentHtml !== baseline.html &&
        !batch.optimisticHtml.has(currentHtml)
      ) {
        batch.blockedHtml = true
        batch.error =
          'This frame changed while an edit was queued. Recover your unsaved HTML and review the latest source.'
      }
      if (patch.html !== undefined && batch.blockedHtml) {
        failure = new Error(batch.error || 'An earlier save could not be confirmed. Recover your unsaved HTML below.')
      } else {
        try {
          const updated = await api.updateFrame(frameId, patch, patch.html !== undefined ? baseline.html : undefined)
          batch.confirmed = { ...baseline, ...patch, ...updated }
          accepted = true
        } catch (err) {
          failure = err
          try {
            const latest = await api.getCanvas(before.canvasId)
            const updated = latest.frames.find((frame) => frame.id === frameId)
            if (!updated) throw new Error('The frame no longer exists.', { cause: err })
            batch.confirmed = updated
            // A transport/server error can lose the response to a committed
            // write. An explicit client rejection (including 409) cannot.
            const rejected = err instanceof ApiError && err.status >= 400 && err.status < 500
            accepted = !rejected && Object.entries(patch).every(([key, value]) => updated[key as keyof Frame] === value)
            if (!accepted && updated.html !== baseline.html) batch.blockedHtml = true
          } catch {
            // Offline or deleted: retain the latest draft instead of guessing
            // a new base for dependent HTML and potentially replacing remote work.
            batch.blockedHtml = true
          }
        }
      }
      if (accepted) {
        if (useStore.getState().canvas?.id === before.canvasId) {
          recordUpdate(frameId, baseline, patch, false)
          onSuccess?.()
          if (!batch.blockedHtml) useDesignEditor.setState({ saved: true, error: null })
        }
        if (patch.html !== undefined && useDesignEditor.getState().unsavedHtml[frameId] === patch.html)
          dismissUnsavedHtml(frameId)
        return
      }
      const current = useStore.getState().canvas?.frames.find((f) => f.id === frameId)
      if (current) {
        const rollback = Object.fromEntries(
          Object.keys(patch)
            .filter(
              (key) =>
                current[key as keyof Frame] === patch[key as keyof Frame] ||
                (key === 'html' && batch.blockedHtml && batch.optimisticHtml.has(current.html)),
            )
            .map((key) => [key, batch.confirmed[key as keyof Frame]]),
        )
        useStore.getState().patchFrameLocal(frameId, rollback)
      }
      batch.error =
        failure instanceof ApiError && typeof failure.body.error === 'string'
          ? failure.body.error
          : failure instanceof Error
            ? failure.message
            : 'Could not save. Try again.'
      useDesignEditor.setState((state) => ({
        saved: false,
        error: useStore.getState().canvas?.id === before.canvasId ? batch.error : state.error,
        unsavedHtml:
          batch.latestHtml !== undefined ? { ...state.unsavedHtml, [frameId]: batch.latestHtml } : state.unsavedHtml,
      }))
    })
    .finally(() => {
      batch.pending--
      if (!batch.pending) saveBatches.delete(key)
      queuedWrites--
      useDesignEditor.setState({ busy: queuedWrites > 0 })
    })
  saveQueue = pending
  trackSave(pending)
  return pending
}

/** Exports wait for every edit queued before the request. */
export function waitForDesignSaves() {
  return saveQueue
}
