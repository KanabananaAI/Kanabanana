/**
 * LM Studio Agent — Lightweight interactive CLI that talks directly to
 * LM Studio's OpenAI-compatible API at localhost:1234.
 * Spawned as a PTY process by Kanaban server.
 */

const LMS_BASE = process.env.LMSTUDIO_BASE_URL || process.env.OPENAI_API_BASE || 'http://localhost:1234/v1'

// Parse --model from argv
function getModel(): string {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--model' && args[i + 1]) {
      let m = args[i + 1]
      // Strip prefixes added by resolveLmStudioModel
      if (m.startsWith('openai/')) m = m.slice(7)
      if (m.startsWith('lmstudio:')) m = m.slice(9)
      return m
    }
  }
  return ''
}

interface Message {
  role: 'system' | 'user' | 'assistant'
  content: string
}

const model = getModel()
const chatHistory: Message[] = [
  {
    role: 'system',
    content:
      'You are a helpful coding assistant working on a software project. ' +
      'Complete tasks thoroughly, show relevant file paths and code changes. ' +
      'Be concise but thorough.',
  },
]

// ANSI helpers
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

function write(text: string) {
  process.stdout.write(text)
}

async function checkConnection(): Promise<boolean> {
  try {
    const res = await fetch(`${LMS_BASE}/models`, { signal: AbortSignal.timeout(5000) })
    if (!res.ok) {
      write(red(`\nLM Studio server responded with ${res.status}\n`))
      write(dim(`URL: ${LMS_BASE}/models\n`))
      return false
    }
    const data = await res.json() as { data?: { id: string }[] }
    const models = data?.data || []
    if (models.length === 0) {
      write(red('\nLM Studio is running but no models are loaded.\n'))
      write(dim('Load a model in LM Studio before using this agent.\n'))
      return false
    }
    if (model && !models.some((m: { id: string }) => m.id === model)) {
      write(dim(`Note: Model "${model}" not found in loaded models. LM Studio may auto-select.\n`))
      write(dim(`Available: ${models.map((m: { id: string }) => m.id).join(', ')}\n`))
    }
    return true
  } catch (err: any) {
    write(red(`\nCannot connect to LM Studio at ${LMS_BASE}\n`))
    write(red(`Error: ${err.message}\n`))
    write(dim('\nTroubleshooting:\n'))
    write(dim('  1. Open LM Studio and start the local server\n'))
    write(dim('  2. Make sure a model is loaded\n'))
    write(dim('  3. Check that the server is running on port 1234\n'))
    write(dim(`  4. Test with: curl ${LMS_BASE}/models\n\n`))
    return false
  }
}

async function streamChat(userMsg: string): Promise<string> {
  chatHistory.push({ role: 'user', content: userMsg })

  const payload: Record<string, unknown> = { messages: chatHistory, stream: true }
  if (model) payload.model = model

  let res: Response
  try {
    res = await fetch(`${LMS_BASE}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (err: any) {
    write(red(`\nError: Cannot connect to LM Studio at ${LMS_BASE} — ${err.message}\n`))
    write(dim('Make sure LM Studio is running with a model loaded.\n'))
    chatHistory.pop()
    return ''
  }

  if (!res.ok) {
    const body = await res.text().catch(() => '')
    write(red(`\nLM Studio API error (${res.status}): ${body}\n`))
    chatHistory.pop()
    return ''
  }

  const reader = res.body?.getReader()
  if (!reader) {
    write(red('\nNo response body from LM Studio\n'))
    chatHistory.pop()
    return ''
  }

  write('\n')
  const decoder = new TextDecoder()
  let full = ''
  const t0 = Date.now()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    const chunk = decoder.decode(value, { stream: true })
    for (const line of chunk.split('\n')) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') continue
      try {
        const j = JSON.parse(data)
        const token = j.choices?.[0]?.delta?.content
        if (token) {
          write(token)
          full += token
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1)
  const words = full.split(/\s+/).filter(Boolean).length
  write(`\n\n${dim(`[${elapsed}s · ~${words} words]`)}\n\n`)

  if (full) chatHistory.push({ role: 'assistant', content: full })
  return full
}

// --- Main ---

async function main() {
  // Suppress PTY echo — prevents injected prompts (which contain KANABAN_TASK_COMPLETE)
  // from being echoed to the output buffer and triggering false-positive completion detection.
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true)
  }

  write('\n')
  write(bold('LM Studio Agent') + '\n')
  write(dim(`Model: ${model || '(auto)'} · ${LMS_BASE}`) + '\n')

  // Verify connection before accepting input
  const connected = await checkConnection()
  if (!connected) {
    write(dim('\nWaiting for input (connection may recover)...\n'))
  } else {
    write(dim('Connected to LM Studio') + '\n')
  }

  write(dim('─'.repeat(50)) + '\n\n')

  // Print prompt — triggers ready-prompt detection in the server
  write('> ')

  // Input collection — only submit when Enter (\r) is received
  let inputBuf = ''
  let timer: ReturnType<typeof setTimeout> | null = null
  let busy = false

  const handleInput = async () => {
    const text = inputBuf.trim()
    inputBuf = ''
    if (!text) {
      if (!busy) write('> ')
      return
    }

    busy = true
    await streamChat(text)
    busy = false
    write('> ')
  }

  // In raw mode, stdin delivers characters individually.
  // Only submit when Enter (\r) is received — NOT on a timeout.
  // Echo user-typed characters (single-char chunks) so the user can see their input.
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    const isUserTyping = chunk.length <= 2

    for (const ch of chunk) {
      if (ch === '\r') {
        // Enter — submit accumulated input
        if (isUserTyping) write('\n')
        if (timer) clearTimeout(timer)
        timer = setTimeout(handleInput, 50)
      } else if (ch === '\x7f' || ch === '\b') {
        // Backspace — erase last character
        if (inputBuf.length > 0) {
          inputBuf = inputBuf.slice(0, -1)
          if (isUserTyping) write('\b \b')
        }
      } else if (ch === '\x03') {
        // Ctrl+C — exit
        write('\n')
        process.exit(0)
      } else if (ch >= ' ' || ch === '\n') {
        // Printable character or newline — buffer it
        inputBuf += ch
        // Echo only user-typed printable chars (not server-injected prompts)
        if (isUserTyping && ch >= ' ') write(ch)
      }
    }
  })

  process.stdin.on('end', () => {
    write(dim('\n[session ended]\n'))
    process.exit(0)
  })

  // Keep the process alive
  process.stdin.resume()
}

main().catch((err) => {
  console.error('Fatal:', err)
  process.exit(1)
})
