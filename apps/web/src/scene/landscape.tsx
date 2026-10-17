import { useLayoutEffect, useMemo, useRef } from 'react';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldDefinition, WorldSnapshot } from '@ember/contracts';

export const noise = (n: number) => { const v = Math.sin(n * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
export function elevation(world: WorldDefinition, x: number, y: number) {
  const col = THREE.MathUtils.clamp(x / world.cellSizeM - 0.5, 0, world.width - 1);
  const row = THREE.MathUtils.clamp(y / world.cellSizeM - 0.5, 0, world.height - 1);
  const c = Math.floor(col), r = Math.floor(row);
  const at = (a: number, b: number) => world.staticCells[Math.min(world.height - 1, b) * world.width + Math.min(world.width - 1, a)]?.elevationM ?? 0;
  return THREE.MathUtils.lerp(THREE.MathUtils.lerp(at(c, r), at(c + 1, r), col - c), THREE.MathUtils.lerp(at(c, r + 1), at(c + 1, r + 1), col - c), row - r);
}
export function cellPoint(world: WorldDefinition, index: number): [number, number, number] {
  const x = (index % world.width + 0.5) * world.cellSizeM;
  const y = (Math.floor(index / world.width) + 0.5) * world.cellSizeM;
  return [x, elevation(world, x, y), -y];
}
type Instance = { position: [number, number, number]; scale: [number, number, number]; rotation?: number; color: string };
export function Batch({ items, shape, shadows = false }: { items: Instance[]; shape: 'cone' | 'box' | 'sphere' | 'cylinder'; shadows?: boolean }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const object = new THREE.Object3D(), color = new THREE.Color();
    items.forEach((item, i) => {
      object.position.set(...item.position); object.scale.set(...item.scale); object.rotation.set(0, item.rotation ?? 0, 0); object.updateMatrix();
      mesh.setMatrixAt(i, object.matrix); mesh.setColorAt(i, color.set(item.color));
    });
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items]);
  if (!items.length) return null;
  return <instancedMesh ref={ref} args={[undefined, undefined, items.length]} castShadow={shadows} receiveShadow>
    {shape === 'cone' ? <coneGeometry args={[1, 1, 5]} /> : shape === 'sphere' ? <icosahedronGeometry args={[1, 0]} /> : shape === 'cylinder' ? <cylinderGeometry args={[1, 1, 1, 6]} /> : <boxGeometry />}
    <meshStandardMaterial roughness={0.94} flatShading />
  </instancedMesh>;
}

