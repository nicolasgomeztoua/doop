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

  it('reveals at 20% of assets without counting frame startup toward the threshold', () => {
    const frames = [{ id: 'a' }]
    expect(canvasLoadProgress(frames, { a: { total: 10, pending: 10 } })).toEqual({ value: 0, ready: false })
    expect(canvasLoadProgress(frames, { a: { total: 10, pending: 9 } })).toEqual({ value: 10, ready: false })
    expect(canvasLoadProgress(frames, { a: { total: 10, pending: 8 } })).toEqual({ value: 20, ready: true })
    expect(canvasLoadProgress(frames, { a: { total: 10, pending: 0 } })).toEqual({ value: 100, ready: true })
  })

  it('invalidates replaced HTML and ignores removed frames', () => {
    expect(canvasLoadProgress([{ id: 'a' }], { a: null }).ready).toBe(false)
    expect(canvasLoadProgress([], { a: { total: 4, pending: 4 } })).toEqual({ value: 100, ready: true })
  })
})
