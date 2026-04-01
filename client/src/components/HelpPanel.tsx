interface HelpPanelProps {
  isOpen: boolean
  onClose: () => void
  onStartTour?: () => void
}

const sections = [
  {
    title: 'Board & Columns',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M2 4.25A2.25 2.25 0 014.25 2h2.5A2.25 2.25 0 019 4.25v2.5A2.25 2.25 0 016.75 9h-2.5A2.25 2.25 0 012 6.75v-2.5zM2 13.25A2.25 2.25 0 014.25 11h2.5A2.25 2.25 0 019 13.25v2.5A2.25 2.25 0 016.75 18h-2.5A2.25 2.25 0 012 15.75v-2.5zM11 4.25A2.25 2.25 0 0113.25 2h2.5A2.25 2.25 0 0118 4.25v2.5A2.25 2.25 0 0115.75 9h-2.5A2.25 2.25 0 0111 6.75v-2.5z" />
      </svg>
    ),
    items: [
      { label: 'Backlog', desc: 'Ideas and future tasks. Drag here to park work.' },
      { label: 'To Do', desc: 'Planned tasks ready to be picked up.' },
      { label: 'Scheduled', desc: 'Time-based tasks that run on a schedule (read-only column).' },
      { label: 'In Progress', desc: 'Active agent execution. Tasks here have a running agent.' },
      { label: 'Review', desc: 'Agent finished — waiting for your human review before completion.' },
      { label: 'Inspect', desc: 'AI auto-verification mode. The agent reviews its own work.' },
      { label: 'Done', desc: 'Completed tasks, sorted by completion time.' },
    ],
  },
  {
    title: 'Task Actions',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M15.312 11.424a5.5 5.5 0 01-9.201 2.466l-.312-.311h2.433a.75.75 0 000-1.5H4.598a.75.75 0 00-.75.75v3.634a.75.75 0 001.5 0v-2.394l.312.311a7 7 0 0011.712-3.138.75.75 0 00-1.06-.818zm-1.06-7.674a.75.75 0 00-.662.113 7 7 0 00-11.712 3.138.75.75 0 001.06.818 5.5 5.5 0 019.201-2.466l.312.311H10.02a.75.75 0 000 1.5h3.634a.75.75 0 00.75-.75V2.75a.75.75 0 00-.152-.5z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: 'Spawn', desc: 'Start the agent on a task. Moves the task to In Progress.' },
      { label: 'Pause / Kill', desc: 'Pause or stop a running agent mid-execution.' },
      { label: 'Restart', desc: 'Re-run the agent from scratch on the same task.' },
      { label: 'Verify', desc: 'Trigger AI self-verification (moves task to Inspect). Uses the verify agent/model configured in Settings > Verification.' },
      { label: 'Manual Complete', desc: 'Force-complete a task without agent verification.' },
      { label: 'Send Feedback', desc: 'Send a real-time message to the running agent to course-correct. Supports voice dictation via the microphone button.' },
      { label: 'Run Next Step', desc: 'Execute a predefined next-step command on the task with one click.' },
      { label: 'Run Skill', desc: 'Execute a saved skill/command template on the task from the skills dropdown.' },
    ],
  },
  {
    title: 'Task Toggles',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M10 3.75a2 2 0 10-4 0 2 2 0 004 0zM17.25 4.5a.75.75 0 000-1.5h-5.5a.75.75 0 000 1.5h5.5zM5 3.75a.75.75 0 01-.75.75h-1.5a.75.75 0 010-1.5h1.5a.75.75 0 01.75.75zM4.25 17a.75.75 0 000-1.5h-1.5a.75.75 0 000 1.5h1.5zM17.25 17a.75.75 0 000-1.5h-5.5a.75.75 0 000 1.5h5.5zM9 10a.75.75 0 01-.75.75h-5.5a.75.75 0 010-1.5h5.5A.75.75 0 019 10zM17.25 10.75a.75.75 0 000-1.5h-1.5a.75.75 0 000 1.5h1.5zM14 10a2 2 0 10-4 0 2 2 0 004 0zM10 16.25a2 2 0 10-4 0 2 2 0 004 0z" />
      </svg>
    ),
    items: [
      {
        label: 'Yolo Mode',
        desc: 'Fast execution — agent skips confirmations and runs autonomously.',
      },
      {
        label: 'Auto-Review',
        desc: 'Skip the Review column. Task goes straight from In Progress to Inspect for AI verification.',
      },
      {
        label: 'Auto-Complete (checkmark icon)',
        desc: 'Agent auto-finalizes the task when done. Task moves to Done without manual intervention.',
      },
      {
        label: 'Waitlist (clock icon)',
        desc: 'Queue the task. It waits for in-progress tasks to finish before spawning. Available in Backlog and To Do.',
      },
    ],
  },
  {
    title: 'Agents & Models',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M10 9a3 3 0 100-6 3 3 0 000 6zM6 8a2 2 0 11-4 0 2 2 0 014 0zM1.49 15.326a.78.78 0 01-.358-.442 3 3 0 014.308-3.516 6.484 6.484 0 00-1.905 3.959c-.023.222-.014.442.025.654a4.97 4.97 0 01-2.07-.655zM16.44 15.98a4.97 4.97 0 002.07-.654.78.78 0 00.357-.442 3 3 0 00-4.308-3.517 6.484 6.484 0 011.907 3.96 2.32 2.32 0 01-.026.654zM18 8a2 2 0 11-4 0 2 2 0 014 0zM5.304 16.19a.844.844 0 01-.277-.71 5 5 0 019.947 0 .843.843 0 01-.277.71A6.975 6.975 0 0110 18a6.974 6.974 0 01-4.696-1.81z" />
      </svg>
    ),
    items: [
      { label: 'Claude', desc: 'Anthropic\'s Claude — supports Sonnet, Haiku, Opus, and extended-thinking models.' },
      { label: 'Gemini', desc: 'Google\'s Gemini models — available as an agent type for task execution and chat.' },
      { label: 'Kilo', desc: 'Kilo Code agent — supports multiple model providers including Anthropic, OpenAI, Google, DeepSeek, and Qwen.' },
      { label: 'Droid (Aider)', desc: 'Aider-powered agent for code editing and development tasks.' },
      { label: 'LM Studio', desc: 'Local models — dynamically fetched from your running LM Studio instance.' },
      { label: 'Generic', desc: 'Flexible agent type for custom setups and integrations.' },
      { label: 'Default Agent', desc: 'Set in Settings > Models. New tasks inherit this agent and model.' },
    ],
  },
  {
    title: 'Scheduling',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm.75-13a.75.75 0 00-1.5 0v5c0 .414.336.75.75.75h4a.75.75 0 000-1.5h-3.25V5z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: 'One-time Schedule', desc: 'Run a task at a specific date and time.' },
      { label: 'Recurring Schedule', desc: 'Repeat a task at a set interval (e.g. every 30 minutes).' },
      { label: 'Max Executions', desc: 'Limit how many times a recurring task runs. Leave empty for infinite.' },
      { label: 'Scheduled Column', desc: 'Scheduled tasks appear in their own column and auto-spawn when due.' },
    ],
  },
  {
    title: 'Skills & Templates',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M11.3 1.046A1 1 0 0112 2v5h4a1 1 0 01.82 1.573l-7 10A1 1 0 018 18v-5H4a1 1 0 01-.82-1.573l7-10a1 1 0 011.12-.38z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: 'What are Skills?', desc: 'Reusable command templates you can run on any task with one click.' },
      { label: 'Create Skills', desc: 'Define a name, description, and command. Assign to specific agent types or all.' },
      { label: 'Use Skills', desc: 'Click the skill dropdown on a task card to quickly execute a saved command.' },
      { label: 'Templates', desc: 'Save reusable task configurations with default agent, command, and checklists. Create in Settings > Templates.' },
      { label: 'Apply Templates', desc: 'Select a template when creating a new task to pre-fill settings and checklist items.' },
    ],
  },
  {
    title: 'Workspaces',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M3.75 3A1.75 1.75 0 002 4.75v3.26a3.235 3.235 0 011.75-.51h12.5c.644 0 1.245.188 1.75.51V6.75A1.75 1.75 0 0016.25 5h-4.836a.25.25 0 01-.177-.073L9.823 3.513A1.75 1.75 0 008.586 3H3.75zM3.75 9A1.75 1.75 0 002 10.75v4.5c0 .966.784 1.75 1.75 1.75h12.5A1.75 1.75 0 0018 15.25v-4.5A1.75 1.75 0 0016.25 9H3.75z" />
      </svg>
    ),
    items: [
      { label: 'Multiple Workspaces', desc: 'Organize tasks into separate boards. Each workspace has its own task set.' },
      { label: 'Switch Workspace', desc: 'Use the workspace selector in the top-left header to change boards.' },
      { label: 'Create / Delete', desc: 'Add new workspaces or remove unused ones from the selector dropdown.' },
      { label: 'Workspace Terminal', desc: 'Launch a workspace-wide terminal session with a chosen agent and model via the Terminal button in the header.' },
    ],
  },
  {
    title: 'Terminal',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M3.25 3A2.25 2.25 0 001 5.25v9.5A2.25 2.25 0 003.25 17h13.5A2.25 2.25 0 0019 14.75v-9.5A2.25 2.25 0 0016.75 3H3.25zm.943 8.752a.75.75 0 01.055-1.06L6.128 9l-1.88-1.693a.75.75 0 111.004-1.114l2.5 2.25a.75.75 0 010 1.114l-2.5 2.25a.75.75 0 01-1.06-.055zM9.75 10.25a.75.75 0 000 1.5h2.5a.75.75 0 000-1.5h-2.5z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: 'Open a Terminal', desc: 'Click the terminal icon on any task card to open its live terminal output in the panel. You can also open terminals from the Agent panel sidebar.' },
      { label: 'Split View', desc: 'Click the split button (columns icon) in the terminal panel header to add more slots. Cycles through 1 → 2 → 3 → 4 → 5 → 6 slots, then back to 1.' },
      { label: 'Assign Tasks to Slots', desc: 'Drag a task card onto an empty terminal slot to attach it. Each slot shows one agent session with full terminal input/output.' },
      { label: 'Close a Slot', desc: 'Click the × button on a terminal slot tab to close it. The agent keeps running — closing a slot only hides the terminal view.' },
      { label: 'Resize Panel', desc: 'Drag the panel edge to resize. Side panels (left/right) adjust width, bottom panel adjusts height.' },
      { label: 'Position', desc: 'Move the terminal panel to the left, right, or bottom of the board. Configure in Settings > Appearance.' },
      { label: 'Live Output', desc: 'Terminal streams agent output in real time via WebSocket. You can type commands directly into the terminal to interact with running agents.' },
      { label: 'Voice Dictation', desc: 'Use the microphone button in the terminal to dictate commands via Whisper transcription.' },
    ],
  },
  {
    title: 'GitHub Integration',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M4.632 3.533A2 2 0 016.577 2h6.846a2 2 0 011.945 1.533l1.976 8.234A3.489 3.489 0 0016 11.5H4c-.476 0-.93.095-1.344.267l1.976-8.234z" />
        <path fillRule="evenodd" d="M4 13a2 2 0 100 4h12a2 2 0 100-4H4zm11.24 2a.75.75 0 01.75-.75H16a.75.75 0 01.75.75v.01a.75.75 0 01-.75.75h-.01a.75.75 0 01-.75-.75V15zm-2.25-.75a.75.75 0 00-.75.75v.01c0 .414.336.75.75.75H13a.75.75 0 00.75-.75V15a.75.75 0 00-.75-.75h-.01z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: 'Setup', desc: 'Add your GitHub personal access token in Settings > GitHub to enable integration.' },
      { label: 'Link a Repo', desc: 'Associate a GitHub repository with a workspace to see its issues and PRs in the sidebar panel.' },
      { label: 'Import Issues', desc: 'Import GitHub issues directly as Kanabanana tasks from the GitHub panel.' },
      { label: 'PR Tracking', desc: 'View open pull requests for the linked repository without leaving the board.' },
    ],
  },
  {
    title: 'Orchestrator',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M4.25 2A2.25 2.25 0 002 4.25v2.5A2.25 2.25 0 004.25 9h2.5A2.25 2.25 0 009 6.75v-2.5A2.25 2.25 0 006.75 2h-2.5zM4.25 11A2.25 2.25 0 002 13.25v2.5A2.25 2.25 0 004.25 18h2.5A2.25 2.25 0 009 15.75v-2.5A2.25 2.25 0 006.75 11h-2.5zM11 4.25A2.25 2.25 0 0113.25 2h2.5A2.25 2.25 0 0118 4.25v2.5A2.25 2.25 0 0115.75 9h-2.5A2.25 2.25 0 0111 6.75v-2.5zM13.25 11A2.25 2.25 0 0011 13.25v2.5A2.25 2.25 0 0013.25 18h2.5A2.25 2.25 0 0018 15.75v-2.5A2.25 2.25 0 0015.75 11h-2.5z" />
      </svg>
    ),
    items: [
      { label: 'AI Orchestrator', desc: 'Automated task sequencing — the orchestrator manages task flow, agent coordination, and ghost task detection.' },
      { label: 'Activity Feed', desc: 'Live log of task completions, reviews, orchestrator decisions, and system events.' },
      { label: 'Agents Tab', desc: 'View currently active agents and their status across all tasks.' },
      { label: 'Systems Tab', desc: 'Monitor system health, resource usage, and orchestrator diagnostics.' },
      { label: 'Verification', desc: 'The orchestrator can delegate verification to AI, auto-inspecting agent output.' },
    ],
  },
  {
    title: 'Settings (7 Tabs)',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M7.84 1.804A1 1 0 018.82 1h2.36a1 1 0 01.98.804l.331 1.652a6.993 6.993 0 011.929 1.115l1.598-.54a1 1 0 011.186.447l1.18 2.044a1 1 0 01-.205 1.251l-1.267 1.113a7.047 7.047 0 010 2.228l1.267 1.113a1 1 0 01.206 1.25l-1.18 2.045a1 1 0 01-1.187.447l-1.598-.54a6.993 6.993 0 01-1.929 1.115l-.33 1.652a1 1 0 01-.98.804H8.82a1 1 0 01-.98-.804l-.331-1.652a6.993 6.993 0 01-1.929-1.115l-1.598.54a1 1 0 01-1.186-.447l-1.18-2.044a1 1 0 01.205-1.251l1.267-1.114a7.05 7.05 0 010-2.227L1.821 7.773a1 1 0 01-.206-1.25l1.18-2.045a1 1 0 011.187-.447l1.598.54A6.993 6.993 0 017.51 3.456l.33-1.652zM10 13a3 3 0 100-6 3 3 0 000 6z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: 'Appearance', desc: 'Theme (Dark, Experimental, Banana Dark, Banana Light, Light), card style, terminal position.' },
      { label: 'Models', desc: 'Default agent type and model. Manage LM Studio models.' },
      { label: 'Verification', desc: 'Auto-verification behavior, verify agent/model, retry limits, auto-review defaults.' },
      { label: 'Sound', desc: 'Sound presets for task events and notifications.' },
      { label: 'Tags', desc: 'Create custom tags with 16 color options for organizing tasks.' },
      { label: 'Templates', desc: 'Save reusable task configurations with default agent, command, and checklists.' },
      { label: 'GitHub', desc: 'Personal access token for GitHub integration.' },
    ],
  },
  {
    title: 'Header Bar',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path fillRule="evenodd" d="M2 4.75A.75.75 0 012.75 4h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 4.75zM2 10a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75A.75.75 0 012 10zm0 5.25a.75.75 0 01.75-.75h14.5a.75.75 0 010 1.5H2.75a.75.75 0 01-.75-.75z" clipRule="evenodd" />
      </svg>
    ),
    items: [
      { label: 'Workspace Selector', desc: 'Switch between workspaces (top-left).' },
      { label: '+ New Task', desc: 'Create a new task in the Backlog column.' },
      { label: 'Terminal', desc: 'Launch a workspace-wide agent terminal for ad-hoc commands and questions.' },
      { label: 'Theme Toggle', desc: 'Cycle through 5 themes: Dark, Experimental, Banana Dark, Banana Light, Light.' },
      { label: 'Settings', desc: 'Open the settings panel with 7 configuration tabs.' },
      { label: 'Restart', desc: 'Restart the server. Active agents will be killed (~20s downtime).' },
      { label: 'Archive', desc: 'View and restore archived tasks.' },
      { label: 'Deps', desc: 'Visualize task dependency graph.' },
      { label: 'Help', desc: 'You are here! This help page.' },
    ],
  },
  {
    title: 'Tips & Shortcuts',
    icon: (
      <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
        <path d="M10 1a6 6 0 00-3.815 10.631C7.237 12.5 8 13.443 8 14.456v.644a.75.75 0 00.75.75h2.5a.75.75 0 00.75-.75v-.644c0-1.013.762-1.957 1.815-2.825A6 6 0 0010 1zM8.863 17.414a.75.75 0 00-.226 1.483 9.066 9.066 0 002.726 0 .75.75 0 00-.226-1.483 7.563 7.563 0 01-2.274 0z" />
      </svg>
    ),
    items: [
      { label: 'Drag & Drop', desc: 'Drag task cards between columns to change their status.' },
      { label: 'Click to Expand', desc: 'Click a task card to see full details, walkthrough, and token usage.' },
      { label: 'Voice Input', desc: 'Use the microphone button to dictate task descriptions and feedback (Whisper API).' },
      { label: 'Sub-tasks', desc: 'Tasks can have parent/child relationships for breaking down complex work.' },
      { label: 'Checklists', desc: 'Add checklist items to tasks for step-by-step tracking. Toggle items as you go.' },
      { label: 'Token Tracking', desc: 'Each task tracks input, output, and cache tokens for cost awareness.' },
      { label: 'Images', desc: 'Paste or attach images to task descriptions for visual context.' },
      { label: 'Dependencies', desc: 'Link tasks so one blocks another. Visualize chains in the Deps graph.' },
      { label: 'MCP Server', desc: 'Kanabanana exposes an MCP server for AI agents to manage tasks programmatically.' },
    ],
  },
]

