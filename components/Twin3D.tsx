"use client";

import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { ContactShadows, Edges, Environment, Html, Lightformer, OrbitControls, RoundedBox } from "@react-three/drei";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { ROOMS, WALLS, type Wall } from "@/lib/model";
import type { TwinState, WallStatus } from "@/lib/types";
import { CONFLICT_COLOR, STATUS_COLOR, STOPPED_COLOR } from "./ui";

const H = 2.7;
const INK = "#0c0a08";
const ORANGE = "#ee783b";
const CENTER = new THREE.Vector3(10, 0, 6);

export type WallMark = "conflict" | "stopped" | undefined;

/* ---------- one wall, rendered as its real build stage ---------- */

function StudFrame({ len, thick, tint }: { len: number; thick: number; tint: string }) {
  const studs = Math.max(2, Math.round(len / 0.62) + 1);
  const step = (len - 0.05) / (studs - 1);
  return (
    <group>
      {[0.03, H - 0.03].map((y) => (
        <mesh key={y} position={[0, y, 0]} castShadow>
          <boxGeometry args={[len, 0.05, thick]} />
          <meshStandardMaterial color="#c9c4bd" metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      {Array.from({ length: studs }, (_, i) => (
        <mesh key={i} position={[-len / 2 + 0.025 + i * step, H / 2, 0]} castShadow>
          <boxGeometry args={[0.05, H - 0.06, thick * 0.8]} />
          <meshStandardMaterial color="#d6d1ca" metalness={0.55} roughness={0.4} />
        </mesh>
      ))}
      {/* tinted glass skin so the stage colour reads from far away */}
      <mesh position={[0, H / 2, 0]}>
        <boxGeometry args={[len, H, thick * 0.5]} />
        <meshPhysicalMaterial color={tint} transparent opacity={0.16} roughness={0.15} transmission={0.2} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Services({ len, color }: { len: number; color: string }) {
  // conduits / pipes running through the studs + outlet boxes
  return (
    <group>
      {[0.45, 1.15].map((y, i) => (
        <mesh key={y} position={[0, y, 0]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[i ? 0.025 : 0.04, i ? 0.025 : 0.04, len - 0.1, 10]} />
          <meshStandardMaterial color={color} emissive={color} emissiveIntensity={0.25} roughness={0.3} />
        </mesh>
      ))}
      {[-0.3, 0.25].map((p) => (
        <mesh key={p} position={[p * len, 1.15, 0]} castShadow>
          <boxGeometry args={[0.09, 0.09, 0.07]} />
          <meshStandardMaterial color={color} roughness={0.4} />
        </mesh>
      ))}
    </group>
  );
}

function WallMesh({
  wall,
  status,
  mark,
  planned,
  selected,
  onSelect,
}: {
  wall: Wall;
  status: WallStatus;
  mark: WallMark;
  planned: boolean;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [x1, z1] = wall.from;
  const [x2, z2] = wall.to;
  const exterior = wall.kind === "Außenwand";
  const thick = exterior ? 0.3 : 0.16;
  const len = Math.hypot(x2 - x1, z2 - z1) + (exterior ? thick : 0);
  const angle = -Math.atan2(z2 - z1, x2 - x1);
  const solid = status === "closed" || status === "finished";
  const stageColor = STATUS_COLOR[status];
  const markColor = mark === "conflict" ? CONFLICT_COLOR : mark === "stopped" ? STOPPED_COLOR : null;

  const skin = useRef<THREE.MeshStandardMaterial>(null);
  const beam = useRef<THREE.Mesh>(null);
  const ring = useRef<THREE.Mesh>(null);
  const lift = useRef<THREE.Group>(null);

  useFrame(({ clock }, dt) => {
    const t = clock.elapsedTime;
    if (skin.current) skin.current.emissiveIntensity = mark === "conflict" ? 0.25 + 0.25 * Math.sin(t * 5) : 0;
    if (beam.current) {
      const m = beam.current.material as THREE.MeshBasicMaterial;
      m.opacity = 0.18 + 0.12 * Math.sin(t * 4);
    }
    if (ring.current) {
      const k = (t * 0.8) % 1;
      ring.current.scale.setScalar(0.6 + k * 2.2);
      (ring.current.material as THREE.MeshBasicMaterial).opacity = 0.7 * (1 - k);
    }
    if (lift.current) {
      const target = selected ? 0.12 : 0;
      lift.current.position.y += (target - lift.current.position.y) * Math.min(1, dt * 10);
    }
  });

  return (
    <group position={[(x1 + x2) / 2, 0, (z1 + z2) / 2]} rotation={[0, angle, 0]}>
      <group
        ref={lift}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(wall.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = "pointer";
        }}
        onPointerOut={() => (document.body.style.cursor = "")}
      >
        {solid ? (
          <RoundedBox args={[len, H, thick]} radius={0.025} smoothness={2} position={[0, H / 2, 0]} castShadow receiveShadow>
            <meshStandardMaterial
              ref={skin}
              color={markColor ?? (status === "finished" ? "#f7f5f2" : exterior ? "#d8d3cc" : "#e9e2d2")}
              emissive={CONFLICT_COLOR}
              emissiveIntensity={0}
              roughness={0.85}
            />
            <Edges color={selected ? ORANGE : "#b5afa7"} threshold={20} />
          </RoundedBox>
        ) : (
          <>
            <StudFrame len={len} thick={thick} tint={markColor ?? stageColor} />
            {(status === "installed" || status === "inspected") && <Services len={len} color={status === "inspected" ? STATUS_COLOR.inspected : STATUS_COLOR.installed} />}
            {/* hit target for thin frames */}
            <mesh position={[0, H / 2, 0]} visible={false}>
              <boxGeometry args={[len, H, Math.max(thick, 0.4)]} />
            </mesh>
            {markColor && (
              <mesh position={[0, H / 2, 0]}>
                <boxGeometry args={[len, H, thick * 0.55]} />
                <meshStandardMaterial ref={skin} color={markColor} emissive={markColor} transparent opacity={0.55} depthWrite={false} />
              </mesh>
            )}
          </>
        )}

        {/* status cap: the stage colour as a crisp line on top of every wall */}
        <mesh position={[0, H + 0.025, 0]}>
          <boxGeometry args={[len, 0.05, thick + 0.02]} />
          <meshStandardMaterial color={markColor ?? (status === "finished" ? INK : stageColor)} emissive={markColor ?? stageColor} emissiveIntensity={markColor ? 0.6 : 0.15} />
        </mesh>

        {planned && !solid && (
          <mesh position={[0, H / 2, thick / 2 + 0.03]}>
            <planeGeometry args={[len, H]} />
            <meshBasicMaterial color={ORANGE} transparent opacity={0.18} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
        )}
        {selected && (
          <mesh position={[0, H / 2, 0]}>
            <boxGeometry args={[len + 0.06, H + 0.06, thick + 0.06]} />
            <meshBasicMaterial color={ORANGE} wireframe transparent opacity={0.6} />
          </mesh>
        )}
      </group>

      {mark === "conflict" && (
        <>
          <mesh ref={beam} position={[0, H + 2.5, 0]}>
            <cylinderGeometry args={[0.05, 0.4, 5, 24, 1, true]} />
            <meshBasicMaterial color={CONFLICT_COLOR} transparent opacity={0.25} side={THREE.DoubleSide} depthWrite={false} />
          </mesh>
          <mesh ref={ring} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
            <ringGeometry args={[0.9, 1.0, 48]} />
            <meshBasicMaterial color={CONFLICT_COLOR} transparent depthWrite={false} />
          </mesh>
        </>
      )}

      {(selected || mark) && (
        <Html position={[0, H + (mark === "conflict" ? 1.2 : 0.6), 0]} center zIndexRange={[20, 0]}>
          <div
            style={{
              fontFamily: "var(--font-mono), monospace",
              fontSize: 11,
              letterSpacing: ".04em",
              textTransform: "uppercase",
              background: markColor ?? INK,
              color: "#fff",
              padding: "3px 8px",
              borderRadius: 3,
              whiteSpace: "nowrap",
              boxShadow: "0 4px 14px rgba(12,10,8,.18)",
              pointerEvents: "none",
            }}
          >
            {wall.label}
            {mark === "conflict" ? " · Konflikt" : mark === "stopped" ? " · Gestoppt" : ""}
          </div>
        </Html>
      )}
    </group>
  );
}

/* ---------- scene pieces ---------- */

function Slab() {
  return (
    <group>
      <RoundedBox args={[20.8, 0.3, 12.8]} radius={0.04} position={[10, -0.15, 6]} receiveShadow>
        <meshStandardMaterial color="#efece8" roughness={0.95} />
      </RoundedBox>
      {ROOMS.map((r) => (
        <mesh key={r.id} rotation={[-Math.PI / 2, 0, 0]} position={[r.x + r.w / 2, 0.006, r.y + r.d / 2]} receiveShadow>
          <planeGeometry args={[r.w - 0.2, r.d - 0.2]} />
          <meshStandardMaterial color={r.id === "EG-R-1.01" ? "#e7e3dd" : "#f4f1ed"} roughness={1} />
        </mesh>
      ))}
    </group>
  );
}

function RoomLabels() {
  return (
    <>
      {ROOMS.map((r) => {
        const [word, num] = r.name.split(" ");
        return (
          <Html key={r.id} position={[r.x + r.w / 2, 0.02, r.y + r.d / 2]} center zIndexRange={[5, 0]}>
            <div style={{ textAlign: "center", pointerEvents: "none", whiteSpace: "nowrap" }}>
              <div style={{ fontFamily: "var(--font-mono), monospace", fontSize: 10, color: "#9a938b", letterSpacing: ".05em" }}>{num}</div>
              <div style={{ fontSize: 13, color: "#3b3631" }}>{word}</div>
            </div>
          </Html>
        );
      })}
    </>
  );
}

/** Fly-in: start high and far, settle into the isometric view. */
function Intro() {
  const { camera } = useThree();
  const t0 = useRef<number | null>(null);
  const from = useMemo(() => new THREE.Vector3(10, 55, 50), []);
  const to = useMemo(() => new THREE.Vector3(27, 21, 27), []);
  useFrame(({ clock }) => {
    if (t0.current === null) t0.current = clock.elapsedTime;
    const k = Math.min(1, (clock.elapsedTime - t0.current) / 2.2);
    if (k >= 1) return;
    const e = 1 - Math.pow(1 - k, 3);
    camera.position.lerpVectors(from, to, e);
    (camera as THREE.OrthographicCamera).zoom = 14 + e * 14;
    camera.lookAt(CENTER);
    camera.updateProjectionMatrix();
  });
  return null;
}

export default function Twin3D({
  twin,
  marks,
  selected,
  onSelect,
}: {
  twin: TwinState;
  marks: Record<string, WallMark>;
  selected: string | null;
  onSelect: (id: string | null) => void;
}) {
  return (
    <Canvas
      orthographic
      shadows
      dpr={[1, 2]}
      camera={{ position: [27, 21, 27], zoom: 28, near: -100, far: 200 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping }}
      onPointerMissed={() => onSelect(null)}
    >
      <Intro />
      <ambientLight intensity={0.35} />
      <directionalLight
        position={[18, 26, 8]}
        intensity={2.2}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-16}
        shadow-camera-right={16}
        shadow-camera-top={16}
        shadow-camera-bottom={-16}
        shadow-bias={-0.0004}
      />
      {/* procedural studio light, no HDR download */}
      <Environment resolution={256}>
        <Lightformer intensity={2} position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[20, 20, 1]} />
        <Lightformer intensity={1} position={[-10, 3, 5]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} />
        <Lightformer intensity={0.8} color="#ffd9c2" position={[10, 3, -5]} rotation-y={-Math.PI / 2} scale={[10, 4, 1]} />
      </Environment>

      <OrbitControls target={CENTER} enableDamping maxPolarAngle={Math.PI / 2.2} minZoom={18} maxZoom={90} />

      <Slab />
      <ContactShadows position={[10, -0.31, 6]} scale={34} blur={2.6} opacity={0.35} far={4} />
      <RoomLabels />

      {WALLS.map((w) => (
        <WallMesh
          key={w.id}
          wall={w}
          status={twin[w.id]?.status ?? "open"}
          mark={marks[w.id]}
          planned={!!twin[w.id]?.closePlanned}
          selected={selected === w.id}
          onSelect={onSelect}
        />
      ))}
    </Canvas>
  );
}
