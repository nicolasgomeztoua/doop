import { useDesignEditor, dismissUnsavedHtml } from '../../lib/designEditor'
import { Button } from '../ui/button'

export function SaveStatus({ frameId }: { frameId: string }) {
  const { busy, error, saved, unsavedHtml } = useDesignEditor()
  const draft = unsavedHtml[frameId]
  if (!busy && !error && !saved && draft === undefined) return null
  return (
    <div className="space-y-2 border-t border-line-soft px-3 py-2 text-xs">
      <span role="status" className="text-ink-faint">
        {busy ? 'Saving…' : saved ? 'Saved ✓' : ''}
      </span>
      {error && (
        <p role="alert" className="text-red-700">
          {error}
        </p>
      )}
      {draft !== undefined && (
        <details>
          <summary className="cursor-pointer font-semibold">Recover unsaved HTML</summary>
          <textarea aria-label="Unsaved HTML" readOnly value={draft} className="mt-2 h-28 w-full font-mono text-xs" />
          <Button size="sm" variant="ghost" onClick={() => dismissUnsavedHtml(frameId)}>
            Dismiss draft
          </Button>
        </details>
      )}
    </div>
  )
}
