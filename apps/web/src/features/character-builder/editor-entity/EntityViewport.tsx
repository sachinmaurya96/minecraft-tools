import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import {
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  EdgesGeometry,
  Euler,
  FrontSide,
  MeshLambertMaterial,
  NearestFilter,
  RGBAFormat,
  SRGBColorSpace,
  UnsignedByteType,
  Vector3,
  type PerspectiveCamera,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { EULER_ORDER, renderFrontView, type Atlas, type RenderBone, type RenderCube, type RenderModel } from '@blockwright/bedrock-export';
import type { Cube } from '@blockwright/shared';
import { Callout } from '../../../components/ui';
import { hasWebGL } from '../../../lib/webgl';
import { rgbaToCanvas } from '../services/references';

export type ViewPreset = 'front' | 'back' | 'left' | 'right' | 'top' | 'iso';
const D = Math.PI / 180;

/** Camera directions in the Blockbench frame: the entity faces north (-Z); its right side is +X. */
const VIEW_DIR: Record<ViewPreset, [number, number, number]> = {
  front: [0, 0, -1],
  back: [0, 0, 1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  top: [0, 1, 0.0001],
  iso: [0.8, 0.55, -1],
};

function cubeGeometry(cube: RenderCube, tw: number, th: number): BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const index: number[] = [];
  cube.faces.forEach((f, i) => {
    positions.push(...f.positions);
    for (let k = 0; k < 4; k++) uvs.push(f.uvs[k * 2]! / tw, f.uvs[k * 2 + 1]! / th);
    // corners are TL, TR, BL, BR; (TL, BL, TR) and (TR, BL, BR) wind counter-clockwise seen from outside
    const b = i * 4;
    index.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
  });
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function CubeMesh({ cube, model, material, selected, onSelect }: { cube: RenderCube; model: RenderModel; material: MeshLambertMaterial; selected: boolean; onSelect: () => void }) {
  const geometry = useMemo(() => cubeGeometry(cube, model.textureWidth, model.textureHeight), [cube, model.textureWidth, model.textureHeight]);
  const edges = useMemo(() => (selected ? new EdgesGeometry(geometry) : null), [geometry, selected]);
  useEffect(() => () => geometry.dispose(), [geometry]);
  useEffect(() => () => edges?.dispose(), [edges]);
  return (
    <group position={cube.position} rotation={new Euler(cube.rotation[0] * D, cube.rotation[1] * D, cube.rotation[2] * D, EULER_ORDER)}>
      <mesh
        geometry={geometry}
        material={material}
        onClick={(e) => {
          e.stopPropagation();
          onSelect();
        }}
      />
      {edges && (
        <lineSegments geometry={edges} renderOrder={10}>
          <lineBasicMaterial color="#f2c14e" depthTest={false} transparent />
        </lineSegments>
      )}
    </group>
  );
}

function BoneNode({
  bone,
  children,
  model,
  material,
  selectedIndex,
  onSelectIndex,
}: {
  bone: RenderBone;
  children: Map<string | undefined, RenderBone[]>;
  model: RenderModel;
  material: MeshLambertMaterial;
  selectedIndex: number;
  onSelectIndex: (i: number) => void;
}) {
  return (
    <group position={bone.position} rotation={new Euler(bone.rotation[0] * D, bone.rotation[1] * D, bone.rotation[2] * D, EULER_ORDER)}>
      {bone.cubes.map((c) => (
        <CubeMesh key={c.index} cube={c} model={model} material={material} selected={c.index === selectedIndex} onSelect={() => onSelectIndex(c.index)} />
      ))}
      {(children.get(bone.name) ?? []).map((b) => (
        <BoneNode key={b.name} bone={b} children={children} model={model} material={material} selectedIndex={selectedIndex} onSelectIndex={onSelectIndex} />
      ))}
    </group>
  );
}

function Controls({ target, distance, view }: { target: Vector3; distance: number; view: { preset: ViewPreset; nonce: number } }) {
  const { camera, gl, invalidate } = useThree();
  const ref = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const c = new OrbitControls(camera, gl.domElement);
    c.addEventListener('change', () => invalidate());
    ref.current = c;
    return () => c.dispose();
  }, [camera, gl, invalidate]);
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    const dir = new Vector3(...VIEW_DIR[view.preset]).normalize();
    camera.position.copy(target.clone().add(dir.multiplyScalar(distance)));
    (camera as PerspectiveCamera).near = distance / 100;
    (camera as PerspectiveCamera).far = distance * 20;
    (camera as PerspectiveCamera).updateProjectionMatrix();
    c.target.copy(target);
    c.update();
    invalidate();
  }, [view, target, distance, camera, invalidate]);
  return null;
}

