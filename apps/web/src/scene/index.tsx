import { Suspense, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Canvas } from '@react-three/fiber';
import { Html, Line, OrbitControls } from '@react-three/drei';
import { Object3D, Vector3 } from 'three';
import type { ObservedFire, RiskReport, WorldDefinition, WorldSnapshot } from '@ember/contracts';
import { landclassColors, latestReportsByRegion, staticMapKey, type RegionMapPrior, type ViewMode } from '../view-mode.js';
import { Base, Batch, Landscape, Terrain, cellPoint, elevation } from './landscape';
import { FireAndTreatment, Fleet } from './effects';
import './scene.css';

export interface SceneProps {
  definition: WorldDefinition;
  snapshot: WorldSnapshot;
  selectedIds: readonly string[];
  onSelect(id: string): void;
  reports?: readonly RiskReport[];
  incidents?: readonly ObservedFire[];
  mode?: ViewMode;
  mapPrior?: ReadonlyMap<string, RegionMapPrior>;
}

function CameraCompass() {
  const ref = useRef<HTMLDivElement>(null);
  const north = useMemo(() => new Vector3(0, 0, -1), []);
  const projected = useMemo(() => new Vector3(), []);
  useFrame(({ camera }) => {
    if (!ref.current) return;
    projected.copy(north).applyQuaternion(camera.quaternion.clone().invert());
    ref.current.style.transform = `rotate(${Math.atan2(projected.x, -projected.y)}rad)`;
  });
  return <Html fullscreen><div className="ember-compass-wrap"><div ref={ref} className="ember-compass"><b>N</b><i/><span>E</span><span>S</span><span>W</span></div></div></Html>;
}

