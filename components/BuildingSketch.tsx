"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Bounds, ContactShadows, Edges } from "@react-three/drei";
import { useMemo, useRef, useState } from "react";
import * as THREE from "three";

/**
 * Architect-style sketch models for the project overview: white volumes,
 * thin ink edges, a bit of see-through glass. Geometry is simplified but proportional.
 */

export type BauTyp = "wohnbau" | "oper" | "turm";

const INK = "#3f3a35";
const PAPER = "#fbfaf7";
const PAPER_2 = "#f1eee9";
const GLASS = "#cfdde6";
const COPPER = "#d7e6dc";

type V3 = [number, number, number];

function B({ p, s, c = PAPER, o = 1, r }: { p: V3; s: V3; c?: string; o?: number; r?: V3 }) {
  return (
    <mesh position={p} rotation={r}>
      <boxGeometry args={s} />
      <meshStandardMaterial color={c} roughness={1} transparent={o < 1} opacity={o} depthWrite={o >= 1} />
      <Edges color={INK} threshold={15} />
    </mesh>
  );
}

/** Triangular prism (gable roof) along x. */
function Gable({ p, len, w, h, c = COPPER }: { p: V3; len: number; w: number; h: number; c?: string }) {
  const geo = useMemo(() => {
    const s = new THREE.Shape();
    s.moveTo(-w / 2, 0);
    s.lineTo(w / 2, 0);
    s.lineTo(0, h);
    s.closePath();
    const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
    g.translate(0, 0, -len / 2);
    g.rotateY(Math.PI / 2);
    return g;
  }, [len, w, h]);
  return (
    <mesh position={p} geometry={geo}>
      <meshStandardMaterial color={c} roughness={1} transparent opacity={0.92} />
      <Edges color={INK} threshold={15} />
    </mesh>
  );
}

function Pyramid({ p, w, h, c = COPPER }: { p: V3; w: number; h: number; c?: string }) {
  return (
    <mesh position={[p[0], p[1] + h / 2, p[2]]} rotation={[0, Math.PI / 4, 0]}>
      <coneGeometry args={[w / Math.SQRT2, h, 4]} />
      <meshStandardMaterial color={c} roughness={1} />
      <Edges color={INK} threshold={15} />
    </mesh>
  );
}

/* ------------------------------------------------------------------ */

/** Residential block: basement, storeys with punched windows, balconies, flat roof. */
function Wohnbau({ geschosse = 4 }: { geschosse?: number }) {
  const W = 26;
  const D = 12;
  const H = 3;
  const bays = 9;
  const items: React.ReactNode[] = [];
  for (let i = 0; i < geschosse; i++) {
    const y = i * H;
    const ug = i === 0;
    items.push(<B key={`s${i}`} p={[0, y + H / 2, 0]} s={[W, H - 0.25, D]} c={ug ? PAPER_2 : PAPER} />);
    items.push(<B key={`d${i}`} p={[0, y + H - 0.12, 0]} s={[W + 0.3, 0.25, D + 0.3]} />);
    if (ug) {
      items.push(<B key="gar" p={[W / 2 - 4, 1.2, D / 2 + 0.02]} s={[3.6, 2.2, 0.08]} c={PAPER_2} />);
      continue;
    }
    for (let b = 0; b < bays; b++) {
      const x = -W / 2 + (W / bays) * (b + 0.5);
      for (const z of [D / 2 + 0.03, -D / 2 - 0.03]) items.push(<B key={`w${i}${b}${z}`} p={[x, y + 1.45, z]} s={[1.3, 1.5, 0.06]} c={GLASS} o={0.55} />);
    }
    for (const x of [-8.5, 0, 8.5]) {
      items.push(<B key={`b${i}${x}`} p={[x, y + 0.08, D / 2 + 0.8]} s={[4, 0.16, 1.6]} />);
      items.push(<B key={`g${i}${x}`} p={[x, y + 0.6, D / 2 + 1.58]} s={[4, 0.9, 0.04]} c={GLASS} o={0.35} />);
    }
  }
  const top = geschosse * H;
  items.push(<B key="par" p={[0, top + 0.3, 0]} s={[W + 0.3, 0.6, D + 0.3]} c={PAPER_2} />);
  items.push(<B key="tech" p={[5, top + 1.1, -2]} s={[3, 1, 2]} />);
  return <group>{items}</group>;
}