export function Terrain({ world }: { world: WorldDefinition }) {
  const geometry = useMemo(() => {
    const w = world.width * world.cellSizeM, h = world.height * world.cellSizeM, margin = Math.max(w, h) * 1.3;
    const geo = new THREE.PlaneGeometry(w + margin * 2, h + margin * 2, 144, 144);
    geo.rotateX(-Math.PI / 2); geo.translate(w / 2, 0, -h / 2);
    const positions = geo.attributes.position!;
    const colors = [];
    const olive = new THREE.Color('#8a8b56'), ochre = new THREE.Color('#a19a67'), forest = new THREE.Color('#737d4f');
    for (let i = 0; i < positions.count; i++) {
      const x = positions.getX(i), y = -positions.getZ(i);
      const outside = Math.max(0, -x, x - w, -y, y - h);
      const hills = Math.min(1, outside / 210) * (60 + 100 * Math.sin(x / 420 + y / 670) ** 2 + 100 * Math.sin(y / 350 - x / 800) ** 2);
      positions.setY(i, elevation(world, x, y) + hills - Math.min(0.8, outside / 400));
      const color = olive.clone().lerp(ochre, noise(i + world.seed) * 0.42).lerp(forest, (Math.sin(x / 180) * Math.cos(y / 210) + 1) * 0.17);
      colors.push(color.r, color.g, color.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geo.computeVertexNormals();
    return geo;
  }, [world]);
  return <mesh geometry={geometry} receiveShadow><meshStandardMaterial vertexColors flatShading roughness={1} /></mesh>;
}

function WaterAndRoads({ world }: { world: WorldDefinition }) {
  const { water, roads } = useMemo(() => {
    const water: number[] = [], roads: Instance[] = [];
    world.staticCells.forEach((cell, i) => {
      if (cell.fuelClass === 'water') water.push(i);
      if (cell.fuelClass === 'road') { const p = cellPoint(world, i); roads.push({ position: [p[0], p[1] + 0.4, p[2]], scale: [world.cellSizeM + 0.2, 0.6, world.cellSizeM + 0.2], color: '#a59d7d' }); }
    });
    return { water, roads };
  }, [world]);
  const waterGeometry = useMemo(() => {
    const positions: number[] = [];
    const s = world.cellSizeM / 2;
    water.forEach(i => {
      const [x, y, z] = cellPoint(world, i);
      positions.push(x-s,y+1,z-s, x-s,y+1,z+s, x+s,y+1,z+s, x-s,y+1,z-s, x+s,y+1,z+s, x+s,y+1,z-s);
    });
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geo.computeVertexNormals(); return geo;
  }, [world, water]);
  return <>
    <mesh geometry={waterGeometry}><meshStandardMaterial color="#547f83" roughness={0.27} metalness={0.28} side={THREE.DoubleSide} /></mesh>
    <Batch items={roads} shape="box" />
    {water.length > 0 && <Html position={cellPoint(world,water[Math.floor(water.length/2)]!)} center distanceFactor={1300} style={{pointerEvents:'none'}}><span className="ember-world-label ember-water-label">KNOWN WATER</span></Html>}
  </>;
}

function Vegetation({ world, snapshot }: { world: WorldDefinition; snapshot: WorldSnapshot }) {
  const burnedKey = snapshot.dynamicCells.flatMap((cell, i) => cell.burnState === 'burned' ? [i] : []).join(',');
  const { crowns, trunks, rounded } = useMemo(() => {
    const crowns: Instance[] = [], trunks: Instance[] = [], rounded: Instance[] = [];
    world.staticCells.forEach((cell, i) => {
      if (cell.fuelClass !== 'forest' || noise(i + world.seed) < 0.15) return;
      const [cx,,cz] = cellPoint(world,i), s = world.cellSizeM;
      const count = noise(i * 3) > 0.65 ? 2 : 1;
      for (let j = 0; j < count; j++) {
        const n = i * 7 + j + world.seed, x = cx + (noise(n)-0.5)*s*.88, z = cz + (noise(n+1)-0.5)*s*.88;
        const y = elevation(world,x,-z), height = s*(0.8+noise(n+2)*1.2), radius = height*(0.19+noise(n+3)*0.08);
        const burned = snapshot.dynamicCells[i]?.burnState === 'burned';
        trunks.push({position:[x,y+height*.2,z],scale:[radius*.12,height*.4,radius*.12],color:burned?'#3e382e':'#65523a'});
        if (burned) continue;
        const color = ['#344b36','#3e5437','#4b603e','#586745','#3a503b'][Math.floor(noise(n+4)*5)]!;
        if (noise(n+5) > .96) rounded.push({position:[x,y+height*.65,z],scale:[radius*1.5,height*.4,radius*1.3],color:'#6f7544'});
        else for (let tier=0;tier<3;tier++) crowns.push({position:[x,y+height*(.43+tier*.2),z],scale:[radius*(1-tier*.23),height*.55,radius*(1-tier*.23)],rotation:noise(n+6)*6.28,color});
      }
    });
    // Distant silhouettes frame the world without adding simulated fuel or actors.
    const w=world.width*world.cellSizeM,h=world.height*world.cellSizeM;
    for(let i=0;i<900;i++) {
      const x=(noise(i+192)*2.8-.9)*w,y=(noise(i+915)*2.8-.9)*h;
      if(x>=-30&&x<=w+30&&y>=-30&&y<=h+30) continue;
      const outside=Math.max(0,-x,x-w,-y,y-h);
      const ground=elevation(world,x,y)+Math.min(1,outside/210)*(60+100*Math.sin(x/420+y/670)**2+100*Math.sin(y/350-x/800)**2);
      const size=30+noise(i+41)*25;
      crowns.push({position:[x,ground+size*.5,-y],scale:[size*.25,size,size*.25],color:'#556447'});
    }
    return {crowns,trunks,rounded};
  }, [world, burnedKey]);
  return <><Batch items={trunks} shape="cylinder" /><Batch items={crowns} shape="cone" shadows /><Batch items={rounded} shape="sphere" shadows /></>;
}

function Buildings({ world, snapshot, selectedIds, onSelect }: ScenePropsLocal) {
  const burnedKey = snapshot.dynamicCells.flatMap((cell, i) => cell.burnState === 'burned' ? [i] : []).join(',');
  const { walls, roofs } = useMemo(() => {
    const walls:Instance[]=[], roofs:Instance[]=[];
    world.staticCells.forEach((cell,i) => {
      if(cell.fuelClass!=='wood_building')return;
      const [x,y,z]=cellPoint(world,i), s=world.cellSizeM;
      const burned=snapshot.dynamicCells[i]?.burnState==='burned', h=s*(.36+noise(i)*.22), rotation=noise(i+44)>.5?Math.PI/2:0;
      walls.push({position:[x,y+h/2,z],scale:[s*.68,h,s*.55],rotation,color:burned?'#544c3e':['#ded5b5','#e6ddc2','#cfc9ac'][i%3]!});
      // A triangular prism is built below, so every building has a genuine pitched roof.
      roofs.push({position:[x,y+h,z],scale:[s*.82,s*.29,s*.69],rotation,color:burned?'#484238':['#815b43','#79634b','#9a7550'][i%3]!});
    }); return {walls,roofs};
  },[world,burnedKey]);
  const roofRef=useRef<THREE.InstancedMesh>(null);
  const roofGeometry=useMemo(()=>{
    const shape=new THREE.Shape();shape.moveTo(-.5,0);shape.lineTo(.5,0);shape.lineTo(0,1);shape.closePath();
    const geo=new THREE.ExtrudeGeometry(shape,{depth:1,bevelEnabled:false});geo.translate(0,0,-.5);return geo;
  },[]);
  useLayoutEffect(()=>{
    const mesh=roofRef.current;if(!mesh)return;
    const object=new THREE.Object3D(),color=new THREE.Color();
    roofs.forEach((item,i)=>{object.position.set(...item.position);object.scale.set(...item.scale);object.rotation.y=item.rotation??0;object.updateMatrix();mesh.setMatrixAt(i,object.matrix);mesh.setColorAt(i,color.set(item.color));});
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
  },[roofs]);
  return <><Batch items={walls} shape="box" shadows />{roofs.length>0&&<instancedMesh ref={roofRef} args={[roofGeometry,undefined,roofs.length]} castShadow receiveShadow><meshStandardMaterial roughness={.95} flatShading /></instancedMesh>}
    {world.regions.filter(r=>r.kind==='neighborhood').map(region=>{
      const indices=world.staticCells.flatMap((cell,i)=>cell.regionId===region.id?[i]:[]);if(!indices.length)return null;
      const points=indices.map(i=>cellPoint(world,i));
      const x=points.reduce((a,p)=>a+p[0],0)/points.length,z=points.reduce((a,p)=>a+p[2],0)/points.length;
      return <Html key={region.id} position={[x,elevation(world,x,-z)+65,z]} center distanceFactor={1500} zIndexRange={[8,0]}><button className={`ember-region-label ${selectedIds.includes(region.id)?'is-selected':''}`} onClick={()=>onSelect(region.id)}>{region.name.toUpperCase()}<small>WOODLAND COMMUNITY</small></button></Html>;
    })}
  </>;
}
type ScenePropsLocal={world:WorldDefinition;snapshot:WorldSnapshot;selectedIds:readonly string[];onSelect(id:string):void};

export function Base({ world }: { world: WorldDefinition }) {
  const {x,y}=world.base, ground=elevation(world,x,y);
  return <group position={[x,ground+1,-y]}>
    <mesh position={[0,1,0]} receiveShadow><boxGeometry args={[170,2,145]}/><meshStandardMaterial color="#a79c7c" roughness={1}/></mesh>
    <mesh position={[-27,12,-20]} castShadow receiveShadow><boxGeometry args={[65,24,30]}/><meshStandardMaterial color="#d7cfb5"/></mesh>
    <mesh position={[-27,25,-20]} castShadow><boxGeometry args={[70,4,35]}/><meshStandardMaterial color="#716c55"/></mesh>
    <mesh position={[-27,14,-4.5]}><boxGeometry args={[45,6,.8]}/><meshStandardMaterial color="#48656a"/></mesh>
    <mesh position={[24,7,-22]} castShadow><boxGeometry args={[20,14,27]}/><meshStandardMaterial color="#837d62"/></mesh>
    <mesh position={[-57,38,-35]} castShadow><cylinderGeometry args={[.9,1.5,75,6]}/><meshStandardMaterial color="#e4d7b9"/></mesh>
    <mesh position={[-57,76,-35]}><sphereGeometry args={[2.5,8,6]}/><meshBasicMaterial color="#ffd3a0"/></mesh>
    <mesh position={[-57,63,-35]} rotation={[0,0,.5]}><boxGeometry args={[17,1,1]}/><meshStandardMaterial color="#dbceb5"/></mesh>
    {Array.from({length:8},(_,i)=><group key={i} position={[(i%4-1.5)*36,2.2,20+Math.floor(i/4)*28]}>
      <mesh rotation={[-Math.PI/2,0,0]}><circleGeometry args={[17,40]}/><meshStandardMaterial color="#777b66" roughness={1}/></mesh>
      <mesh rotation={[-Math.PI/2,0,0]} position={[0,.2,0]}><ringGeometry args={[14.4,15.2,48]}/><meshBasicMaterial color={['#dc9782','#a4c9d1','#ddca88','#a9d19f','#c9ced9','#c4a0e2','#f0b9dc','#b7c7ff'][i]}/></mesh>
      <mesh position={[0,.3,0]}><boxGeometry args={[10,.3,1.2]}/><meshBasicMaterial color="#e0d7b3"/></mesh>
      <mesh position={[0,.3,0]}><boxGeometry args={[1.2,.3,10]}/><meshBasicMaterial color="#e0d7b3"/></mesh>
    </group>)}
    <Html position={[-10,42,18]} center distanceFactor={1350} style={{pointerEvents:'none'}}><span className="ember-world-label">COMMAND BASE <small>01 / LAUNCH & REFILL</small></span></Html>
  </group>;
}
export function Landscape(props: ScenePropsLocal) {
  return <><Terrain world={props.world}/><WaterAndRoads world={props.world}/><Vegetation world={props.world} snapshot={props.snapshot}/><Buildings {...props}/><Base world={props.world}/></>;
}