function Scene({ model, atlas, selectedIndex, onSelectIndex, view, showGrid }: EntityViewportProps & { model: RenderModel }) {
  const texture = useMemo(() => {
    const t = new DataTexture(new Uint8Array(atlas.image.data), atlas.width, atlas.height, RGBAFormat, UnsignedByteType);
    t.magFilter = NearestFilter;
    t.minFilter = NearestFilter;
    t.generateMipmaps = false;
    t.colorSpace = SRGBColorSpace;
    t.needsUpdate = true;
    return t;
  }, [atlas]);
  const material = useMemo(
    () => new MeshLambertMaterial({ map: texture, side: FrontSide, alphaTest: atlas.hasTransparency ? 0.5 : 0, transparent: false }),
    [texture, atlas.hasTransparency],
  );
  useEffect(() => () => texture.dispose(), [texture]);
  useEffect(() => () => material.dispose(), [material]);
  const children = useMemo(() => {
    const m = new Map<string | undefined, RenderBone[]>();
    for (const b of model.bones) m.set(b.parent, [...(m.get(b.parent) ?? []), b]);
    return m;
  }, [model]);
  const { target, distance } = useMemo(() => {
    let min = new Vector3(Infinity, Infinity, Infinity);
    let max = new Vector3(-Infinity, -Infinity, -Infinity);
    // approximate bounds from bone pivots + cube corners (good enough for framing)
    const visit = (b: RenderBone, offset: Vector3) => {
      const o = offset.clone().add(new Vector3(...b.position));
      for (const c of b.cubes)
        for (const f of c.faces)
          for (let k = 0; k < 4; k++) {
            const p = new Vector3(f.positions[k * 3], f.positions[k * 3 + 1], f.positions[k * 3 + 2]).add(new Vector3(...c.position)).add(o);
            min = min.min(p);
            max = max.max(p);
          }
      for (const ch of children.get(b.name) ?? []) visit(ch, o);
    };
    for (const root of children.get(undefined) ?? []) visit(root, new Vector3());
    if (!Number.isFinite(min.x)) return { target: new Vector3(0, 1, 0), distance: 4 };
    const center = min.clone().add(max).multiplyScalar(0.5 / 16);
    const size = max.clone().sub(min).length() / 16;
    return { target: center, distance: Math.max(1.5, size * 1.6) };
  }, [model, children]);

  return (
    <>
      <ambientLight intensity={1.6} />
      <directionalLight position={[2, 5, -4]} intensity={1.2} />
      <directionalLight position={[-3, 2, 4]} intensity={0.5} />
      <Controls target={target} distance={distance} view={view} />
      <group scale={1 / 16}>
        {(children.get(undefined) ?? []).map((b) => (
          <BoneNode key={b.name} bone={b} children={children} model={model} material={material} selectedIndex={selectedIndex} onSelectIndex={onSelectIndex} />
        ))}
      </group>
      {showGrid && (
        <>
          <gridHelper args={[8, 8, '#5a6680', '#2f3648']} />
          <gridHelper args={[2, 32, '#3a4560', '#262c3b']} position={[0, 0.001, 0]} />
          <axesHelper args={[0.5]} />
        </>
      )}
    </>
  );
}

export interface EntityViewportProps {
  render: RenderModel;
  atlas: Atlas;
  selectedIndex: number;
  onSelectIndex: (i: number) => void;
  view: { preset: ViewPreset; nonce: number };
  showGrid: boolean;
  cubes: Cube[];
  bones: Parameters<typeof renderFrontView>[0]['bones'];
}

export function EntityViewport(props: EntityViewportProps) {
  const webgl = useMemo(hasWebGL, []);
  const fallback = useMemo(() => (webgl ? null : rgbaToCanvas(renderFrontView({ bones: props.bones, cubes: props.cubes }, props.atlas, 256)).toDataURL()), [webgl, props.atlas, props.cubes, props.bones]);
  if (!webgl) {
    return (
      <div>
        <Callout tone="warn" title="3D preview unavailable">
          Your browser has no WebGL. Below is a flat front view rendered from the export texture; editing and export still work.
        </Callout>
        {fallback && <img src={fallback} alt="Front view of the entity" className="mx-auto mt-2 w-64" style={{ imageRendering: 'pixelated' }} />}
      </div>
    );
  }
  return (
    <div className="px-inset h-[min(60vh,560px)] min-h-80 w-full" data-testid="entity-3d">
      <Canvas frameloop="demand" camera={{ fov: 40, position: [3, 2, -4] }} gl={{ preserveDrawingBuffer: true, antialias: true }} aria-label="3D preview of the entity. Drag to rotate, scroll or pinch to zoom, click a cube to select it.">
        <Scene {...props} model={props.render} />
      </Canvas>
    </div>
  );
}
