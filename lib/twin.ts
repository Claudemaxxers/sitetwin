import { WALL_IDS, wallsFor } from "./model";
import { STEP_ORDER, WORK_ACTIONS, type SiteEvent, type Step, type TwinState, type WallState, type WallStatus } from "./types";

const STATUS_BY_STEP: Record<Step, WallStatus> = {
  mep_rough_in_done: "installed",
  inspection_passed: "inspected",
  wall_closed: "closed",
  finishing_done: "finished",
};

export const INITIAL_REV = "A";

export function emptyWall(id: string): WallState {
  return { id, status: "open", done: {}, closePlanned: false, currentRev: INITIAL_REV, revEventId: null, acks: [], history: [] };
}

function statusOf(w: WallState): WallStatus {
  let s: WallStatus = "open";
  for (const step of STEP_ORDER) if (w.done[step]) s = STATUS_BY_STEP[step];
  return s;
}

/** Apply one event to a twin state (mutates and returns it). */
export function applyEvent(state: TwinState, ev: SiteEvent): TwinState {
  for (const wallId of wallsFor(ev.elementId)) {
    const w = (state[wallId] ??= emptyWall(wallId));
    w.history.push(ev.id);
    switch (ev.action) {
      case "mep_rough_in_done":
      case "inspection_passed":
      case "finishing_done":
        w.done[ev.action] = ev.id;
        break;
      case "wall_closed":
        w.done.wall_closed = ev.id;
        w.closePlanned = false;
        break;
      case "wall_close_planned":
        w.closePlanned = true;
        break;
      case "inspection_failed":
        delete w.done.inspection_passed;
        break;
      case "drawing_revised":
        if (ev.drawingRev && ev.drawingRev.localeCompare(w.currentRev) > 0) {
          w.currentRev = ev.drawingRev;
          w.revEventId = ev.id;
          w.acks = [];
        }
        break;
      case "change_acknowledged":
        if ((!ev.drawingRev || ev.drawingRev === w.currentRev) && !w.acks.includes(ev.trade)) w.acks.push(ev.trade);
        break;
    }
    // Working explicitly to the current revision counts as acknowledging it.
    if (WORK_ACTIONS.includes(ev.action) && ev.drawingRev === w.currentRev && !w.acks.includes(ev.trade)) {
      w.acks.push(ev.trade);
    }
    w.status = statusOf(w);
  }
  return state;
}

/** Event sourcing: the twin is a pure function of the event log. */
export function deriveTwin(events: SiteEvent[]): TwinState {
  const state: TwinState = {};
  for (const id of WALL_IDS) state[id] = emptyWall(id);
  for (const ev of events) applyEvent(state, ev);
  return state;
}

export function cloneTwin(state: TwinState): TwinState {
  return structuredClone(state);
}
