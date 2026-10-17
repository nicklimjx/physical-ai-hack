import { useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Line } from '@react-three/drei';
import * as THREE from 'three';
import type { WorldDefinition, WorldSnapshot } from '@ember/contracts';
import { Batch, cellPoint, elevation, noise } from './landscape';

type ViewProps={world:WorldDefinition;snapshot:WorldSnapshot;selectedIds:readonly string[];onSelect(id:string):void};
type Drone=WorldSnapshot['drones'][number];
const flightAltitude=68;
const squadColor=(id:string)=>({'group-1':'#ff9a7c','group-2':'#a7e5ff','group-3':'#ffe1a0','group-4':'#a9e3a2','group-5':'#d4d9e4','group-6':'#d0a6ee','group-7':'#f0b9dc','group-8':'#b7c7ff'}[id]??'#e9f5dd');
function Aircraft({drone,world,selected,individualSelected,onSelect,paused}:{drone:Drone;world:WorldDefinition;selected:boolean;individualSelected:boolean;onSelect(id:string):void;paused:boolean}) {
  const group=useRef<THREE.Group>(null);
  const target=useMemo(()=>new THREE.Vector3(),[]);
  const altitude=drone.status==='ready'?8:flightAltitude;
  const position=useMemo(()=>new THREE.Vector3(drone.position.x,elevation(world,drone.position.x,drone.position.y)+altitude,-drone.position.y),[]);
  const history=useRef<[number,number,number][]>([]);
  const trail=useMemo(()=>{
    const p:[number,number,number]=[drone.position.x,elevation(world,drone.position.x,drone.position.y)+altitude,-drone.position.y];
    const last=history.current.at(-1);
    if(!last||Math.hypot(p[0]-last[0],p[2]-last[2])>.5)history.current.push(p);
    if(history.current.length>48)history.current.shift();
    return history.current.slice();
  },[drone.position.x,drone.position.y,altitude,world]);
  useFrame((_,delta)=>{
    if(!group.current)return;
    target.set(drone.position.x,elevation(world,drone.position.x,drone.position.y)+altitude,-drone.position.y);
    const moving=position.distanceToSquared(target)>1;
    if(!paused)position.lerp(target,1-Math.exp(-delta*8));
    else position.copy(target);
    group.current.position.copy(position);
    if(moving)group.current.rotation.y=THREE.MathUtils.lerp(group.current.rotation.y,Math.atan2(target.x-position.x,target.z-position.z),Math.min(1,delta*5));
  });
  const color=squadColor(drone.squadId);
  return <>
    {trail.length>1&&<Line points={trail} color={color} lineWidth={selected ? 1.6 : .8} transparent opacity={selected ? .6 : .28}/>}
    <group ref={group} position={position} onClick={event=>{event.stopPropagation();onSelect(drone.id);}}>
      <mesh castShadow><boxGeometry args={[5,2.2,8]}/><meshStandardMaterial color="#e2e1cc" roughness={.4}/></mesh>
      <mesh position={[0,-1.7,0]}><sphereGeometry args={[1.8,8,6]}/><meshStandardMaterial color="#3d4840"/></mesh>
      {[Math.PI/4,-Math.PI/4].map(angle=><mesh key={angle} rotation={[0,angle,0]}><boxGeometry args={[16,.65,1]}/><meshStandardMaterial color="#d4d8c6"/></mesh>)}
      {[-1,1].flatMap(x=>[-1,1].map(z=><mesh key={`${x}${z}`} position={[x*5.5,1,z*5.5]} rotation={[-Math.PI/2,0,0]}><ringGeometry args={[2.4,3.5,16]}/><meshStandardMaterial color="#71837b" transparent opacity={.65} side={THREE.DoubleSide}/></mesh>))}
      <mesh position={[0,2,0]}><sphereGeometry args={[selected?3.6:2.5,8,6]}/><meshBasicMaterial color={color}/></mesh>
      <mesh visible={false}><sphereGeometry args={[14,8,6]}/><meshBasicMaterial/></mesh>
      <Html center position={[0,selected?40:32,0]} distanceFactor={1200} zIndexRange={[12,0]}>
        <button className={`ember-aircraft-marker ${selected?'is-selected':''}`} style={{color,borderColor:color}} title={`${drone.id} / ${drone.squadId} / ${drone.status}`} aria-label={`Select ${drone.id}`} onClick={()=>onSelect(drone.id)}><i/>{individualSelected&&<span>{drone.id.toUpperCase()}<small>{drone.status} · {Math.round(drone.payload*100)}% payload</small></span>}</button>
      </Html>
    </group>
  </>;
}
export function Fleet({world,snapshot,selectedIds,onSelect}:ViewProps) {
  return <>{snapshot.drones.map(drone=><Aircraft key={drone.id} drone={drone} world={world} selected={selectedIds.includes(drone.id)||selectedIds.includes(drone.squadId)} individualSelected={selectedIds.includes(drone.id)} onSelect={onSelect} paused={snapshot.settings.paused}/>)}{snapshot.squads.map(squad=>{
    const drones=snapshot.drones.filter(drone=>drone.squadId===squad.id);if(!drones.length)return null;
    const x=drones.reduce((sum,drone)=>sum+drone.position.x,0)/drones.length,y=drones.reduce((sum,drone)=>sum+drone.position.y,0)/drones.length;
    const selected=selectedIds.includes(squad.id)||drones.some(drone=>selectedIds.includes(drone.id));
    return <Html key={squad.id} position={[x,elevation(world,x,y)+flightAltitude+50,-y]} center distanceFactor={1300} zIndexRange={[10,0]}><button className={`ember-group-badge ${selected?'is-selected':''}`} style={{borderColor:squadColor(squad.id)}} onClick={()=>onSelect(squad.id)}>{squad.name}<small>{drones.length} DRONES · GROUP</small></button></Html>;
  })}</>;
}

