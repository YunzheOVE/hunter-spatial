"use client";

import { Html, OrbitControls, useGLTF } from "@react-three/drei";
import { Canvas, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import {
  getBuilding,
  getCampusGltf,
  getFloorView,
  type Room,
} from "@/lib/campus";

type Props = {
  buildingId: string | null;
  floor: number | null;
  selectedRoom?: Room;
};

export function CampusCanvas({ buildingId, floor, selectedRoom }: Props) {
  return (
    <Canvas
      camera={{ position: [80, 90, -120], fov: 45, near: 0.1, far: 2000 }}
      gl={{ antialias: true }}
      style={{ width: "100%", height: "100%", background: "#0e1117" }}
    >
      <color attach="background" args={["#0e1117"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[80, 140, 40]} intensity={1.2} />
      <directionalLight position={[-60, 40, -80]} intensity={0.35} />
      <Suspense fallback={null}>
        <CampusMeshes buildingId={buildingId} floor={floor} selectedRoom={selectedRoom} />
      </Suspense>
      <gridHelper args={[400, 40, "#2a3140", "#1c2230"]} position={[80, 0, 40]} />
      <OrbitControls
        makeDefault
        target={[80, 20, 80]}
        maxPolarAngle={Math.PI / 2.05}
        minDistance={20}
        maxDistance={400}
      />
      <CameraRig buildingId={buildingId} />
    </Canvas>
  );
}

function CameraRig({ buildingId }: { buildingId: string | null }) {
  const controls = useThree((state) => state.controls) as { target: THREE.Vector3; update: () => void } | null;
  const building = buildingId ? getBuilding(buildingId) : undefined;

  useEffect(() => {
    if (!controls) return;
    if (building) {
      controls.target.set(building.center[0], 18, building.center[1]);
    } else {
      controls.target.set(80, 20, 80);
    }
    controls.update();
  }, [building, controls]);

  return null;
}

function CampusMeshes({ buildingId, floor, selectedRoom }: Props) {
  const { scene } = useGLTF(getCampusGltf());
  const cloned = useMemo(() => scene.clone(true), [scene]);
  const building = buildingId ? getBuilding(buildingId) : undefined;
  const floorView = buildingId && floor ? getFloorView(buildingId, floor) : null;
  const isolating = Boolean(floorView);

  useEffect(() => {
    cloned.traverse((obj) => {
      const mesh = obj as THREE.Mesh;
      if (!mesh.isMesh) return;
      const material = mesh.material as THREE.MeshStandardMaterial;
      const named = mesh.name || mesh.parent?.name || "";
      const isSelected = buildingId ? named.includes(`building-${buildingId}`) : true;
      const next = material.clone();
      next.transparent = isolating;
      next.opacity = isolating ? (isSelected ? 0.18 : 0.06) : 1;
      mesh.material = next;
    });
  }, [cloned, buildingId, isolating]);

  return (
    <group>
      <primitive object={cloned} />
      {floorView && building ? (
        <FloorPlate
          footprint={building.footprint}
          y={(floorView.level - 1) * building.floorHeight}
          color={building.color}
        />
      ) : null}
      {floorView?.kind === "scan" ? (
        <Suspense fallback={null}>
          <ScanModel
            url={floorView.scan.url}
            position={floorView.scan.position}
            rotationY={floorView.scan.rotationY}
            scale={floorView.scan.scale}
          />
        </Suspense>
      ) : null}
      {selectedRoom ? <DoorMarker room={selectedRoom} /> : null}
    </group>
  );
}

function FloorPlate({
  footprint,
  y,
  color,
}: {
  footprint: number[][];
  y: number;
  color: string;
}) {
  const geometry = useMemo(() => {
    const shape = new THREE.Shape();
    footprint.forEach((point, index) => {
      if (index === 0) shape.moveTo(point[0], point[1]);
      else shape.lineTo(point[0], point[1]);
    });
    const geom = new THREE.ShapeGeometry(shape);
    geom.rotateX(-Math.PI / 2);
    return geom;
  }, [footprint]);

  return (
    <mesh geometry={geometry} position={[0, y + 0.05, 0]}>
      <meshStandardMaterial color={color} transparent opacity={0.85} side={THREE.DoubleSide} />
    </mesh>
  );
}

function ScanModel({
  url,
  position,
  rotationY,
  scale,
}: {
  url: string;
  position: number[];
  rotationY: number;
  scale: number;
}) {
  const { scene } = useGLTF(url);
  const cloned = useMemo(() => scene.clone(true), [scene]);
  return (
    <primitive
      object={cloned}
      position={position as [number, number, number]}
      rotation={[0, rotationY, 0]}
      scale={scale}
    />
  );
}

function DoorMarker({ room }: { room: Room }) {
  const [x, y, z] = room.doorPosition;
  return (
    <group position={[x, y, z]}>
      <mesh position={[0, 1.2, 0]}>
        <coneGeometry args={[0.6, 1.8, 10]} />
        <meshStandardMaterial color="#e2b857" emissive="#e2b857" emissiveIntensity={0.4} />
      </mesh>
      <Html center distanceFactor={40} position={[0, 3.2, 0]}>
        <div className="rounded bg-[#12141a]/90 px-2 py-1 font-sans text-xs whitespace-nowrap text-[#e2b857]">
          {room.id}
        </div>
      </Html>
    </group>
  );
}

useGLTF.preload("/models/campus.glb");
