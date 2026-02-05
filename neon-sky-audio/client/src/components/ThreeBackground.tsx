import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

export type BackgroundType = "stars" | "snow" | "grid" | "orbs" | "circuit";

type BackgroundProps = {
  type: BackgroundType;
  color: string;
  multiColorPulse: boolean;
};

type PulseOptions = {
  baseColor: THREE.Color;
  multiColor: boolean;
  speed?: number;
};

const usePulseColor = ({ baseColor, multiColor, speed = 0.6 }: PulseOptions) => {
  const colorRef = useRef(baseColor.clone());
  const temp = useMemo(() => new THREE.Color(), []);
  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    if (multiColor) {
      const hue = (t * 0.08) % 1;
      const lightness = 0.45 + 0.15 * Math.sin(t * 1.4);
      temp.setHSL(hue, 0.65, lightness);
    } else {
      const pulse = 0.85 + 0.15 * Math.sin(t * speed * 2);
      temp.copy(baseColor).multiplyScalar(pulse);
    }
    colorRef.current.copy(temp);
  });
  return colorRef;
};

const FallingField = ({
  count,
  speed,
  size,
  spread,
  baseColor,
  multiColor,
}: {
  count: number;
  speed: number;
  size: number;
  spread: number;
  baseColor: THREE.Color;
  multiColor: boolean;
}) => {
  const materialRef = useRef<THREE.PointsMaterial | null>(null);
  const geometryRef = useRef<THREE.BufferGeometry | null>(null);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i += 1) {
      arr[i * 3] = (Math.random() - 0.5) * spread;
      arr[i * 3 + 1] = (Math.random() - 0.5) * spread;
      arr[i * 3 + 2] = (Math.random() - 0.5) * spread;
    }
    return arr;
  }, [count, spread]);

  const speeds = useMemo(
    () => Array.from({ length: count }, () => speed * (0.6 + Math.random() * 0.8)),
    [count, speed]
  );

  const pulseColor = usePulseColor({ baseColor, multiColor, speed: 0.5 });

  useFrame((_, delta) => {
    if (!materialRef.current) return;
    const arr = positions;
    for (let i = 0; i < count; i += 1) {
      const idx = i * 3 + 1;
      arr[idx] -= speeds[i] * delta;
      if (arr[idx] < -spread / 2) {
        arr[idx] = spread / 2;
        arr[i * 3] = (Math.random() - 0.5) * spread;
        arr[i * 3 + 2] = (Math.random() - 0.5) * spread;
      }
    }
    if (geometryRef.current) {
      geometryRef.current.attributes.position.needsUpdate = true;
    }
    materialRef.current.color.copy(pulseColor.current);
  });

  return (
    <points>
      <bufferGeometry ref={geometryRef}>
        <bufferAttribute
          attach="attributes-position"
          array={positions}
          count={positions.length / 3}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        ref={materialRef}
        size={size}
        color={baseColor}
        transparent
        opacity={0.85}
        depthWrite={false}
      />
    </points>
  );
};

const EngineeringGrid = ({ baseColor }: { baseColor: THREE.Color }) => {
  const gridRef = useRef<THREE.GridHelper | null>(null);
  const minorRef = useRef<THREE.GridHelper | null>(null);
  const planeRef = useRef<THREE.Mesh | null>(null);
  const pulseColor = usePulseColor({ baseColor, multiColor: true, speed: 0.4 });

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    const pulse = 0.2 + 0.15 * Math.sin(t * 0.8);
    if (gridRef.current && !Array.isArray(gridRef.current.material)) {
      gridRef.current.material.color.copy(pulseColor.current);
    }
    if (minorRef.current && !Array.isArray(minorRef.current.material)) {
      minorRef.current.material.color
        .copy(pulseColor.current)
        .offsetHSL(0.08, 0, 0.1);
    }
    if (planeRef.current && planeRef.current.material instanceof THREE.MeshBasicMaterial) {
      planeRef.current.material.color.copy(baseColor).offsetHSL(0, 0, pulse);
    }
  });

  return (
    <group rotation={[-Math.PI / 2.4, 0, 0]} position={[0, -1.5, 0]}>
      <mesh ref={planeRef} position={[0, 0.01, 0]}>
        <planeGeometry args={[26, 26]} />
        <meshBasicMaterial color={baseColor} transparent opacity={0.2} />
      </mesh>
      <gridHelper ref={gridRef} args={[26, 12, baseColor, baseColor]} />
      <gridHelper ref={minorRef} args={[26, 48, baseColor, baseColor]} />
    </group>
  );
};

