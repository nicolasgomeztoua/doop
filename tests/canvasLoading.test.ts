import { describe, expect, it } from 'vitest'
import { canvasLoadProgress } from '../src/lib/canvasLoading'

describe('canvas loading progress', () => {
  it('waits for canvas data and handles an empty canvas', () => {
    expect(canvasLoadProgress(null, {})).toEqual({ value: 0, ready: false })
    expect(canvasLoadProgress([], {})).toEqual({ value: 100, ready: true })
  })

  it('requires a first render report from every frame, even those without assets', () => {
    const frames = [{ id: 'a' }, { id: 'b' }]
    expect(canvasLoadProgress(frames, { a: { total: 0, pending: 0 } }).ready).toBe(false)
    expect(canvasLoadProgress(frames, { a: { total: 0, pending: 0 }, b: { total: 0, pending: 0 } })).toEqual({
      value: 100,
      ready: true,
    })
  })

  it('advances with completed assets and waits for the last outstanding resource', () => {
    const frames = [{ id: 'a' }]
    expect(canvasLoadProgress(frames, { a: { total: 8, pending: 3 } })).toEqual({ value: 70, ready: false })
    expect(canvasLoadProgress(frames, { a: { total: 8, pending: 1 } })).toEqual({ value: 90, ready: false })
    expect(canvasLoadProgress(frames, { a: { total: 8, pending: 0 } })).toEqual({ value: 100, ready: true })
  })

  it('invalidates replaced HTML and ignores removed frames', () => {
    expect(canvasLoadProgress([{ id: 'a' }], { a: null }).ready).toBe(false)
    expect(canvasLoadProgress([], { a: { total: 4, pending: 4 } })).toEqual({ value: 100, ready: true })
  })
})
