import type React from 'react'

export default function MarkdownRenderer({ content, compact }: { content: string; compact?: boolean }) {
  const lines = content.split('\n')
  const elements: React.ReactNode[] = []
  let i = 0
  let key = 0

  const textSize = compact ? 'text-[11px]' : 'text-sm'
  const headingSize = compact ? 'text-xs' : 'text-sm'
  const h1Size = compact ? 'text-sm' : 'text-lg'
  const codeSize = compact ? 'text-[10px]' : 'text-xs'
  const spacing = compact ? 'mb-1' : 'mb-2'
  const gapH = compact ? 'h-1' : 'h-2'

  while (i < lines.length) {
    const line = lines[i]

    // Code block
    if (line.startsWith('```')) {
      const codeLines: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        codeLines.push(lines[i])
        i++
      }
      i++ // skip closing ```
      elements.push(
        <pre
          key={key++}
          className={`${codeSize} text-text-primary font-mono bg-board-bg border border-board-border rounded px-3 py-2 overflow-x-auto ${spacing} max-h-96 overflow-y-auto`}
        >
          {codeLines.join('\n')}
        </pre>
      )
      continue
    }

    // H1
    if (line.startsWith('# ')) {
      elements.push(
        <h1 key={key++} className={`${h1Size} font-bold text-text-primary ${spacing}`}>
          {line.slice(2)}
        </h1>
      )
      i++
      continue
    }

    // H2
    if (line.startsWith('## ')) {
      elements.push(
        <h2 key={key++} className={`${headingSize} font-semibold text-text-secondary mt-2 ${spacing} uppercase tracking-wider`}>
          {line.slice(3)}
        </h2>
      )
      i++
      continue
    }

    // H3
    if (line.startsWith('### ')) {
      elements.push(
        <h3 key={key++} className={`${headingSize} font-medium text-text-secondary mt-1 ${spacing}`}>
          {line.slice(4)}
        </h3>
      )
      i++
      continue
    }

    // Checklist item
    if (line.startsWith('- [x] ') || line.startsWith('- [ ] ')) {
      const checked = line.startsWith('- [x] ')
      const text = line.slice(6)
      elements.push(
        <div key={key++} className={`flex items-start gap-2 ${textSize} text-text-secondary mb-0.5`}>
          <span className={`shrink-0 ${checked ? 'text-status-executing' : 'text-text-muted'}`}>
            {checked ? '[x]' : '[ ]'}
          </span>
          <span className={checked ? 'line-through text-text-muted' : ''}>{text}</span>
        </div>
      )
      i++
      continue
    }

    // Bullet list item
    if (line.startsWith('- ')) {
      elements.push(
        <div key={key++} className={`flex items-start gap-2 ${textSize} text-text-secondary mb-0.5`}>
          <span className="shrink-0 text-text-muted">&bull;</span>
          <span>{renderInline(line.slice(2))}</span>
        </div>
      )
      i++
      continue
    }

    // Bold metadata lines
    if (line.startsWith('**') && line.includes(':**')) {
      const match = line.match(/^\*\*(.+?):\*\*\s*(.*)$/)
      if (match) {
        const label = match[1]
        const value = match[2].replace(/\s+$/, '').replace(/\s{2}$/, '')
        const codeMatch = value.match(/^`(.+)`$/)
        elements.push(
          <div key={key++} className={`flex items-baseline gap-2 ${codeSize} mb-0.5`}>
            <span className="text-text-secondary shrink-0">{label}:</span>
            {codeMatch ? (
              <code className="text-text-primary font-mono bg-board-bg px-1 rounded break-all">
                {codeMatch[1]}
              </code>
            ) : (
              <span className="text-text-secondary break-all">{renderInline(value)}</span>
            )}
          </div>
        )
        i++
        continue
      }
    }

    // Empty line
    if (line.trim() === '') {
      elements.push(<div key={key++} className={gapH} />)
      i++
      continue
    }

    // Default paragraph
    elements.push(
      <p key={key++} className={`${textSize} text-text-primary mb-1 whitespace-pre-wrap`}>
        {renderInline(line)}
      </p>
    )
    i++
  }

  return <div>{elements}</div>
}

function renderInline(text: string): React.ReactNode {
  // Handle inline code and bold
  const parts: React.ReactNode[] = []
  let remaining = text
  let k = 0

  while (remaining.length > 0) {
    // Inline code
    const codeIdx = remaining.indexOf('`')
    const boldIdx = remaining.indexOf('**')

    if (codeIdx === -1 && boldIdx === -1) {
      parts.push(remaining)
      break
    }

    // Pick whichever comes first
    if (codeIdx !== -1 && (boldIdx === -1 || codeIdx < boldIdx)) {
      const endCode = remaining.indexOf('`', codeIdx + 1)
      if (endCode === -1) {
        parts.push(remaining)
        break
      }
      if (codeIdx > 0) parts.push(remaining.slice(0, codeIdx))
      parts.push(
        <code key={k++} className="font-mono bg-board-bg px-1 rounded text-text-primary">
          {remaining.slice(codeIdx + 1, endCode)}
        </code>
      )
      remaining = remaining.slice(endCode + 1)
    } else if (boldIdx !== -1) {
      const endBold = remaining.indexOf('**', boldIdx + 2)
      if (endBold === -1) {
        parts.push(remaining)
        break
      }
      if (boldIdx > 0) parts.push(remaining.slice(0, boldIdx))
      parts.push(
        <strong key={k++} className="font-semibold text-text-primary">
          {remaining.slice(boldIdx + 2, endBold)}
        </strong>
      )
      remaining = remaining.slice(endBold + 2)
    }
  }

  return parts.length === 1 && typeof parts[0] === 'string' ? parts[0] : <>{parts}</>
}