const OrbCluster = ({
  baseColor,
  multiColor,
}: {
  baseColor: THREE.Color;
  multiColor: boolean;
}) => {
  const groupRef = useRef<THREE.Group | null>(null);
  const pulseColor = usePulseColor({ baseColor, multiColor, speed: 0.7 });

  useFrame(({ clock }) => {
    if (!groupRef.current) return;
    const t = clock.getElapsedTime();
    groupRef.current.rotation.y = t * 0.15;
    groupRef.current.children.forEach((child, idx) => {
      if (child instanceof THREE.Mesh) {
        const scale = 0.8 + 0.12 * Math.sin(t * 1.2 + idx);
        child.scale.setScalar(scale);
        const material = child.material as THREE.MeshStandardMaterial;
        material.emissive.copy(pulseColor.current);
        material.color.copy(pulseColor.current).offsetHSL(0, 0, -0.2);
      }
    });
  });

  const positions = useMemo(
    () =>
      Array.from({ length: 6 }, () => [
        (Math.random() - 0.5) * 6,
        (Math.random() - 0.5) * 3,
        (Math.random() - 0.5) * 6,
      ]),
    []
  );

  return (
    <group ref={groupRef}>
      {positions.map((pos, idx) => (
        <mesh key={idx} position={pos as [number, number, number]}>
          <sphereGeometry args={[0.6, 24, 24]} />
          <meshStandardMaterial
            color={baseColor}
            emissive={baseColor}
            emissiveIntensity={1.2}
            transparent
            opacity={0.9}
          />
        </mesh>
      ))}
    </group>
  );
};

const CircuitBloom = ({
  baseColor,
  multiColor,
}: {
  baseColor: THREE.Color;
  multiColor: boolean;
}) => {
  const meshRef = useRef<THREE.Mesh | null>(null);
  const pulseColor = usePulseColor({ baseColor, multiColor, speed: 0.5 });

  useFrame(({ clock }) => {
    if (!meshRef.current) return;
    const t = clock.getElapsedTime();
    meshRef.current.rotation.x = t * 0.2;
    meshRef.current.rotation.y = t * 0.25;
    const material = meshRef.current.material as THREE.MeshStandardMaterial;
    material.color.copy(pulseColor.current);
    material.emissive.copy(pulseColor.current);
  });

  return (
    <mesh ref={meshRef}>
      <torusKnotGeometry args={[2.5, 0.6, 140, 16]} />
      <meshStandardMaterial
        color={baseColor}
        emissive={baseColor}
        emissiveIntensity={1.1}
        wireframe
      />
    </mesh>
  );
};

const Scene = ({ type, color, multiColorPulse }: BackgroundProps) => {
  const baseColor = useMemo(() => new THREE.Color(color), [color]);

  return (
    <>
      <color attach="background" args={["#050506"]} />
      <ambientLight intensity={0.7} />
      <pointLight position={[6, 6, 6]} intensity={1.2} />
      {type === "stars" && (
        <FallingField
          count={520}
          speed={1.3}
          size={0.035}
          spread={16}
          baseColor={baseColor}
          multiColor={multiColorPulse}
        />
      )}
      {type === "snow" && (
        <FallingField
          count={380}
          speed={0.6}
          size={0.06}
          spread={12}
          baseColor={baseColor}
          multiColor={multiColorPulse}
        />
      )}
      {type === "grid" && <EngineeringGrid baseColor={baseColor} />}
      {type === "orbs" && (
        <OrbCluster baseColor={baseColor} multiColor={multiColorPulse} />
      )}
      {type === "circuit" && (
        <CircuitBloom baseColor={baseColor} multiColor={multiColorPulse} />
      )}
    </>
  );
};

export const ThreeBackground = ({ type, color, multiColorPulse }: BackgroundProps) => (
  <div className="fixed inset-0 z-0 pointer-events-none">
    <Canvas
      className="absolute inset-0"
      camera={{ position: [0, 0, 8], fov: 55 }}
      gl={{ antialias: true, alpha: true }}
      dpr={[1, 1.8]}
    >
      <Scene type={type} color={color} multiColorPulse={multiColorPulse} />
    </Canvas>
    <div className="absolute inset-0 bg-gradient-to-b from-black/40 via-black/30 to-black/70" />
  </div>
);
