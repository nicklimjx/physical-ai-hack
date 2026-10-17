import type { Announcement, OperatorInput, OperatorResponse, ProviderState } from '@ember/contracts';

export interface VoicePanelProps {
  runId: string;
  announcements: readonly Announcement[];
  onCommittedInput(input: OperatorInput): Promise<OperatorResponse>;
  status: ProviderState['status'];
}

export function VoicePanel({ status }: VoicePanelProps) {
  return (
    <div className="voice-panel">
      <span className="mic">◉</span>
      <span><b>VOICE OFFLINE</b><small>Voice controls unavailable in preview</small></span>
      <button disabled={status !== 'ready'}>HOLD TO SPEAK</button>
    </div>
  );
}
