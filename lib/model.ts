/** Static building model: one floor (EG), rooms and walls with stable ids. */

export interface Room {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  d: number;
}

export interface Wall {
  id: string;
  label: string; // "Wand 12"
  kind: "Außenwand" | "Trockenbauwand";
  from: [number, number];
  to: [number, number];
  rooms: string[];
}

export const ROOMS: Room[] = [
  { id: "EG-R-1.01", name: "Flur 1.01", x: 0, y: 5, w: 20, d: 2 },
  { id: "EG-R-1.02", name: "Büro 1.02", x: 0, y: 0, w: 8, d: 5 },
  { id: "EG-R-1.03", name: "Küche 1.03", x: 8, y: 0, w: 6, d: 5 },
  { id: "EG-R-1.04", name: "Bad 1.04", x: 14, y: 0, w: 6, d: 5 },
  { id: "EG-R-1.05", name: "Schlafzimmer 1.05", x: 0, y: 7, w: 10, d: 5 },
  { id: "EG-R-1.06", name: "Wohnzimmer 1.06", x: 10, y: 7, w: 10, d: 5 },
];

const w = (
  n: number,
  kind: Wall["kind"],
  from: [number, number],
  to: [number, number],
  rooms: string[],
): Wall => ({
  id: `EG-W-${String(n).padStart(2, "0")}`,
  label: `Wand ${n}`,
  kind,
  from,
  to,
  rooms: rooms.map((r) => `EG-R-${r}`),
});

export const WALLS: Wall[] = [
  w(1, "Außenwand", [0, 0], [8, 0], ["1.02"]),
  w(2, "Außenwand", [8, 0], [14, 0], ["1.03"]),
  w(3, "Außenwand", [14, 0], [20, 0], ["1.04"]),
  w(4, "Außenwand", [20, 0], [20, 5], ["1.04"]),
  w(5, "Außenwand", [20, 5], [20, 7], ["1.01"]),
  w(6, "Außenwand", [20, 7], [20, 12], ["1.06"]),
  w(7, "Außenwand", [20, 12], [10, 12], ["1.06"]),
  w(8, "Außenwand", [10, 12], [0, 12], ["1.05"]),
  w(9, "Außenwand", [0, 12], [0, 7], ["1.05"]),
  w(10, "Außenwand", [0, 7], [0, 5], ["1.01"]),
  w(11, "Außenwand", [0, 5], [0, 0], ["1.02"]),
  w(12, "Trockenbauwand", [14, 0], [14, 5], ["1.03", "1.04"]),
  w(13, "Trockenbauwand", [8, 0], [8, 5], ["1.02", "1.03"]),
  w(14, "Trockenbauwand", [0, 5], [8, 5], ["1.02", "1.01"]),
  w(15, "Trockenbauwand", [8, 5], [14, 5], ["1.03", "1.01"]),
  w(16, "Trockenbauwand", [14, 5], [20, 5], ["1.04", "1.01"]),
  w(17, "Trockenbauwand", [0, 7], [10, 7], ["1.05", "1.01"]),
  w(18, "Trockenbauwand", [10, 7], [20, 7], ["1.06", "1.01"]),
  w(19, "Trockenbauwand", [10, 7], [10, 12], ["1.05", "1.06"]),
];

export const WALL_IDS = WALLS.map((x) => x.id);
const ROOM_IDS = new Set(ROOMS.map((r) => r.id));

export function isKnownElement(id: string): boolean {
  return id === "ALL" || ROOM_IDS.has(id) || WALL_IDS.includes(id);
}

/** Expand an element reference (wall, room or ALL) to the walls it covers. */
export function wallsFor(elementId: string): string[] {
  if (elementId === "ALL") return WALL_IDS;
  if (ROOM_IDS.has(elementId)) return WALLS.filter((x) => x.rooms.includes(elementId)).map((x) => x.id);
  return WALL_IDS.includes(elementId) ? [elementId] : [];
}

export function elementName(id: string): string {
  if (id === "ALL") return "ganzes Geschoss";
  const room = ROOMS.find((r) => r.id === id);
  if (room) return room.name;
  const wall = WALLS.find((x) => x.id === id);
  if (wall) {
    const rooms = wall.rooms.map((r) => ROOMS.find((x) => x.id === r)?.name ?? r).join(" / ");
    return `${wall.label} (${rooms})`;
  }
  return id;
}
