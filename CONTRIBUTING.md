# Contributing to Kanabanana

Thanks for your interest in contributing! Here's how to get started.

## Prerequisites

- **Node.js 18+** and npm
- **Python 3** and a C/C++ toolchain — required to build the `@lydell/node-pty` native addon
  - **Windows:** `npm install --global windows-build-tools` or install Visual Studio Build Tools
  - **macOS:** `xcode-select --install`
  - **Linux (Debian/Ubuntu):** `sudo apt install build-essential python3`

## Development Setup

```bash
# Fork and clone the repository
git clone https://github.com/<your-username>/Kanaban.git
cd Kanaban

# Install server dependencies
npm install

# Install client dependencies
cd client && npm install && cd ..

# (Optional) Install MCP server dependencies
cd mcp-server && npm install && cd ..

# Start both server and client in dev mode
npm run dev
```

This starts the Express server (port 3001) and Vite dev server (port 5173) concurrently.

> **Note:** The server does **not** auto-restart on file changes (this is intentional — it prevents killing active agent PTY sessions). After editing files in `server/`, restart manually with Ctrl+C and `npm run dev`.

## Making Changes

1. Create a feature branch from `opensource`: `git checkout -b my-feature opensource`
2. Make your changes
3. Test that the app builds: `cd client && npm run build`
4. Verify the server compiles: `npx tsc --noEmit`
5. Submit a pull request against the `opensource` branch

## Code Style

- TypeScript throughout (server and client)
- Follow existing patterns in the codebase
- Use Tailwind CSS for styling (no custom CSS files)
- Keep components focused — prefer small, single-purpose files

## Project Layout

| Directory | Purpose |
|-----------|---------|
| `server/` | Express backend, WebSocket handlers, agent management |
| `server/routes/` | REST API endpoints |
| `server/parsers/` | Agent output parsers (Claude, Kilo, etc.) |
| `client/src/components/` | React components |
| `client/src/hooks/` | Custom React hooks |
| `mcp-server/` | Model Context Protocol server for Claude integration |
| `data/` | SQLite database and walkthroughs (gitignored, created at runtime) |
| `docs/` | Design specs and plans |

## Reporting Issues

Use the [issue templates](https://github.com/bartsecond/Kanaban/issues/new/choose) — there are templates for bug reports and feature requests.

## License

By contributing, you agree that your contributions will be licensed under the same [Business Source License 1.1](LICENSE) that covers the project. On 2030-03-16, all contributions convert to MIT along with the rest of the codebase.
