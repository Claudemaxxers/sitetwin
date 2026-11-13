"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Environment, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { useEffect, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { raeume, SIGNAL_ART_LABEL, type Geschoss, type Signal, type TopZustand, type Zwilling } from "@/lib/twin-model";

/* ------------------------------------------------------------------ */
/* Dimensions and palette                                              */
/* ------------------------------------------------------------------ */

const W = 26; // building length (x)
const D = 12; // building depth (z)
const FH = 3.1; // storey height incl. slab
const SLAB = 0.3;
const WALL_H = FH - SLAB;
const CUT_H = 1.05; // wall height when a storey is cut open
const GROUND = -1.4; // the basement sticks out of the ground a bit

const C = {
  plaster: "#f1ece5",
  plasterShade: "#e6e0d7",
  slab: "#d8d2c9",
  concrete: "#b9b2a8",
  concreteDark: "#9f988e",
  frame: "#34302c",
  glass: "#9fb9cb",
  floor: "#ece7e0",
  section: "#2b2724",
  ink: "#0c0a08",
  accent: "#ee783b",
  ok: "#2f9e5b",
  ground: "#e9e5df",
  lawn: "#cdd5c1",
  tree: "#94a882",
};

/* ------------------------------------------------------------------ */
/* Layout: units along the floor, rooms inside a unit                  */
/* ------------------------------------------------------------------ */

export interface Rect {
  x0: number;
  x1: number;
  z0: number;
  z1: number;
}
const cx = (r: Rect) => (r.x0 + r.x1) / 2;
const cz = (r: Rect) => (r.z0 + r.z1) / 2;

function unitRects(g: Geschoss): Record<string, Rect> {
  const weights = g.tops.map((t) => Math.max(4, raeume(t.top === "TG" ? { ...t, raeume: "a,b,c,d" } : t).length));
  const sum = weights.reduce((a, b) => a + b, 0);
  let x = -W / 2;
  const out: Record<string, Rect> = {};
  g.tops.forEach((t, i) => {
    const w = (weights[i] / sum) * W;
    out[t.top] = { x0: x, x1: x + w, z0: -D / 2, z1: D / 2 };
    x += w;
  });
  return out;
}

const FRONT_FIRST = ["wohnzimmer", "küche", "schlafzimmer", "kinderzimmer", "arbeitszimmer"];

/** Living rooms to the street (front, +z), service rooms to the back. */
export function roomRects(unit: Rect, names: string[]): Record<string, Rect> {
  const front = names.filter((n) => FRONT_FIRST.includes(n.toLowerCase()));
  const back = names.filter((n) => !FRONT_FIRST.includes(n.toLowerCase()));
  const out: Record<string, Rect> = {};
  const split = unit.z0 + (unit.z1 - unit.z0) * 0.42;
  const row = (list: string[], z0: number, z1: number) => {
    const w = (unit.x1 - unit.x0) / Math.max(1, list.length);
    list.forEach((n, i) => (out[n] = { x0: unit.x0 + i * w, x1: unit.x0 + (i + 1) * w, z0, z1 }));
  };
  row(back, unit.z0, split);
  row(front, split, unit.z1);
  return out;
}

function findRoom(rooms: Record<string, Rect>, raum: string | null): Rect | null {
  if (!raum) return null;
  const key = Object.keys(rooms).find((k) => raum.toLowerCase().includes(k.toLowerCase()));
  return key ? rooms[key] : null;
}

/* ------------------------------------------------------------------ */
/* Fading: every mesh in a storey follows the storey's opacity         */
/* ------------------------------------------------------------------ */

function applyOpacity(obj: THREE.Object3D, op: number) {
  obj.visible = op > 0.02;
  obj.traverse((o) => {
    const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
    if (!m) return;
    for (const mat of Array.isArray(m) ? m : [m]) {
      if (mat.userData.base === undefined) {
        mat.userData.base = mat.opacity;
        mat.userData.transparent = mat.transparent;
      }
      mat.opacity = mat.userData.base * op;
      mat.transparent = mat.userData.transparent || op < 0.999;
      mat.depthWrite = !mat.userData.transparent && op > 0.6;
    }
  });
}

/* ------------------------------------------------------------------ */
/* Facade                                                              */
/* ------------------------------------------------------------------ */

