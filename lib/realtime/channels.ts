export type RealtimeEvent =
  | "score.submitted"
  | "score.revised"
  | "score.conflict"
  | "round.locked"
  | "round.unlocked"
  | "event.status_changed"
  | "judge.presence_changed"
  | "contestant.stage_changed"
  | "results.updated"
  | "report.ready";

export function getEventChannel(eventId: string) {
  return `event:${eventId}`;
}

export function getRoundChannel(eventId: string, roundId: string) {
  return `event:${eventId}:round:${roundId}`;
}

export function getJudgeChannel(eventId: string, judgeId: string) {
  return `event:${eventId}:judge:${judgeId}`;
}

export function getDisplayChannel(eventId: string) {
  return `event:${eventId}:display`;
}
