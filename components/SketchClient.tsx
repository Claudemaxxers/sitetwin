"use client";

import dynamic from "next/dynamic";
import type { BauTyp } from "./BuildingSketch";

const BuildingSketch = dynamic(() => import("./BuildingSketch"), { ssr: false, loading: () => null });

export default function SketchClient({ typ, geschosse }: { typ: BauTyp; geschosse?: number }) {
  return <BuildingSketch typ={typ} geschosse={geschosse} />;
}
