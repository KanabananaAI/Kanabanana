import { Router, Request, Response } from 'express';
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);
const router = Router();

// ---------- Types ----------

interface LmStudioModel {
    key: string;
    displayName: string;
    type: string;
    architecture: string;
    quantization: string;
    bits: number;
    maxContextLength: number;
}

interface LmStudioRawModel {
    type: string;
    modelKey: string;
    displayName: string;
    architecture?: string;
    quantization?: { name: string; bits: number };
    maxContextLength?: number;
}

// ---------- Cache ----------

let modelsCache: { models: LmStudioModel[]; available: boolean; timestamp: number } | null = null;
let statusCache: { running: boolean; port: number; loadedModels: string[]; timestamp: number } | null = null;
const CACHE_TTL_MS = 30_000; // 30 seconds

function isCacheValid(cache: { timestamp: number } | null): boolean {
    return cache !== null && Date.now() - cache.timestamp < CACHE_TTL_MS;
}

// ---------- Helpers ----------

/** Strip ANSI escape sequences from CLI output */
function stripAnsi(str: string): string {
    return str.replace(/\x1b\[[0-9;]*m/g, '');
}

async function fetchModels(): Promise<{ available: boolean; models: LmStudioModel[] }> {
    try {
        const { stdout } = await execFileAsync('lms', ['ls', '--json'], { timeout: 10_000 });
        const raw: LmStudioRawModel[] = JSON.parse(stdout.trim());

        const models: LmStudioModel[] = raw
            .filter((m) => m.type === 'llm')
            .map((m) => ({
                key: m.modelKey,
                displayName: m.displayName || m.modelKey,
                type: m.type,
                architecture: m.architecture || '',
                quantization: m.quantization?.name || '',
                bits: m.quantization?.bits || 0,
                maxContextLength: m.maxContextLength || 0,
            }));

        return { available: true, models };
    } catch {
        return { available: false, models: [] };
    }
}

async function fetchStatus(): Promise<{ running: boolean; port: number; loadedModels: string[] }> {
    try {
        const { stdout } = await execFileAsync('lms', ['status'], { timeout: 5_000 });
        // Strip ANSI escape codes — lms CLI outputs colored text
        const text = stripAnsi(stdout.trim());

        // Parse "Server: ON (port: 1234)" or "Server: OFF"
        const serverMatch = text.match(/Server:\s*(ON|OFF)(?:\s*\(port:\s*(\d+)\))?/i);
        const running = serverMatch?.[1]?.toUpperCase() === 'ON';
        const port = serverMatch?.[2] ? parseInt(serverMatch[2], 10) : 1234;

        // Parse loaded models — lines after "Loaded Models" header
        // Lines look like: "  · qwen3.5-0.8b - 1.21 GB"
        const loadedModels: string[] = [];
        const lines = text.split('\n');
        let inLoaded = false;
        for (const line of lines) {
            if (/loaded\s+models/i.test(line)) {
                inLoaded = true;
                continue;
            }
            if (inLoaded) {
                // Match model name: everything after leading decorators up to " - " (space-dash-space)
                const modelMatch = line.match(/^[\s·\u2500\u251c\u2514\u2502\u00b7]*\s*([\w.\-/]+)\s+-\s/);
                if (modelMatch?.[1]) {
                    loadedModels.push(modelMatch[1]);
                }
            }
        }

        return { running, port, loadedModels };
    } catch {
        return { running: false, port: 1234, loadedModels: [] };
    }
}

// ---------- Routes ----------

// GET /api/lmstudio/models — Discover locally-available LM Studio models
router.get('/api/lmstudio/models', async (_req: Request, res: Response) => {
    if (isCacheValid(modelsCache)) {
        res.json({ available: modelsCache!.available, models: modelsCache!.models });
        return;
    }

    const result = await fetchModels();
    modelsCache = { ...result, timestamp: Date.now() };
    res.json({ available: result.available, models: result.models });
});

// GET /api/lmstudio/status — Check if LM Studio server is running
router.get('/api/lmstudio/status', async (_req: Request, res: Response) => {
    if (isCacheValid(statusCache)) {
        const { running, port, loadedModels } = statusCache!;
        res.json({ running, port, loadedModels });
        return;
    }

    const result = await fetchStatus();
    statusCache = { ...result, timestamp: Date.now() };
    res.json({ running: result.running, port: result.port, loadedModels: result.loadedModels });
});

// POST /api/lmstudio/cache/clear — Force-refresh cached data
router.post('/api/lmstudio/cache/clear', (_req: Request, res: Response) => {
    modelsCache = null;
    statusCache = null;
    res.json({ cleared: true });
});

export default router;
