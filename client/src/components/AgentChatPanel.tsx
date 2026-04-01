import { useState, useEffect, useCallback } from 'react';
import { useSocket } from '../hooks/useSocket';
import Terminal from './Terminal';

interface AgentChatPanelProps {
  isOpen: boolean;
  onToggle: () => void;
  workspaceId: string | null;
  defaultAgentType: string;
}

type ChatStatus = 'idle' | 'connecting' | 'active' | 'closed' | 'error';

export default function AgentChatPanel({ isOpen, onToggle, workspaceId, defaultAgentType }: AgentChatPanelProps) {
  const socket = useSocket();
  const [chatId, setChatId] = useState<string | null>(null);
  const [agentType, setAgentType] = useState(defaultAgentType || 'claude');
  const [model, setModel] = useState('');
  const [status, setStatus] = useState<ChatStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [_pendingAgentSwitch, setPendingAgentSwitch] = useState<string | null>(null);

  // Request history on workspace change (to restore active session)
  useEffect(() => {
    if (!socket || !workspaceId) return;
    socket.emit('agent-chat:history', { workspaceId });
  }, [socket, workspaceId]);

  // Socket listeners
  useEffect(() => {
    if (!socket) return;

    const onSpawnResult = (data: { chatId: string | null; success: boolean; error?: string }) => {
      if (data.success && data.chatId) {
        setChatId(data.chatId);
        setStatus('active');
        setError(null);
        socket.emit('agent-chat:join', data.chatId);
      } else {
        setStatus('error');
        setError(data.error || 'Failed to start session');
      }
    };

    const onKillResult = (_data: { chatId: string; success: boolean }) => {
      setChatId(null);
      setPendingAgentSwitch(prev => {
        if (prev) {
          setAgentType(prev);
          setStatus('connecting');
          setTimeout(() => {
            socket.emit('agent-chat:spawn', { workspaceId, agentType: prev, model: '' });
          }, 0);
          return null;
        }
        setStatus('idle');
        return null;
      });
    };

    const onHistoryResponse = (data: { chatId: string | null; status: string; agentType: string | null; model: string | null }) => {
      if (!data.chatId || data.status === 'none') {
        setStatus('idle');
        return;
      }
      setChatId(data.chatId);
      if (data.agentType) setAgentType(data.agentType);
      if (data.model) setModel(data.model);
      if (data.status === 'active') {
        setStatus('active');
        socket.emit('agent-chat:join', data.chatId);
      } else {
        setStatus('idle');
      }
    };

    socket.on('agent-chat:spawn:result', onSpawnResult);
    socket.on('agent-chat:kill:result', onKillResult);
    socket.on('agent-chat:history-response', onHistoryResponse);

    return () => {
      socket.off('agent-chat:spawn:result', onSpawnResult);
      socket.off('agent-chat:kill:result', onKillResult);
      socket.off('agent-chat:history-response', onHistoryResponse);
    };
  }, [socket, workspaceId]);

  const handleSpawn = useCallback(() => {
    if (!socket || !workspaceId) return;
    setStatus('connecting');
    setError(null);
    socket.emit('agent-chat:spawn', { workspaceId, agentType, model });
  }, [socket, workspaceId, agentType, model]);

  const handleKill = useCallback(() => {
    if (!socket || !chatId) return;
    socket.emit('agent-chat:leave', chatId);
    socket.emit('agent-chat:kill', { chatId });
  }, [socket, chatId]);

  const handleAgentSwitch = useCallback((newAgent: string) => {
    if (status === 'active') {
      if (!confirm('Switch agents? This will end the current session.')) return;
      if (socket && chatId) {
        setPendingAgentSwitch(newAgent);
        setStatus('connecting');
        socket.emit('agent-chat:kill', { chatId });
        return;
      }
    }
    setAgentType(newAgent);
    setStatus('idle');
  }, [socket, chatId, status]);

  // Collapsed view
  if (!isOpen) {
    return (
      <div
        className="w-10 h-full bg-board-bg border-r border-board-border flex flex-col items-center pt-3 cursor-pointer hover:bg-board-surface transition-colors"
        onClick={onToggle}
        title="Open Agent Chat"
      >
        <span className="text-purple-400 text-lg">~</span>
        <span className="text-[9px] text-text-muted mt-1 writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>Term</span>
      </div>
    );
  }

  return (
    <div className="w-80 h-full bg-board-bg border-r border-board-border flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-board-border shrink-0">
        <span className="text-xs font-semibold text-text-primary">Agent Terminal</span>
        <div className="flex gap-1">
          {status === 'active' && (
            <button onClick={handleKill} className="text-text-muted hover:text-red-400 text-xs px-1" title="Kill session">Kill</button>
          )}
          <button onClick={onToggle} className="text-text-muted hover:text-text-primary text-xs px-1" title="Minimize">-</button>
        </div>
      </div>

      {/* Agent selector — only when idle */}
      {(status === 'idle' || status === 'error') && (
        <div className="px-3 py-2 border-b border-board-border shrink-0">
          <select
            value={agentType}
            onChange={(e) => handleAgentSwitch(e.target.value)}
            className="w-full px-2 py-1 rounded border border-board-border bg-board-surface text-text-primary text-xs"
          >
            <option value="claude">Claude</option>
            <option value="gemini">Gemini</option>
            <option value="qwen">Qwen</option>
            <option value="kilo">Kilo</option>
            <option value="droid">Droid (Aider)</option>
            <option value="generic">Generic</option>
          </select>
        </div>
      )}

      {/* Active agent indicator */}
      {status === 'active' && (
        <div className="px-3 py-1 border-b border-board-border shrink-0 flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 shrink-0" />
          <span className="text-[10px] text-text-muted truncate">{agentType}</span>
        </div>
      )}

      {/* Content */}
      {status === 'idle' && (
        <div className="flex-1 flex flex-col items-center justify-center px-3 text-center">
          <p className="text-text-muted text-xs mb-3">Open a terminal with an AI agent</p>
          <button
            onClick={handleSpawn}
            disabled={!workspaceId}
            className={`text-xs px-4 py-2 rounded font-medium transition-colors ${
              workspaceId
                ? 'bg-purple-600 hover:bg-purple-500 text-white'
                : 'bg-board-surface text-text-muted cursor-not-allowed'
            }`}
          >
            Start
          </button>
        </div>
      )}

      {status === 'connecting' && (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-text-muted text-xs animate-pulse">Starting {agentType}...</p>
        </div>
      )}

      {status === 'error' && (
        <div className="flex-1 flex flex-col items-center justify-center text-center px-3">
          <p className="text-red-400 text-xs mb-2">{error}</p>
          <button onClick={handleSpawn} className="text-xs px-3 py-1 rounded bg-purple-600 hover:bg-purple-500 text-white">
            Retry
          </button>
        </div>
      )}

      {status === 'active' && chatId && (
        <div className="flex-1 overflow-hidden">
          <Terminal taskId={`agent-chat:${chatId}`} visible={true} fill />
        </div>
      )}
    </div>
  );
}