/** Vienna State Opera, simplified: loggia front, auditorium with curved roof, stage tower, corner pavilions. */
function Oper() {
  const arches: React.ReactNode[] = [];
  for (let i = 0; i < 5; i++) {
    const x = -9 + i * 4.5;
    arches.push(
      <mesh key={`a${i}`} position={[x, 5.2, 18.05]}>
        <torusGeometry args={[1.75, 0.18, 6, 20, Math.PI]} />
        <meshStandardMaterial color={PAPER} />
        <Edges color={INK} threshold={15} />
      </mesh>,
      <mesh key={`u${i}`} position={[x, 10.3, 18.05]}>
        <torusGeometry args={[1.2, 0.14, 6, 18, Math.PI]} />
        <meshStandardMaterial color={PAPER} />
        <Edges color={INK} threshold={15} />
      </mesh>,
    );
  }
  const columns: React.ReactNode[] = [];
  for (let i = 0; i < 6; i++) {
    const x = -11.25 + i * 4.5;
    columns.push(<B key={`c${i}`} p={[x, 2.6, 18]} s={[0.9, 5.2, 0.9]} />);
    columns.push(<B key={`k${i}`} p={[x, 9, 18]} s={[0.7, 3.6, 0.7]} />);
    columns.push(<B key={`f${i}`} p={[x, 15.4, 18]} s={[0.6, 1.2, 0.6]} />);
  }
  const windows: React.ReactNode[] = [];
  for (let i = 0; i < 9; i++) {
    const z = -10 + i * 2.5;
    for (const x of [-20.05, 20.05]) {
      windows.push(<B key={`w${i}${x}`} p={[x, 3.4, z]} s={[0.06, 2.4, 1.2]} c={GLASS} o={0.5} />);
      windows.push(<B key={`v${i}${x}`} p={[x, 8.4, z]} s={[0.06, 2.4, 1.2]} c={GLASS} o={0.5} />);
    }
  }
  return (
    <group position={[0, 0, -3]}>
      {/* base and main storeys */}
      <B p={[0, 0.6, 0]} s={[42, 1.2, 30]} c={PAPER_2} />
      <B p={[0, 6, 0]} s={[40, 10, 28]} />
      <B p={[0, 11.2, 0]} s={[40.6, 0.4, 28.6]} />
      {/* loggia */}
      <B p={[0, 6.5, 16]} s={[25, 13, 4]} />
      <B p={[0, 13.3, 16]} s={[25.6, 0.6, 4.6]} />
      {arches}
      {columns}
      {/* auditorium with curved copper roof */}
      <B p={[0, 14, 0]} s={[26, 5.2, 20]} />
      <mesh position={[0, 16.6, 0]} rotation={[0, 0, Math.PI / 2]} scale={[1, 1, 0.45]}>
        <cylinderGeometry args={[10, 10, 26, 28, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color={COPPER} roughness={1} side={THREE.DoubleSide} transparent opacity={0.9} />
        <Edges color={INK} threshold={20} />
      </mesh>
      {/* stage tower */}
      <B p={[0, 15, -9.5]} s={[22, 14, 9]} />
      <Gable p={[0, 22, -9.5]} len={22} w={9.4} h={4.5} />
      {/* corner pavilions */}
      {[-17.5, 17.5].map((x) =>
        [11.5, -11.5].map((z) => (
          <group key={`${x}${z}`}>
            <B p={[x, 7.5, z]} s={[6, 13, 6]} />
            <Pyramid p={[x, 14, z]} w={6.2} h={3.2} />
          </group>
        )),
      )}
      {windows}
    </group>
  );
}

/** Fictional timber-hybrid tower with podium, setbacks and roof garden. */
function Turm() {
  const floors: React.ReactNode[] = [];
  const n = 11;
  for (let i = 0; i < n; i++) {
    const y = 5 + i * 3.2;
    const w = i >= n - 2 ? 9 : 12;
    floors.push(<B key={`g${i}`} p={[0, y + 1.5, 0]} s={[w - 0.6, 2.9, w - 0.6]} c={GLASS} o={0.4} />);
    floors.push(<B key={`s${i}`} p={[0, y + 3.05, 0]} s={[w, 0.3, w]} />);
    for (let k = 0; k < 6; k++) {
      const t = -w / 2 + (w / 6) * (k + 0.5);
      floors.push(<B key={`fz${i}${k}`} p={[t, y + 1.5, w / 2 + 0.1]} s={[0.18, 2.9, 0.4]} c="#efe4d3" />);
      floors.push(<B key={`fx${i}${k}`} p={[w / 2 + 0.1, y + 1.5, t]} s={[0.4, 2.9, 0.18]} c="#efe4d3" />);
    }
  }
  const top = 5 + n * 3.2;
  return (
    <group>
      <B p={[0, 2.5, 0]} s={[22, 5, 18]} />
      <B p={[0, 5.15, 0]} s={[22.4, 0.3, 18.4]} />
      <B p={[0, 1.6, 9.05]} s={[14, 2.6, 0.08]} c={GLASS} o={0.5} />
      {floors}
      {/* roof garden on the setback and on top */}
      {[
        [3.6, top - 2 * 3.2 + 0.4, 3.6],
        [-3.4, top + 0.4, 2.8],
        [2.6, top + 0.4, -3],
        [-6, 5.6, 6],
        [7, 5.6, 5.5],
      ].map(([x, y, z], i) => (
        <mesh key={i} position={[x, y + 1.1, z]}>
          <icosahedronGeometry args={[1.1, 0]} />
          <meshStandardMaterial color="#dfe8d6" roughness={1} flatShading />
          <Edges color={INK} threshold={15} />
        </mesh>
      ))}
    </group>
  );
}

function Spin({ active, children }: { active: boolean; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => {
    if (ref.current && active) ref.current.rotation.y += dt * 0.35;
  });
  return <group ref={ref}>{children}</group>;
}

export default function BuildingSketch({ typ, geschosse }: { typ: BauTyp; geschosse?: number }) {
  const [hover, setHover] = useState(false);
  return (
    <div className="h-full w-full" onPointerEnter={() => setHover(true)} onPointerLeave={() => setHover(false)}>
      <Canvas orthographic dpr={[1, 2]} camera={{ position: [60, 42, 60], zoom: 6, near: -500, far: 500 }} gl={{ antialias: true }}>
        <ambientLight intensity={1.6} />
        <directionalLight position={[30, 50, 20]} intensity={1.4} />
        <Bounds fit clip observe margin={1.12}>
          <Spin active={hover}>
            {typ === "oper" ? <Oper /> : typ === "turm" ? <Turm /> : <Wohnbau geschosse={geschosse} />}
          </Spin>
        </Bounds>
        <ContactShadows position={[0, -0.01, 0]} scale={120} blur={2.8} opacity={0.22} far={30} frames={1} />
      </Canvas>
    </div>
  );
}