export default function HelpPanel({ isOpen, onClose, onStartTour }: HelpPanelProps) {
  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative w-full max-w-lg bg-board-card border-l border-board-border shadow-xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-board-border shrink-0">
          <div className="flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 text-yellow-400">
              <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zM8.94 6.94a.75.75 0 11-1.061-1.061 3 3 0 112.871 5.026v.345a.75.75 0 01-1.5 0v-.5c0-.72.57-1.172 1.081-1.287A1.5 1.5 0 108.94 6.94zM10 15a1 1 0 100-2 1 1 0 000 2z" clipRule="evenodd" />
            </svg>
            <h2 className="text-sm font-bold text-text-primary">Help &amp; Reference</h2>
          </div>
          <button
            onClick={onClose}
            className="text-text-muted hover:text-text-primary transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5">
              <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
          <p className="text-xs text-text-secondary leading-relaxed">
            Kanabanana is an AI-powered Kanban board for orchestrating autonomous agents.
            Create tasks, assign agents, and let them execute while you review the results.
          </p>

          {/* Start Tour button */}
          {onStartTour && (
            <button
              onClick={onStartTour}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg bg-yellow-400/10 border border-yellow-400/30 text-yellow-400 hover:bg-yellow-400/20 hover:border-yellow-400/50 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4">
                <path d="M6.3 2.841A1.5 1.5 0 004 4.11V15.89a1.5 1.5 0 002.3 1.269l9.344-5.89a1.5 1.5 0 000-2.538L6.3 2.84z" />
              </svg>
              <span className="text-xs font-semibold">Start Interactive Tour</span>
              <span className="text-[10px] text-yellow-400/60 ml-1">21 steps</span>
            </button>
          )}

          {sections.map((section) => (
            <div key={section.title}>
              <div className="flex items-center gap-2 mb-2">
                <span className="text-yellow-400">{section.icon}</span>
                <h3 className="text-xs font-bold text-text-primary uppercase tracking-wider">{section.title}</h3>
              </div>
              <div className="space-y-1.5">
                {section.items.map((item) => (
                  <div key={item.label} className="flex gap-2 text-[11px] leading-relaxed">
                    <span className="font-semibold text-text-primary whitespace-nowrap shrink-0">{item.label}</span>
                    <span className="text-text-muted">&mdash;</span>
                    <span className="text-text-secondary">{item.desc}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {/* Footer */}
          <div className="border-t border-board-border pt-4 pb-2">
            <p className="text-[10px] text-text-muted text-center">
              Kanabanana &middot; AI-Powered Task Orchestration
            </p>
          </div>
        </div>
      </div>
    </div>
  )
}