export function ScenePreview({ definition, snapshot, selectedIds, onSelect, reports = [], incidents = [], mode = 'natural', mapPrior }: SceneProps) {
  const view = useMemo(() => {
    const width = definition.width * definition.cellSizeM, height = definition.height * definition.cellSizeM;
    const size = Math.max(width, height), x = width * .5, y = height * .49;
    return {
      size,
      target: [x, elevation(definition, x, y), -y] as [number, number, number],
      camera: [x + size * .38, size * .88, size * .98] as [number, number, number],
    };
  }, [definition]);
  const lightTarget = useMemo(() => {
    const target = new Object3D();
    target.position.set(...view.target);
    return target;
  }, [view]);
  return <div className="ember-scene" aria-label="Interactive three-dimensional wildfire ground-truth view">
    <Canvas key={definition.runId} shadows dpr={[1, 1.5]} camera={{ position: view.camera, fov: 43, near: 2, far: view.size * 9 }} gl={{ antialias: true, alpha: false }} fallback={<div className="ember-scene-fallback">3D view requires WebGL. Use the shared tactical view.</div>}>
      <color attach="background" args={['#d3ad79']} />
      <fog attach="fog" args={['#d3ad79', view.size * 1.5, view.size * 4.7]} />
      <hemisphereLight args={['#ffe6b3', '#63725a', 2]} />
      <ambientLight intensity={.35} color="#f6e1bf" />
      <primitive object={lightTarget} />
      <directionalLight position={[-view.size * .7, view.size * 1.2, view.size * .3]} target={lightTarget} intensity={3.2} color="#ffdc9c" castShadow shadow-mapSize={[2048, 2048]} shadow-camera-left={-view.size} shadow-camera-right={view.size} shadow-camera-top={view.size} shadow-camera-bottom={-view.size} shadow-camera-far={view.size * 4} shadow-normalBias={2} shadow-bias={-.0001} />
      <Suspense fallback={null}>
        {mode === 'jev' ? <>
          <Terrain world={definition} />
          <Base world={definition} />
          <MapLandclassOverlay definition={definition} />
          <KnownWaterLabel definition={definition} />
        </> : <>
          <Landscape world={definition} snapshot={snapshot} selectedIds={selectedIds} onSelect={onSelect} />
          <FireAndTreatment world={definition} snapshot={snapshot} />
        </>}
        {mode === 'thermal' && <ThermalOverlay definition={definition} snapshot={snapshot} />}
        {mode === 'jev' && <RegionalReports definition={definition} snapshot={snapshot} reports={reports} mapPrior={mapPrior} />}
        {incidents.map(fire => <group key={fire.id}>
          <Line points={[...fire.boundary, fire.boundary[0]!].map(p => [p.x, elevation(definition, p.x, p.y) + 8, -p.y] as [number, number, number])} color={selectedIds.includes(fire.id) ? '#fff4dc' : fire.status === 'fresh' ? '#ffb46f' : '#b0b4a5'} lineWidth={1.5} transparent opacity={0.8} />
          <Html position={[fire.centroid.x, elevation(definition, fire.centroid.x, fire.centroid.y) + 65, -fire.centroid.y]} center distanceFactor={1300} zIndexRange={[15, 1]}>
            <button className="ember-region-label" aria-pressed={selectedIds.includes(fire.id)} title={`Last burning observation ${fire.lastObservedSimSeconds.toFixed(1)}s sim; not the full fire front`} onClick={event => { event.stopPropagation(); onSelect(fire.id); }}>{fire.name}<small>OBSERVED EXTENT · {fire.status.toUpperCase()}</small></button>
          </Html>
        </group>)}
        <Fleet world={definition} snapshot={snapshot} selectedIds={selectedIds} onSelect={onSelect} />
      </Suspense>
      <OrbitControls makeDefault target={view.target} enableDamping dampingFactor={.08} minDistance={view.size * .18} maxDistance={view.size * 3} minPolarAngle={.15} maxPolarAngle={Math.PI * .47} />
      <CameraCompass />
    </Canvas>
    <div className="ember-scene-title"><b>WOODLAND EDGE</b><span>GROUND TRUTH · {definition.width} × {definition.height}</span></div>
    {mode === 'thermal' && <div className="ember-scene-mode">SIMULATED THERMAL · GROUND TRUTH · not real optics</div>}
    {mode === 'jev' && <><div className="ember-scene-mode">JEV REPORTS · observed classifications only · no report = unknown</div><div className="ember-map-prior-key">MAP PRIOR · RULES · KNOWN MAP / WEATHER{Object.entries(landclassColors).map(([key, color]) => <span key={key}><i style={{ background: color }}/>{key === 'wood_building' ? 'Wooden houses' : key === 'grass' ? 'Grass / open' : key[0]!.toUpperCase() + key.slice(1)}</span>)}</div></>}
    <div className="ember-scene-hint">Drag to orbit · Scroll to zoom · Right-drag to pan</div>
  </div>;
}

function ThermalOverlay({ definition, snapshot }: { definition: WorldDefinition; snapshot: WorldSnapshot }) {
  const cells = useMemo(() => snapshot.dynamicCells.flatMap((cell, index) => {
    if (cell.heat <= 0.02) return [];
    const [x, y, z] = cellPoint(definition, index);
    const intensity = cell.heat;
    return [{ position: [x, y + 2, z] as [number, number, number], scale: [definition.cellSizeM * .72, Math.max(2, intensity * 12), definition.cellSizeM * .72] as [number, number, number], color: intensity > .7 ? '#fff2b0' : intensity > .35 ? '#ff893e' : '#df3c28' }];
  }), [definition, snapshot.dynamicCells]);
  return <Batch items={cells} shape="box" />;
}

function MapLandclassOverlay({ definition }: { definition: WorldDefinition }) {
  const key = staticMapKey(definition);
  const cells = useMemo(() => definition.staticCells.map((cell, index) => {
    const [x, y, z] = cellPoint(definition, index);
    return { position: [x, y + .9, z] as [number, number, number], scale: [definition.cellSizeM * .98, 1.8, definition.cellSizeM * .98] as [number, number, number], color: landclassColors[cell.fuelClass] };
  }), [key]);
  return <Batch items={cells} shape="box" />;
}

