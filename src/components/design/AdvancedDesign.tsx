import { useMemo, useState } from 'react'
import type { Frame } from '../../../shared/types'
import type { ElementInfo } from '../../lib/frameBridge'
import { DESIGN_SECTIONS, DESIGN_PROPERTIES } from '../../lib/designProperties'
import { commitDesignEdit } from '../../lib/designEditor'
import { layerName, parseDesign, sourceElement } from '../../lib/designDocument'
import { DesignInput, DesignSection, PropertyField } from './Controls'
import { PaintStack } from './PaintStack'

/* Everyday controls belong to upstream's Design tab. These are the additional
   properties that still matter when refining an agent-generated design. */
const BASIC = new Set([
  'position',
  'width',
  'height',
  'min-width',
  'display',
  'flex-direction',
  'gap',
  'padding',
  'opacity',
  'visibility',
  'background-color',
  'border-color',
  'border-width',
  'border-radius',
  'font-size',
  'font-weight',
  'color',
  'text-align',
])

export function AdvancedDesign({ frame, selector, info }: { frame: Frame; selector: string; info: ElementInfo }) {
  const element = useMemo(() => sourceElement(parseDesign(frame.html), selector), [frame.html, selector])
  const [query, setQuery] = useState('')
  if (!element) return null
  const commit = (property: string, value: string) =>
    void commitDesignEdit(frame.id, selector, { type: 'style', values: { [property]: value } })
  const style = (key: string) => element.style.getPropertyValue(key) || info.styles[key] || ''
  const field = (item: (typeof DESIGN_PROPERTIES)[number]) => (
    <PropertyField
      key={item.key}
      field={item}
      authored={element.style.getPropertyValue(item.key)}
      computed={info.styles[item.key] || ''}
      onCommit={commit}
    />
  )
  return (
    <details className="border-t border-line-soft">
      <summary className="cursor-pointer px-3 py-3 text-xs font-semibold">Advanced design</summary>
      <div className="px-3 pb-2">
        <DesignInput label="Find property" value={query} placeholder="Search CSS properties…" onCommit={setQuery} />
      </div>
      {query ? (
        <div className="grid grid-cols-2 gap-2 p-3">
          {DESIGN_PROPERTIES.filter((f) => `${f.key} ${f.label}`.toLowerCase().includes(query.toLowerCase())).map(
            field,
          )}
        </div>
      ) : (
        <>
          <DesignSection id="layer" title="Layer" defaultOpen>
            <div className="col-span-2">
              <label className="text-xs">Name</label>
              <DesignInput
                label="Layer name"
                value={layerName(element)}
                onCommit={(name) => void commitDesignEdit(frame.id, selector, { type: 'rename', name })}
              />
            </div>
            {!element.children.length && !!element.textContent && (
              <div className="col-span-2">
                <DesignInput
                  label="Text content"
                  multiline
                  value={element.textContent}
                  onCommit={(text) => void commitDesignEdit(frame.id, selector, { type: 'text', text })}
                />
              </div>
            )}
            {element.tagName === 'IMG' && (
              <div className="col-span-2 space-y-2">
                <DesignInput
                  label="Image source"
                  value={element.getAttribute('src') || ''}
                  onCommit={(src) => void commitDesignEdit(frame.id, selector, { type: 'image', src })}
                />
                <DesignInput
                  label="Image alt text"
                  value={element.getAttribute('alt') || ''}
                  onCommit={(alt) =>
                    void commitDesignEdit(frame.id, selector, {
                      type: 'image',
                      src: element.getAttribute('src') || '',
                      alt,
                    })
                  }
                />
              </div>
            )}
          </DesignSection>
          {DESIGN_SECTIONS.map((section) => (
            <DesignSection key={section.id} id={`extra-${section.id}`} title={section.label}>
              {section.id === 'fill' && (
                <PaintStack
                  kind="fill"
                  value={style('background-image')}
                  onCommit={(v) => commit('background-image', v)}
                />
              )}
              {section.id === 'effects' && (
                <PaintStack kind="shadow" value={style('box-shadow')} onCommit={(v) => commit('box-shadow', v)} />
              )}
              {section.fields.filter((f) => !BASIC.has(f.key)).map(field)}
            </DesignSection>
          ))}
          <DesignSection id="transforms" title="Transforms">
            {DESIGN_PROPERTIES.filter((f) => ['transform', 'clip-path'].includes(f.key)).map(field)}
          </DesignSection>
        </>
      )}
    </details>
  )
}