function useSoftTexture() {
  const texture=useMemo(()=>{
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=64;
    const context=canvas.getContext('2d')!;
    const gradient=context.createRadialGradient(32,32,0,32,32,32);
    gradient.addColorStop(0,'rgba(255,255,255,0.85)');gradient.addColorStop(.35,'rgba(255,255,255,0.55)');gradient.addColorStop(1,'rgba(255,255,255,0)');
    context.fillStyle=gradient;context.fillRect(0,0,64,64);
    return new THREE.CanvasTexture(canvas);
  },[]);
  useEffect(()=>()=>texture.dispose(),[texture]);return texture;
}
export function FireAndTreatment({world,snapshot}:{world:WorldDefinition;snapshot:WorldSnapshot}) {
  const fire=useRef<THREE.InstancedMesh>(null), smoke=useRef<THREE.InstancedMesh>(null),glow=useRef<THREE.InstancedMesh>(null);
  const clock=useRef(snapshot.simSeconds);
  const soft=useSoftTexture();
  const object=useMemo(()=>new THREE.Object3D(),[]),color=useMemo(()=>new THREE.Color(),[]);
  const {burning,protectedCells,burned}=useMemo(()=>{
    const burning:number[]=[],protectedCells:number[]=[],burned:number[]=[];
    snapshot.dynamicCells.forEach((cell,i)=>{
      if(cell.burnState==='burning')burning.push(i);
      if(cell.protection>0)protectedCells.push(i);
      if(cell.burnState==='burned')burned.push(i);
    });
    // Evenly sample a large front rather than concentrating the particle budget in one corner.
    return {burning:burning.filter((_,i)=>i%Math.max(1,Math.ceil(burning.length/160))===0),protectedCells,burned};
  },[snapshot.dynamicCells]);
  const particlesPerCell=8,smokePerCell=7;
  useFrame(({camera},delta)=>{
    if(!snapshot.settings.paused)clock.current+=Math.min(delta,.1)*snapshot.settings.speed;
    const t=clock.current,s=world.cellSizeM;
    burning.forEach((index,i)=>{
      const [x,y,z]=cellPoint(world,index),heat=snapshot.dynamicCells[index]?.heat??0;
      if(glow.current){object.position.set(x,y+2,z);object.rotation.set(-Math.PI/2,0,0);object.scale.set(s*2.2,s*2.2,1);object.updateMatrix();glow.current.setMatrixAt(i,object.matrix);}
      for(let j=0;j<particlesPerCell;j++){
        const n=i*particlesPerCell+j,seed=index*13+j,phase=(t*(.7+noise(seed)*.5)+noise(seed+5))%1;
        object.position.set(x+(noise(seed)-.5)*s*.9+snapshot.weather.windMps.x*phase,y+2+phase*s*(1.1+heat),z+(noise(seed+1)-.5)*s*.9-snapshot.weather.windMps.y*phase);
        const size=(1-phase)*s*(.3+noise(seed+2)*.3)+1;
        object.scale.set(size,size*(1.5+noise(seed+4)),size);
        object.rotation.set(0,t*.5+seed,0);object.updateMatrix();
        fire.current?.setMatrixAt(n,object.matrix);fire.current?.setColorAt(n,color.set(j%3===0?'#fff2a0':j%3===1?'#ffb330':'#ff5a17'));
      }
      for(let j=0;j<smokePerCell;j++){
        const n=i*smokePerCell+j,seed=index*9+j,phase=(t*.1+noise(seed+33))%1;
        const age=phase*12;
        object.position.set(x+snapshot.weather.windMps.x*age*3+Math.sin(seed+phase*4)*s*.35,y+12+phase*s*7,z-snapshot.weather.windMps.y*age*3+Math.cos(seed)*s*.4);
        object.quaternion.copy(camera.quaternion);
        const size=s*(1+phase*3);object.scale.set(size,size*1.2,1);object.updateMatrix();smoke.current?.setMatrixAt(n,object.matrix);
        const shade=.38+phase*.15;smoke.current?.setColorAt(n,color.setRGB(shade,shade*.98,shade*.9));
      }
    });
    for(const ref of [fire,smoke,glow])if(ref.current){ref.current.instanceMatrix.needsUpdate=true;if(ref.current.instanceColor)ref.current.instanceColor.needsUpdate=true;}
  });
  const treatment=useMemo(()=>protectedCells.map(index=>{
    const p=cellPoint(world,index),strength=snapshot.dynamicCells[index]!.protection;
    return {position:[p[0],p[1]+1.4,p[2]] as [number,number,number],scale:[world.cellSizeM*.82,.35,world.cellSizeM*.82] as [number,number,number],color:new THREE.Color('#7ab5a6').lerp(new THREE.Color('#7bd3cc'),strength*.5).getStyle()};
  }),[world,protectedCells,snapshot.dynamicCells]);
  const scars=useMemo(()=>burned.map(index=>{const p=cellPoint(world,index);return {position:[p[0],p[1]+.6,p[2]] as [number,number,number],scale:[world.cellSizeM,.4,world.cellSizeM] as [number,number,number],color:'#544d38'};}),[world,burned]);
  return <>
    <Batch items={scars} shape="box"/>
    <Treatment items={treatment}/>
    <ApplicationDrops world={world} snapshot={snapshot}/>
    {burning.length>0&&<>
      <instancedMesh ref={glow} args={[undefined,undefined,burning.length]} frustumCulled={false}>
        <planeGeometry/><meshBasicMaterial map={soft} color="#ff6c11" transparent opacity={.68} depthWrite={false} blending={THREE.AdditiveBlending}/>
      </instancedMesh>
      <instancedMesh ref={fire} args={[undefined,undefined,burning.length*particlesPerCell]} frustumCulled={false}>
        <icosahedronGeometry args={[.5,0]}/><meshBasicMaterial toneMapped={false}/>
      </instancedMesh>
      <instancedMesh ref={smoke} args={[undefined,undefined,burning.length*smokePerCell]} frustumCulled={false} renderOrder={2}>
        <planeGeometry/><meshBasicMaterial map={soft} transparent opacity={.27} depthWrite={false} side={THREE.DoubleSide}/>
      </instancedMesh>
      {burning.length<5&&burning.map(index=>{const p=cellPoint(world,index);return <pointLight key={index} position={[p[0],p[1]+15,p[2]]} color="#ff8b35" intensity={1400} distance={world.cellSizeM*5} decay={2}/>;})}
    </>}
  </>;
}
function ApplicationDrops({world,snapshot}:{world:WorldDefinition;snapshot:WorldSnapshot}) {
  const ref=useRef<THREE.InstancedMesh>(null);
  const previous=useRef(snapshot.dynamicCells);
  const drops=useRef<{index:number;age:number;seed:number}[]>([]);
  const object=useMemo(()=>new THREE.Object3D(),[]);
  useEffect(()=>{
    snapshot.dynamicCells.forEach((cell,index)=>{
      if(cell.protection>(previous.current[index]?.protection??cell.protection)+.005)
        for(let j=0;j<4;j++)drops.current.push({index,age:0,seed:index*4+j});
    });
    drops.current=drops.current.slice(-256);
    previous.current=snapshot.dynamicCells;
  },[snapshot.dynamicCells]);
  useFrame((_,delta)=>{
    const mesh=ref.current;if(!mesh)return;
    if(!snapshot.settings.paused)for(const drop of drops.current)drop.age+=delta*snapshot.settings.speed;
    drops.current=drops.current.filter(drop=>drop.age<1.3);
    mesh.count=drops.current.length;
    drops.current.forEach((drop,i)=>{
      const [x,y,z]=cellPoint(world,drop.index),spread=world.cellSizeM*.7;
      object.position.set(x+(noise(drop.seed)-.5)*spread,y+2+(1-drop.age/1.3)*(flightAltitude-2),z+(noise(drop.seed+18)-.5)*spread);
      object.scale.set(.7,2.7,.7);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);
    });
    mesh.instanceMatrix.needsUpdate=true;
  });
  return <instancedMesh ref={ref} args={[undefined,undefined,256]} count={0} frustumCulled={false}><sphereGeometry args={[1,4,4]}/><meshBasicMaterial color="#b0e6df" transparent opacity={.7}/></instancedMesh>;
}
function Treatment({items}:{items:{position:[number,number,number];scale:[number,number,number];color:string}[]}) {
  const ref=useRef<THREE.InstancedMesh>(null);
  useLayoutEffect(()=>{
    const mesh=ref.current;if(!mesh)return;
    const object=new THREE.Object3D(),color=new THREE.Color();
    items.forEach((item,i)=>{object.position.set(...item.position);object.rotation.set(-Math.PI/2,0,0);object.scale.set(item.scale[0],item.scale[2],1);object.updateMatrix();mesh.setMatrixAt(i,object.matrix);mesh.setColorAt(i,color.set(item.color));});
    mesh.instanceMatrix.needsUpdate=true;if(mesh.instanceColor)mesh.instanceColor.needsUpdate=true;mesh.computeBoundingSphere();
  },[items]);
  if(!items.length)return null;
  return <instancedMesh ref={ref} args={[undefined,undefined,items.length]}><ringGeometry args={[.4,.5,8]}/><meshBasicMaterial transparent opacity={.4} depthWrite={false} side={THREE.DoubleSide}/></instancedMesh>;
}
