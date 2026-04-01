# I kept losing track of which agent was doing what in which terminal, so I built a Kanban board to fix it

So I use Claude Code, Gemini and a few other coding agents pretty much every day. They're great at what they do but honestly my biggest problem was just keeping track of everything. I'd end up with like a dozen terminals open, different tasks in different repos, and I'd constantly forget which one finished, which one is waiting for input, what I still need to review. More time spent figuring out where things are than actually getting stuff done.

Got annoyed enough that I decided to just build something for it.

Kanabanana is basically a self-hosted Kanban board where each task gets its own agent and terminal, but you see it all on one screen. You can tell at a glance what's running, what's done, what needs review. No more digging through terminal windows trying to remember what's where.

How it works - you create a task, give it a title and description, pick which agent to use (Claude Code, Kilo Code, Gemini, or a local model through LM Studio), and it spawns a real terminal process that gets your task as a prompt. You can watch the output live in the browser. When the agent finishes, the task moves to Review and you get an auto-generated walkthrough of what it did. If something's off you send feedback and it picks up where it left off.

Some of the other stuff it does - there's an orchestrator that chains tasks together based on dependencies so they run in sequence automatically. Task scheduling if you want things to run on a timer. Auto-verification where the AI checks its own work. Workspaces to keep different projects separate. MCP server so Claude can interact with the board. GitHub integration for tracking PRs and issues. And 4 themes, two of which are banana-themed because why not.

If you're new to it, there's a built-in interactive guide that walks you through the whole board when you first start up - creating tasks, spawning agents, the review flow, all of it. And there's a help center (click the ? icon) that covers keyboard shortcuts, column meanings, and all the features if you need a refresher later.

About the agents - I'll be upfront, Claude Code works the best right now. Terminal integration, prompt handling, the feedback loop, output parsing - it all works pretty smoothly. Kilo Code, Gemini, and local models through LM Studio coming soon. Output parsing and feedback need more work and I'll be improving those in upcoming updates. There's also a generic mode where you can plug in any CLI command as an agent so you're not locked into anything.

**How I built it** - the stack is React + Vite on the frontend, Express + Socket.IO on the backend, and SQLite for storage. Each agent runs in a real PTY terminal (using @lydell/node-pty) — not a simulated shell — so you get full terminal output streamed to the browser via WebSocket and rendered with xterm.js. Drag and drop is handled by @hello-pangea/dnd.

The trickiest part was the feedback loop. When you send an agent feedback, it needs to pick up where it left off — but the terminal session might already be dead. So there are two paths: if the PTY is still alive, feedback gets injected directly. If it's dead, the agent respawns with a `--continue` flag to resume the previous conversation. Getting that reliable took more iteration than I expected.

One thing I learned the hard way: don't use file watchers on the server in dev mode. Early on I had `tsx watch` restarting the server every time an agent edited a file, which killed all the running PTY sessions. Switching to plain `tsx` fixed it — agents can work without nuking each other.

https://github.com/KanabananaAI/Kanabanana

I've been using this myself for a few weeks and it's honestly helped a lot. When an agent finishes I just review it, give feedback or commit, and move on. Way better than the terminal juggling I was doing before.

Fair warning though - this is one of several projects I'm working on so some things might still be buggy or half-baked. I'll do my best to fix stuff as it comes up, especially with help from the community. If you run into problems open a GitHub issue. And if you have ideas for features I'd love to hear them, drop a comment or open an issue.

Anyway if you're dealing with the same terminal chaos maybe give it a shot!