function KnownWaterLabel({ definition }: { definition: WorldDefinition }) {
  const key = staticMapKey(definition);
  const position = useMemo(() => {
    const region = definition.regions.find(item => item.kind === 'water');
    if (!region) return null;
    const indices = definition.staticCells.flatMap((cell, index) => cell.regionId === region.id ? [index] : []);
    if (!indices.length) return null;
    const x = indices.reduce((sum, index) => sum + (index % definition.width + .5) * definition.cellSizeM, 0) / indices.length;
    const y = indices.reduce((sum, index) => sum + (Math.floor(index / definition.width) + .5) * definition.cellSizeM, 0) / indices.length;
    return [x, elevation(definition, x, y) + 12, -y] as [number, number, number];
  }, [key]);
  if (!position) return null;
  return <Html position={position} center distanceFactor={1000} style={{ pointerEvents: 'none' }}><span className="ember-world-label ember-water-label">KNOWN WATER · STATIC MAP</span></Html>;
}

function RegionalReports({ definition, snapshot, reports, mapPrior }: { definition: WorldDefinition; snapshot: WorldSnapshot; reports: readonly RiskReport[]; mapPrior?: ReadonlyMap<string, RegionMapPrior> }) {
  const byRegion = latestReportsByRegion(reports, snapshot.runId);
  const key = staticMapKey(definition);
  const markers = useMemo(() => definition.regions.filter(region => region.kind === 'forest' || region.kind === 'neighborhood').flatMap(region => {
    const cells = definition.staticCells.flatMap((cell, index) => cell.regionId === region.id ? [index] : []);
    if (!cells.length) return [];
    const x = cells.reduce((sum, index) => sum + (index % definition.width + .5) * definition.cellSizeM, 0) / cells.length;
    const y = cells.reduce((sum, index) => sum + (Math.floor(index / definition.width) + .5) * definition.cellSizeM, 0) / cells.length;
    return [{ region, x, y }];
  }), [key]);
  return <>{markers.map(({ region, x, y }) => {
    const report = byRegion.get(region.id);
    const prior = mapPrior?.get(region.id);
    const stale = report ? snapshot.simSeconds > report.validUntilSimSeconds : false;
    const status = report ? `${report.classification.replaceAll('_', ' ').toUpperCase()}${stale ? ' · STALE' : ''}` : 'NO REPORT · OBSERVED UNKNOWN';
    const details = report ? `${report.provider} · ${Math.max(0, Math.floor(snapshot.simSeconds - report.sampledAtSimSeconds))}s sim age · Sources: ${report.sourceDroneIds.join(', ') || 'none'} · Evidence: ${report.evidence.join('; ') || 'none'}` : 'No observed report';
    const sources = report?.sourceDroneIds ?? [];
    const evidence = report?.evidence ?? [];
    return <Html key={region.id} position={[x, elevation(definition, x, y) + 42, -y]} center distanceFactor={1000} zIndexRange={[20, 2]}>
      <div title={details} className={`ember-jev-marker ${report ? `risk-${report.classification}` : 'unknown'} ${stale ? 'stale' : ''}`}><b>{region.name}</b><small>MAP PRIOR · RULES · {prior?.band.toUpperCase() ?? 'UNKNOWN'}</small><small>OBSERVED · {status}</small>{prior && <small>{prior.source} · {prior.fuelCells} burnable cells · {prior.woodBuildings} wooden buildings · weather score {prior.score.toFixed(2)}</small>}{report && <small>{report.provider === 'rules' ? 'Observed by local rules fallback' : `Observed provider: ${report.provider}`} · {Math.max(0, Math.floor(snapshot.simSeconds - report.sampledAtSimSeconds))}s sim age<br/>Sources: {sources.slice(0, 3).join(', ') || 'none'}{sources.length > 3 ? ` +${sources.length - 3} more` : ''}<br/>Evidence: {evidence.slice(0, 2).join('; ') || 'none'}{evidence.length > 2 ? ` +${evidence.length - 2} more` : ''}</small>}</div>
    </Html>;
  })}</>;
}