function Box({ p, s, color, rough = 0.9, metal = 0, shadow = true }: { p: [number, number, number]; s: [number, number, number]; color: string; rough?: number; metal?: number; shadow?: boolean }) {
  return (
    <mesh position={p} castShadow={shadow} receiveShadow>
      <boxGeometry args={s} />
      <meshStandardMaterial color={color} roughness={rough} metalness={metal} />
    </mesh>
  );
}

/** A wall along x (len) or z with punched windows. Local origin = wall centre at floor level. */
function WindowWall({ len, thick, cut, plaster }: { len: number; thick: number; cut: boolean; plaster: string }) {
  if (cut) {
    return (
      <group>
        <Box p={[0, CUT_H / 2, 0]} s={[len, CUT_H, thick]} color={plaster} />
        <Box p={[0, CUT_H + 0.005, 0]} s={[len, 0.01, thick]} color={C.section} shadow={false} />
      </group>
    );
  }
  const bays = Math.max(1, Math.round(len / 2.7));
  const bay = len / bays;
  const win = Math.min(1.6, bay * 0.58);
  const sill = 0.85;
  const head = 2.3;
  const parts: React.ReactNode[] = [];
  parts.push(<Box key="sp" p={[0, sill / 2, 0]} s={[len, sill, thick]} color={plaster} />);
  parts.push(<Box key="li" p={[0, (head + WALL_H) / 2, 0]} s={[len, WALL_H - head, thick]} color={plaster} />);
  for (let i = 0; i <= bays; i++) {
    const x = -len / 2 + i * bay;
    const pw = i === 0 || i === bays ? (bay - win) / 2 : bay - win;
    const px = i === 0 ? x + pw / 2 : i === bays ? x - pw / 2 : x;
    parts.push(<Box key={`p${i}`} p={[px, (sill + head) / 2, 0]} s={[pw, head - sill, thick]} color={plaster} />);
  }
  for (let i = 0; i < bays; i++) {
    const x = -len / 2 + bay * (i + 0.5);
    parts.push(
      <group key={`w${i}`} position={[x, (sill + head) / 2, 0]}>
        <mesh>
          <boxGeometry args={[win, head - sill, 0.04]} />
          <meshStandardMaterial color={C.glass} roughness={0.06} metalness={0.65} transparent opacity={0.7} />
        </mesh>
        <Box p={[0, 0, 0.02]} s={[0.05, head - sill, 0.06]} color={C.frame} rough={0.5} shadow={false} />
        <Box p={[0, -(head - sill) / 2 - 0.03, thick / 2]} s={[win + 0.1, 0.05, 0.16]} color={C.plasterShade} shadow={false} />
      </group>,
    );
  }
  return <group>{parts}</group>;
}

