import { useEffect, useRef, useState } from 'react';
import type { CommandEnvelope, CommandResult, OperatorCommand } from '@ember/contracts';

export type CommandHandler = (command: CommandEnvelope) => Promise<CommandResult>;
export interface ActionFeedback { runId: string; status: 'pending' | 'accepted' | 'rejected' | 'unavailable'; message: string }
export function useCommands(runId: string, onCommand?: CommandHandler) {
  const currentRun = useRef(runId);
  currentRun.current = runId;
  const active = useRef<string | null>(null);
  const [feedback, setFeedback] = useState<ActionFeedback | null>(null);
  useEffect(() => { active.current = null; setFeedback(null); }, [runId]);
  async function send(payload: OperatorCommand) {
    if (active.current) return;
    if (!onCommand) { setFeedback({ runId, status: 'unavailable', message: 'Command transport not connected. No change applied.' }); return; }
    const commandId = crypto.randomUUID();
    active.current = commandId;
    setFeedback({ runId, status: 'pending', message: 'Awaiting authoritative response…' });
    try {
      const result = await onCommand({ schemaVersion: 1, runId, commandId, source: 'human', payload });
      if (currentRun.current !== runId || active.current !== commandId) return;
      if (result.runId !== runId || result.commandId !== commandId) {
        setFeedback({ runId, status: 'rejected', message: 'Mismatched response discarded. No application confirmed.' });
      } else {
        setFeedback({ runId, status: result.status, message: `${result.message} (${result.reason})${result.appliedRevision !== null ? ` · revision ${result.appliedRevision}` : ''}` });
      }
    } catch (error) {
      if (currentRun.current === runId && active.current === commandId) setFeedback({ runId, status: 'unavailable', message: error instanceof Error ? error.message : 'Command failed. Application not confirmed.' });
    } finally { if (active.current === commandId) active.current = null; }
  }
  const current = feedback?.runId === runId ? feedback : null;
  return { send, feedback: current, pending: current?.status === 'pending' };
}