function Facade({ cut, basement }: { cut: boolean; basement: boolean }) {
  const t = 0.3;
  const plaster = basement ? C.concrete : C.plaster;
  if (basement) {
    const h = cut ? CUT_H : WALL_H;
    return (
      <group>
        <Box p={[0, h / 2, D / 2 - t / 2]} s={[W, h, t]} color={plaster} />
        <Box p={[0, h / 2, -D / 2 + t / 2]} s={[W, h, t]} color={plaster} />
        <Box p={[-W / 2 + t / 2, h / 2, 0]} s={[t, h, D - 2 * t]} color={plaster} />
        <Box p={[W / 2 - t / 2, h / 2, 0]} s={[t, h, D - 2 * t]} color={plaster} />
        {!cut && (
          <>
            {/* garage door + ventilation slots */}
            <Box p={[W / 2 - 4.2, 1.15, D / 2 + 0.01]} s={[3.6, 2.3, 0.05]} color={C.concreteDark} rough={0.6} metal={0.3} />
            {Array.from({ length: 9 }, (_, i) => (
              <Box key={i} p={[W / 2 - 4.2, 0.3 + i * 0.24, D / 2 + 0.04]} s={[3.5, 0.03, 0.03]} color="#8d867c" shadow={false} />
            ))}
            {[-9, -4.5, 0].map((x) => (
              <Box key={x} p={[x, 2.2, D / 2 + 0.01]} s={[2.2, 0.35, 0.05]} color={C.frame} shadow={false} />
            ))}
          </>
        )}
      </group>
    );
  }
  return (
    <group>
      <group position={[0, 0, D / 2 - t / 2]}>
        <WindowWall len={W} thick={t} cut={cut} plaster={plaster} />
      </group>
      <group position={[0, 0, -D / 2 + t / 2]}>
        <WindowWall len={W} thick={t} cut={cut} plaster={plaster} />
      </group>
      <group position={[-W / 2 + t / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <WindowWall len={D - 2 * t} thick={t} cut={cut} plaster={C.plasterShade} />
      </group>
      <group position={[W / 2 - t / 2, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
        <WindowWall len={D - 2 * t} thick={t} cut={cut} plaster={C.plasterShade} />
      </group>
    </group>
  );
}

function Balconies({ units }: { units: Rect[] }) {
  return (
    <group>
      {units.map((u, i) => {
        const w = Math.min(4.2, (u.x1 - u.x0) * 0.55);
        return (
          <group key={i} position={[cx(u), 0, D / 2 + 0.75]}>
            <RoundedBox args={[w, 0.18, 1.5]} radius={0.03} position={[0, 0.09, 0]} castShadow receiveShadow>
              <meshStandardMaterial color={C.slab} roughness={0.9} />
            </RoundedBox>
            <mesh position={[0, 0.65, 0.72]}>
              <boxGeometry args={[w, 0.95, 0.03]} />
              <meshStandardMaterial color="#cfe0ea" roughness={0.05} metalness={0.3} transparent opacity={0.35} />
            </mesh>
            <Box p={[0, 1.13, 0.72]} s={[w, 0.04, 0.06]} color={C.frame} shadow={false} />
          </group>
        );
      })}
    </group>
  );
}

function Roof() {
  return (
    <group position={[0, WALL_H, 0]}>
      <RoundedBox args={[W + 0.3, 0.32, D + 0.3]} radius={0.04} position={[0, 0.16, 0]} castShadow receiveShadow>
        <meshStandardMaterial color={C.slab} roughness={0.9} />
      </RoundedBox>
      {/* parapet */}
      <Box p={[0, 0.55, D / 2]} s={[W + 0.3, 0.5, 0.25]} color={C.plaster} />
      <Box p={[0, 0.55, -D / 2]} s={[W + 0.3, 0.5, 0.25]} color={C.plaster} />
      <Box p={[-W / 2, 0.55, 0]} s={[0.25, 0.5, D]} color={C.plaster} />
      <Box p={[W / 2, 0.55, 0]} s={[0.25, 0.5, D]} color={C.plaster} />
      {/* green roof + technics */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.33, 0]} receiveShadow>
        <planeGeometry args={[W - 0.4, D - 0.4]} />
        <meshStandardMaterial color="#b7c3a5" roughness={1} />
      </mesh>
      <Box p={[6, 0.75, -2]} s={[2.4, 0.8, 1.6]} color="#c9c4bc" rough={0.5} metal={0.4} />
      <Box p={[-7, 0.6, 1.5]} s={[1.2, 0.5, 1.2]} color="#c9c4bc" rough={0.5} metal={0.4} />
      {Array.from({ length: 6 }, (_, i) => (
        <mesh key={i} position={[-4 + i * 1.7, 0.62, -3.2]} rotation={[-0.45, 0, 0]} castShadow>
          <boxGeometry args={[1.5, 0.04, 1]} />
          <meshStandardMaterial color="#1f2a38" roughness={0.25} metalness={0.6} />
        </mesh>
      ))}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Interior when a storey is cut open                                  */
/* ------------------------------------------------------------------ */

function Pulse({ color, children }: { color: string; children?: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    ref.current?.traverse((o) => {
      const m = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
      if (m && "emissiveIntensity" in m) m.emissiveIntensity = 0.35 + 0.35 * Math.sin(clock.elapsedTime * 4);
    });
  });
  return (
    <group ref={ref} userData={{ color }}>
      {children}
    </group>
  );
}

function Beacon({ position, color = C.accent, height = 4.5 }: { position: [number, number, number]; color?: string; height?: number }) {
  const ring = useRef<THREE.Mesh>(null);
  const beam = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const k = (clock.elapsedTime * 0.7) % 1;
    if (ring.current) {
      ring.current.scale.setScalar(0.5 + k * 2.4);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
    }
    if (beam.current) (beam.current.material as THREE.MeshBasicMaterial).opacity = 0.16 + 0.1 * Math.sin(clock.elapsedTime * 3);
  });
  return (
    <group position={position}>
      <mesh ref={beam} position={[0, height / 2, 0]}>
        <cylinderGeometry args={[0.06, 0.45, height, 24, 1, true]} />
        <meshBasicMaterial color={color} transparent opacity={0.2} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
      <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
        <ringGeometry args={[0.55, 0.65, 48]} />
        <meshBasicMaterial color={color} transparent depthWrite={false} />
      </mesh>
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Labels: plain DOM over the canvas, positioned every frame.          */
/* (drei <Html> mounts one React root per label, which races in React 19.) */
/* ------------------------------------------------------------------ */

type Tone = "ink" | "accent" | "light" | "ok" | "room";
interface LabelEntry {
  obj: THREE.Object3D;
  node: ReactNode;
  tone: Tone;
  onClick?: () => void;
}
const labels = {
  map: new Map<string, LabelEntry>(),
  els: new Map<string, HTMLDivElement>(),
  version: 0,
  subs: new Set<() => void>(),
  emit() {
    this.version++;
    this.subs.forEach((f) => f());
  },
};

let labelSeq = 0;
function Label({ position, children, tone = "ink", onClick }: { position: [number, number, number]; children: ReactNode; tone?: Tone; onClick?: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const id = useMemo(() => `l${++labelSeq}`, []);
  useLayoutEffect(() => {
    if (!ref.current) return;
    labels.map.set(id, { obj: ref.current, node: children, tone, onClick });
    labels.emit();
  });
  useEffect(
    () => () => {
      labels.map.delete(id);
      labels.emit();
    },
    [id],
  );
  return <group ref={ref} position={position} />;
}

function Projector() {
  const { camera, size } = useThree();
  const v = useMemo(() => new THREE.Vector3(), []);
  useFrame(() => {
    for (const [id, e] of labels.map) {
      const el = labels.els.get(id);
      if (!el) continue;
      let shown = true;
      e.obj.traverseAncestors((a) => {
        if (!a.visible) shown = false;
      });
      e.obj.getWorldPosition(v).project(camera);
      if (!shown || v.z > 1) {
        el.style.display = "none";
        continue;
      }
      el.style.display = "";
      el.style.transform = `translate(-50%, -50%) translate(${((v.x + 1) / 2) * size.width}px, ${((1 - v.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

function LabelOverlay() {
  useSyncExternalStore(
    (f) => {
      labels.subs.add(f);
      return () => labels.subs.delete(f);
    },
    () => labels.version,
    () => 0,
  );
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {[...labels.map.entries()].map(([id, e]) => {
        const bg = e.tone === "accent" ? C.accent : e.tone === "ok" ? C.ok : e.tone === "light" ? "rgba(255,255,255,.94)" : C.ink;
        return (
          <div
            key={id}
            ref={(el) => {
              if (el) labels.els.set(id, el);
              else labels.els.delete(id);
            }}
            onClick={e.onClick}
            className={e.tone === "room" ? "tw-room absolute left-0 top-0" : "tw-label absolute left-0 top-0"}
            style={
              e.tone === "room"
                ? { display: "none" }
                : { display: "none", background: bg, color: e.tone === "light" ? C.ink : "#fff", cursor: e.onClick ? "pointer" : "default", pointerEvents: e.onClick ? "auto" : "none" }
            }
          >
            {e.node}
          </div>
        );
      })}
    </div>
  );
}

interface FloorProps {
  g: Geschoss;
  z: Zwilling;
  offset: number;
  opacity: number;
  cut: boolean;
  focus: boolean; // this storey is the selected one
  topSel: string | null;
  base: number;
  isRoof: boolean;
  showBadges: boolean;
  onFloor: () => void;
  onTop: (top: string) => void;
}

function Floor({ g, z, offset, opacity, cut, focus, topSel, base, isRoof, showBadges, onFloor, onTop }: FloorProps) {
  const group = useRef<THREE.Group>(null);
  const cur = useRef({ y: offset, op: opacity });
  const units = useMemo(() => unitRects(g), [g]);
  const basement = g.level < 0;
  const flagged = g.tops.filter((t) => (z.tops[t.top]?.signale.length ?? 0) > 0);

  useFrame((_, dt) => {
    if (!group.current) return;
    const k = 1 - Math.exp(-dt * 5);
    cur.current.y += (offset - cur.current.y) * k;
    cur.current.op += (opacity - cur.current.op) * k;
    group.current.position.y = base + cur.current.y;
    applyOpacity(group.current, cur.current.op);
  });

  return (
    <group ref={group} position={[0, base + offset, 0]}>
      {/* slab */}
      <group
        onClick={(e) => {
          if (cut) return;
          e.stopPropagation();
          onFloor();
        }}
        onPointerOver={(e) => {
          if (cut) return;
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        <RoundedBox args={[W + 0.2, SLAB, D + 0.2]} radius={0.03} position={[0, -SLAB / 2, 0]} castShadow receiveShadow>
          <meshStandardMaterial color={C.slab} roughness={0.95} />
        </RoundedBox>
        {/* storey band: orange when something is being clarified on this storey */}
        {flagged.length > 0 && !cut && (
          <Pulse color={C.accent}>
            <mesh position={[0, -SLAB / 2, D / 2 + 0.11]}>
              <boxGeometry args={[W + 0.22, 0.12, 0.02]} />
              <meshStandardMaterial color={C.accent} emissive={C.accent} emissiveIntensity={0.5} />
            </mesh>
          </Pulse>
        )}
        <Facade cut={cut} basement={basement} />
        {!basement && !cut && <Balconies units={Object.values(units)} />}
        {isRoof && !cut && <Roof />}
      </group>

      {/* interior: units and rooms */}
      {cut &&
        g.tops.map((t) => {
          const r = units[t.top];
          const zs = z.tops[t.top];
          const sel = topSel === t.top;
          const dim = topSel !== null && !sel;
          const hasSignal = (zs?.signale.length ?? 0) > 0;
          const prog = zs?.fortschritt ?? 0;
          return (
            <group key={t.top}>
              <group
                onClick={(e) => {
                  e.stopPropagation();
                  onTop(t.top);
                }}
                onPointerOver={(e) => {
                  e.stopPropagation();
                  document.body.style.cursor = "pointer";
                }}
                onPointerOut={() => (document.body.style.cursor = "")}
              >
                <mesh position={[cx(r), 0.04, cz(r)]} receiveShadow>
                  <boxGeometry args={[r.x1 - r.x0 - 0.3, 0.08, r.z1 - r.z0 - 0.6]} />
                  <meshStandardMaterial
                    color={hasSignal ? "#f6d8c6" : sel ? "#f4f1ec" : C.floor}
                    emissive={hasSignal ? C.accent : "#000"}
                    emissiveIntensity={hasSignal && !sel ? 0.12 : 0}
                    roughness={0.9}
                    transparent
                    opacity={dim ? 0.45 : 1}
                  />
                </mesh>
                {/* progress strip along the street side */}
                <mesh position={[r.x0 + 0.15 + ((r.x1 - r.x0 - 0.3) * prog) / 2, 0.09, r.z1 - 0.55]}>
                  <boxGeometry args={[Math.max(0.001, (r.x1 - r.x0 - 0.3) * prog), 0.03, 0.22]} />
                  <meshStandardMaterial color={C.ok} roughness={0.6} />
                </mesh>
                <mesh position={[cx(r), 0.085, r.z1 - 0.55]}>
                  <boxGeometry args={[r.x1 - r.x0 - 0.3, 0.02, 0.22]} />
                  <meshStandardMaterial color="#d9d3ca" roughness={0.9} />
                </mesh>
              </group>
              {/* party walls between units */}
              <Box p={[r.x1, CUT_H / 2, 0]} s={[0.2, CUT_H, D - 0.6]} color={C.plaster} />
              <TopDetail top={t.top} rect={r} zs={zs} detail={sel} dim={dim} />
              {!sel && (
                topSel === null && (
                  <Label position={[cx(r), 1.6, cz(r)]} tone={hasSignal ? "accent" : "light"} onClick={() => onTop(t.top)}>
                    <b>{t.top}</b>
                    <span style={{ opacity: 0.75 }}> · {Math.round(prog * 100)} %</span>
                    {hasSignal && <span> · {zs!.signale.length} {zs!.signale.length === 1 ? "Thema" : "Themen"}</span>}
                  </Label>
                )
              )}
            </group>
          );
        })}

      {/* house view: one badge per storey with something to clarify; click goes straight to the unit */}
      {showBadges &&
        flagged.map((t) => {
          const r = units[t.top];
          const s = z.tops[t.top].signale[0];
          return (
            <Label key={t.top} position={[cx(r), WALL_H * 0.6, D / 2 + 0.5]} tone="accent" onClick={() => onTop(t.top)}>
              <b>{t.top}</b> · {SIGNAL_ART_LABEL[s.art]}
              {s.status === "in_bearbeitung" ? " · in Bearbeitung" : ""}
            </Label>
          );
        })}
      {focus && !cut && null}
    </group>
  );
}

/** Rooms of one unit, with the place of the problem lit up. */
function TopDetail({ top, rect, zs, detail, dim }: { top: string; rect: Rect; zs: TopZustand | undefined; detail: boolean; dim: boolean }) {
  const names = zs ? raeume(zs.top) : [];
  const rooms = useMemo(() => roomRects({ x0: rect.x0 + 0.15, x1: rect.x1 - 0.15, z0: rect.z0 + 0.3, z1: rect.z1 - 0.3 }, names), [rect, names.join()]);
  const signal: Signal | undefined = zs?.signale[0];
  const problemRoom = signal ? findRoom(rooms, signal.raum) : null;
  // where it should be according to the current plan (e.g. Index C: Abstellraum)
  // the room the valid plan names last ("von Vorraum in Abstellraum" → Abstellraum)
  const planRaum = useMemo(() => {
    if (signal?.art !== "plan_veraltet") return null;
    const text = [zs?.plan?.aenderung, ...(zs?.eintraege.filter((e) => e.art === "planaenderung").map((e) => `${e.zusammenfassung} ${e.raum ?? ""}`) ?? [])].join(" ");
    const hits = Object.keys(rooms)
      .filter((n) => !signal.raum || !signal.raum.toLowerCase().includes(n.toLowerCase()))
      .map((n) => ({ n, i: text.toLowerCase().lastIndexOf(n.toLowerCase()) }))
      .filter((h) => h.i >= 0)
      .sort((a, b) => b.i - a.i);
    return hits[0]?.n ?? null;
  }, [signal, zs, rooms]);
  const planRoom = planRaum ? rooms[planRaum] : null;
  const done = zs ? Object.values(zs.stufen).filter(Boolean).length : 0;

  return (
    <group>
      {Object.entries(rooms).map(([n, r]) => {
        const isProblem = problemRoom === r;
        const isPlan = planRoom === r;
        return (
          <group key={n}>
            <mesh position={[cx(r), 0.1, cz(r)]} receiveShadow>
              <boxGeometry args={[r.x1 - r.x0 - 0.12, 0.04, r.z1 - r.z0 - 0.12]} />
              <meshStandardMaterial
                color={isProblem ? "#f2b896" : isPlan ? "#bfe0cb" : /bad|wc/i.test(n) ? "#cdd5da" : /vorraum|abstell|technik|fahrgasse/i.test(n) ? "#d9d1c5" : "#e3cfb2"}
                emissive={isProblem ? C.accent : "#000"}
                emissiveIntensity={isProblem ? 0.2 : 0}
                roughness={0.85}
                transparent
                opacity={dim ? 0.5 : 1}
              />
            </mesh>
            {/* interior partitions, cut at section height */}
            <Box p={[r.x1, CUT_H * 0.45, cz(r)]} s={[0.1, CUT_H * 0.9, r.z1 - r.z0]} color="#faf8f5" />
            <Box p={[cx(r), CUT_H * 0.45, r.z0]} s={[r.x1 - r.x0, CUT_H * 0.9, 0.1]} color="#faf8f5" />
            {detail && (
              <Label position={[cx(r), 0.15, cz(r)]} tone="room">
                {n}
              </Label>
            )}
          </group>
        );
      })}

      {signal && !detail && <Beacon position={[problemRoom ? cx(problemRoom) : cx(rect), 0.1, problemRoom ? cz(problemRoom) : cz(rect)]} height={3.2} />}
      {signal && problemRoom && detail && (
        <group>
          {/* the element as built (e.g. distribution board in the hall) */}
          <Pulse color={C.accent}>
            <mesh position={[cx(problemRoom), 1.0, problemRoom.z0 + 0.22]} castShadow>
              <boxGeometry args={[0.7, 0.9, 0.18]} />
              <meshStandardMaterial color={C.accent} emissive={C.accent} emissiveIntensity={0.5} roughness={0.4} />
            </mesh>
          </Pulse>
          <Beacon position={[cx(problemRoom), 0.1, cz(problemRoom)]} />
          <Label position={[cx(problemRoom), 2.3, problemRoom.z0 + 0.3]} tone="accent">
            {signal.element ?? signal.titel} · {signal.raum}
            {zs?.eintraege.find((e) => e.plan_index && e.raum === signal.raum)?.plan_index ? ` · nach Index ${zs?.eintraege.find((e) => e.plan_index && e.raum === signal.raum)?.plan_index}` : ""}
          </Label>
        </group>
      )}
      {signal && planRoom && detail && (
        <group>
          <mesh position={[cx(planRoom), 1.0, planRoom.z0 + 0.22]}>
            <boxGeometry args={[0.7, 0.9, 0.18]} />
            <meshStandardMaterial color={C.ok} transparent opacity={0.55} roughness={0.4} />
          </mesh>
          <Label position={[cx(planRoom), 2.3, planRoom.z0 + 0.3]} tone="ok">
            Laut gültigem Plan{zs?.plan ? ` (Index ${zs.plan.plan_index})` : ""}: {planRaum}
          </Label>
        </group>
      )}
      {!signal && detail && (
        <Label position={[cx(rect), 2.1, cz(rect)]} tone="light">
          <b>{top}</b> · {done} von 5 Arbeitsschritten gemeldet
        </Label>
      )}
    </group>
  );
}

/* ------------------------------------------------------------------ */
/* Surroundings, camera                                                */
/* ------------------------------------------------------------------ */

function Surroundings() {
  const trees = useMemo(
    () =>
      [
        [-17, 9, 1.2],
        [-19, -2, 1],
        [18.5, 8, 1.1],
        [20, -5, 1.3],
        [-8, 12.5, 0.9],
        [9, 12.8, 1],
      ] as [number, number, number][],
    [],
  );
  return (
    <group position={[0, GROUND, 0]}>
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <circleGeometry args={[42, 64]} />
        <meshStandardMaterial color={C.ground} roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 10.5]} receiveShadow>
        <planeGeometry args={[60, 3.2]} />
        <meshStandardMaterial color="#dedad3" roughness={1} />
      </mesh>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]} receiveShadow>
        <planeGeometry args={[W + 9, D + 6]} />
        <meshStandardMaterial color={C.lawn} roughness={1} />
      </mesh>
      {trees.map(([x, zz, s], i) => (
        <group key={i} position={[x, 0, zz]} scale={s}>
          <mesh position={[0, 0.9, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.13, 1.8, 8]} />
            <meshStandardMaterial color="#7d6a58" roughness={1} />
          </mesh>
          <mesh position={[0, 2.5, 0]} castShadow>
            <icosahedronGeometry args={[1.2, 1]} />
            <meshStandardMaterial color={C.tree} roughness={0.95} flatShading />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function CameraRig({ pos, look, flightKey }: { pos: THREE.Vector3; look: THREE.Vector3; flightKey: string }) {
  const { camera } = useThree();
  const controls = useThree((s) => s.controls) as OrbitControlsImpl | null;
  const flying = useRef(true);
  useEffect(() => {
    flying.current = true;
  }, [flightKey]);
  useFrame((_, dt) => {
    if (!flying.current || !controls) return;
    const k = 1 - Math.exp(-dt * 3.2);
    camera.position.lerp(pos, k);
    controls.target.lerp(look, k);
    controls.update();
    if (camera.position.distanceTo(pos) < 0.05 && controls.target.distanceTo(look) < 0.05) flying.current = false;
  });
  useEffect(() => {
    if (!controls) return;
    const stop = () => (flying.current = false);
    controls.addEventListener("start", stop);
    return () => controls.removeEventListener("start", stop);
  }, [controls]);
  return null;
}

/* ------------------------------------------------------------------ */
/* Scene                                                               */
/* ------------------------------------------------------------------ */

export interface Building3DProps {
  z: Zwilling;
  floorSel: string | null;
  topSel: string | null;
  isolated: boolean; // second phase of the slice animation
  onFloor: (name: string) => void;
  onTop: (floor: string, top: string) => void;
}

export default function Building3D({ z, floorSel, topSel, isolated, onFloor, onTop }: Building3DProps) {
  const floors = z.geschosse;
  const minLevel = floors.length ? floors[0].level : 0;
  const baseOf = (g: Geschoss) => (g.level - minLevel) * FH + GROUND + 0.02;
  const selIdx = floors.findIndex((g) => g.name === floorSel);
  const sel = selIdx >= 0 ? floors[selIdx] : null;

  const cam = useMemo(() => {
    if (!sel) {
      const midY = baseOf(floors[floors.length - 1] ?? ({ level: 0 } as Geschoss)) / 2;
      return { pos: new THREE.Vector3(27, 15 + midY, 33), look: new THREE.Vector3(0, midY + 0.5, 0) };
    }
    const y = baseOf(sel);
    if (topSel) {
      const r = unitRects(sel)[topSel];
      const x = r ? cx(r) : 0;
      return { pos: new THREE.Vector3(x + 7, y + 13, 17), look: new THREE.Vector3(x, y + 0.6, 0) };
    }
    return { pos: new THREE.Vector3(10, y + 19, 26), look: new THREE.Vector3(0, y + 0.3, 0) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floorSel, topSel, floors.length]);

  return (
    <div className="relative h-full w-full">
    <Canvas shadows dpr={[1, 2]} camera={{ position: [44, 30, 50], fov: 32, near: 0.5, far: 400 }} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 0.98 }}>
      <color attach="background" args={["#f7f5f2"]} />
      <fog attach="fog" args={["#f7f5f2", 70, 140]} />
      <hemisphereLight args={["#ffffff", "#d9d2c8", 0.4]} />
      <directionalLight
        position={[22, 34, 18]}
        intensity={1.9}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-30}
        shadow-camera-right={30}
        shadow-camera-top={30}
        shadow-camera-bottom={-30}
        shadow-bias={-0.0004}
        shadow-normalBias={0.02}
      />
      <Environment resolution={256}>
        <Lightformer intensity={0.9} position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
        <Lightformer intensity={1.1} position={[-14, 4, 8]} rotation-y={Math.PI / 2} scale={[14, 5, 1]} />
        <Lightformer intensity={0.9} color="#ffd9c2" position={[14, 4, -8]} rotation-y={-Math.PI / 2} scale={[14, 5, 1]} />
      </Environment>
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI / 2.15} minDistance={8} maxDistance={110} />
      <CameraRig pos={cam.pos} look={cam.look} flightKey={`${floorSel}|${topSel}`} />

      <Surroundings />
      <ContactShadows position={[0, GROUND + 0.02, 0]} scale={70} blur={2.4} opacity={0.32} far={8} />

      {floors.map((g, i) => {
        let offset = 0;
        let opacity = 1;
        if (sel) {
          // phase 1: the house is sliced (gaps open); phase 2: the picked slice stays, the rest fades away
          offset = (i - selIdx) * 2.2 + (i > selIdx ? 1.2 : 0);
          if (isolated && i !== selIdx) {
            offset += i > selIdx ? 9 : -6;
            opacity = 0;
          }
          if (isolated && i === selIdx) offset = 0;
        }
        return (
          <Floor
            key={g.name}
            g={g}
            z={z}
            base={baseOf(g)}
            offset={offset}
            opacity={opacity}
            cut={!!sel && isolated && i === selIdx}
            focus={i === selIdx}
            topSel={i === selIdx ? topSel : null}
            isRoof={i === floors.length - 1}
            showBadges={!sel}
            onFloor={() => onFloor(g.name)}
            onTop={(t) => onTop(g.name, t)}
          />
        );
      })}
      <Projector />
    </Canvas>
    <LabelOverlay />
    </div>
  );
}
