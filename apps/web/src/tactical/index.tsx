import { useEffect, useRef, useState } from 'react';
import type { ObservedFire, RiskReport, WorldDefinition, WorldSnapshot } from '@ember/contracts';
import { landclassRgb, latestReportsByRegion, type RegionMapPrior, type ViewMode } from '../view-mode.js';
import { useCommands, type CommandHandler } from '../dashboard/commands.js';
import './tactical.css';

export interface TacticalProps {
  definition: WorldDefinition;
  snapshot: WorldSnapshot;
  selectedIds: readonly string[];
  onSelect(id: string): void;
  onCommand?: CommandHandler;
  targetPosition?: { x: number; y: number } | null;
  onTargetSelect?(position: { x: number; y: number }): void;
  reports?: readonly RiskReport[];
  incidents?: readonly ObservedFire[];
  mode?: ViewMode;
  mainView?: boolean;
  mapPrior?: ReadonlyMap<string, RegionMapPrior>;
}
const terrain = { water: [65, 99, 107], road: [137, 129, 103], grass: [111, 117, 74], forest: [55, 76, 49], wood_building: [176, 157, 117] } as const;
export function TacticalMap({ definition, snapshot, selectedIds, onSelect, onCommand, targetPosition, onTargetSelect, reports = [], incidents = [], mode = 'natural', mainView = false, mapPrior }: TacticalProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [ignite, setIgnite] = useState(false);
  const { send, feedback, pending } = useCommands(snapshot.runId, onCommand);
  useEffect(() => { setIgnite(false); }, [snapshot.runId]);
  useEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context) return;
    const pixels = context.createImageData(definition.width, definition.height);
    definition.staticCells.forEach((cell, index) => {
      const dynamic = snapshot.dynamicCells[index];
      const shade = 0.84 + Math.min(0.22, cell.elevationM / 300);
      let color: readonly number[] = terrain[cell.fuelClass].map(value => value * shade);
      if (mode === 'thermal') {
        const heat = dynamic?.heat ?? 0;
        color = cell.fuelClass === 'water' ? [35, 105, 145]
          : heat > 0.01 ? [Math.round(40 + heat * 215), Math.round(24 + heat * 65), Math.round(35 + (1 - heat) * 35)] : [24, 31, 39];
        if (dynamic?.protection) color = [Math.round(color[0]! * (1 - dynamic.protection) + 55 * dynamic.protection), Math.round(color[1]! * (1 - dynamic.protection) + 210 * dynamic.protection), Math.round(color[2]! * (1 - dynamic.protection) + 195 * dynamic.protection)];
      } else if (mode === 'jev') {
        color = landclassRgb[cell.fuelClass];
      }
      if (mode !== 'thermal' && mode !== 'jev' && dynamic) {
        const fuel = cell.initialFuel ? dynamic.fuel / cell.initialFuel : 1;
        color = color.map(value => value * (0.55 + 0.45 * fuel));
        if (dynamic.protection > 0) color = color.map((value, channel) => value * (1 - dynamic.protection * 0.7) + [82, 201, 189][channel]! * dynamic.protection * 0.7);
        if (dynamic.burnState === 'burned') color = [48, 43, 37];
        if (dynamic.burnState === 'burning') color = [255, 100 + dynamic.heat * 105, 48];
        else if (dynamic.heat > 0.15) color = color.map((value, channel) => value * (1 - dynamic.heat * 0.6) + [223, 109, 54][channel]! * dynamic.heat * 0.6);
      }
      const row = Math.floor(index / definition.width);
      const destination = ((definition.height - 1 - row) * definition.width + index % definition.width) * 4;
      pixels.data.set([...color, 255], destination);
    });
    context.putImageData(pixels, 0, 0);
  }, [definition, snapshot, mode]);
  const widthM = definition.width * definition.cellSizeM;
  const heightM = definition.height * definition.cellSizeM;
  const styleAt = (point: { x: number; y: number }) => ({ left: `${point.x / widthM * 100}%`, top: `${100 - point.y / heightM * 100}%` });
  const selectedDrones = snapshot.drones.filter(drone => selectedIds.includes(drone.id) || selectedIds.includes(drone.squadId));
  const reportsByRegion = latestReportsByRegion(reports, snapshot.runId);
  const regions = definition.regions.filter(region => region.kind === 'forest' || region.kind === 'neighborhood');
  const regionStatus = (regionId: string) => {
    const report = reportsByRegion.get(regionId);
    return report ? `${report.classification.replaceAll('_', ' ').toUpperCase()}${snapshot.simSeconds > report.validUntilSimSeconds ? ' · STALE' : ''}` : 'NO REPORT · OBSERVED UNKNOWN';
  };
  return <div className="tactical-map ec-tactical">
    <div className="ec-map-head"><b>GROUND TRUTH</b><details className="ec-ignite-controls"><summary>{ignite ? 'Cancel ignite' : 'Manual ignition'}</summary><button aria-pressed={ignite} onClick={() => setIgnite(!ignite)} title="Arm click-to-ignite; next terrain click submits ignition">{ignite ? 'Cancel ignite' : '+ Ignite'}</button></details></div>
    <div className={`ec-map-surface ${ignite ? 'is-armed' : ''}`} onClick={event => {
      const bounds = event.currentTarget.getBoundingClientRect();
      const column = Math.max(0, Math.min(definition.width - 1, Math.floor((event.clientX - bounds.left) / bounds.width * definition.width)));
      const row = Math.max(0, Math.min(definition.height - 1, Math.floor((1 - (event.clientY - bounds.top) / bounds.height) * definition.height)));
      const position = { x: (column + 0.5) * definition.cellSizeM, y: (row + 0.5) * definition.cellSizeM };
      if (ignite) { if (!pending) { void send({ type: 'ignite', position }); setIgnite(false); } }
      else onTargetSelect?.(position);
    }}>
      <canvas ref={canvas} width={definition.width} height={definition.height} aria-label="Full simulation ground truth: terrain, remaining fuel, heat and burned cells" role="img"/>
      <svg viewBox={`0 0 ${widthM} ${heightM}`} preserveAspectRatio="none" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: 1 }} aria-label="Locally observed fire footprints, not full fire fronts">
        {incidents.map(fire => <polygon key={fire.id} points={fire.boundary.map(p => `${p.x},${heightM - p.y}`).join(' ')} fill="none" stroke={selectedIds.includes(fire.id) ? '#fff4dc' : fire.status === 'fresh' ? '#ffb46f' : '#b0b4a5'} strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeDasharray={fire.status === 'fresh' ? undefined : '4 3'} style={{ pointerEvents: 'stroke', cursor: 'pointer' }} onClick={event => { event.stopPropagation(); onSelect(fire.id); }} />)}
      </svg>
      {incidents.map(fire => <button key={fire.id} className="ec-map-group" style={{ ...styleAt(fire.centroid), color: '#ffcf97' }} aria-pressed={selectedIds.includes(fire.id)} title={`${fire.name} · ${fire.status} · observed extent only · last burning observation ${fire.lastObservedSimSeconds.toFixed(1)}s sim`} onClick={event => { event.stopPropagation(); onSelect(fire.id); }}>{fire.name}<small>observed extent · {fire.status}</small></button>)}
      <span className="ec-north"><b>N ↑</b><i>E</i><i>S</i><i>W</i></span>
      <span className="ec-base" style={styleAt(definition.base)} title="Command Base · sole launch and refill site">⌂<small>Command Base</small></span>
      {definition.regions.filter(region => region.kind === 'water').map(region => {
        const cells = definition.staticCells.flatMap((cell, index) => cell.regionId === region.id ? [index] : []);
        if (!cells.length) return null;
        const x = cells.reduce((sum, index) => sum + index % definition.width + 0.5, 0) / cells.length * definition.cellSizeM;
        const y = cells.reduce((sum, index) => sum + Math.floor(index / definition.width) + 0.5, 0) / cells.length * definition.cellSizeM;
        return <span key={region.id} className="ec-water-label" style={styleAt({ x, y })}>KNOWN WATER</span>;
      })}
      {regions.map(region => {
        const cells = definition.staticCells.flatMap((cell, index) => cell.regionId === region.id ? [index] : []);
        if (!cells.length) return null;
        const x = cells.reduce((sum, index) => sum + index % definition.width + 0.5, 0) / cells.length * definition.cellSizeM;
        const y = cells.reduce((sum, index) => sum + Math.floor(index / definition.width) + 0.5, 0) / cells.length * definition.cellSizeM;
        if (mode === 'jev') {
          const report = reportsByRegion.get(region.id);
          const stale = report ? snapshot.simSeconds > report.validUntilSimSeconds : false;
          const prior = mapPrior?.get(region.id);
          const tooltip = `${prior?.source ?? 'MAP PRIOR UNAVAILABLE'} · ${prior?.band.toUpperCase() ?? 'UNKNOWN'} · ${prior?.fuelCells ?? 0} burnable cells, ${prior?.woodBuildings ?? 0} wooden buildings · ${report ? `${report.classification.replaceAll('_', ' ')}${stale ? ' · STALE' : ''} · ${report.provider === 'rules' ? 'local rules fallback' : report.provider} · ${Math.max(0, Math.floor(snapshot.simSeconds - report.sampledAtSimSeconds))}s sim age · Sources: ${report.sourceDroneIds.join(', ') || 'none'} · Evidence: ${report.evidence.join('; ') || 'none'}` : 'OBSERVED: NO REPORT · UNKNOWN'}`;
          return <span key={region.id} className={`ec-region-report ${report ? `risk-${report.classification}` : 'unknown'} ${stale ? 'stale' : ''}`} style={styleAt({ x, y })} title={tooltip}>{region.name}<b>MAP PRIOR · {prior?.band.toUpperCase() ?? 'UNKNOWN'}</b><b>OBSERVED · {regionStatus(region.id)}</b></span>;
        }
        return <span key={region.id} className="ec-region-label" style={styleAt({ x, y })}>{region.name}</span>;
      })}
      {snapshot.squads.map(squad => { const drones=snapshot.drones.filter(drone=>drone.squadId===squad.id); if(!drones.length)return null; const center={x:drones.reduce((sum,drone)=>sum+drone.position.x,0)/drones.length,y:drones.reduce((sum,drone)=>sum+drone.position.y,0)/drones.length}; const selected=selectedIds.includes(squad.id)||drones.some(drone=>selectedIds.includes(drone.id)); return <button key={squad.id} className={`ec-map-group ${selected?'is-selected':''}`} style={{...styleAt(center),color:({'group-1':'#ffac91','group-2':'#a2d1ed','group-3':'#f4d886','group-4':'#a9e3a2','group-5':'#d4d9e4','group-6':'#d0a6ee','group-7':'#f0b9dc','group-8':'#b7c7ff'} as Record<string,string>)[squad.id]??'#e9f5dd'}} onClick={event=>{event.stopPropagation();onSelect(squad.id);}} aria-pressed={selected} title={`${squad.name} group · ${drones.length} drones`}>{squad.name}<small>{drones.length}</small></button>; })}
      {snapshot.missions.filter(mission => selectedIds.includes(mission.squadId) || selectedDrones.some(drone => drone.squadId === mission.squadId)).map(mission => <span key={mission.id} className="ec-mission-target" title={`${mission.type} target, not travelled route`} style={styleAt(mission.target)}>◇</span>)}
      {targetPosition && <span className="ec-picked-target" style={styleAt(targetPosition)} title="Operator target">+</span>}
      {snapshot.drones.map(drone => <button key={drone.id} className={`ec-map-drone ${selectedDrones.includes(drone) ? 'is-selected' : ''}`} style={{ ...styleAt(drone.position), color: ({'group-1':'#ffac91','group-2':'#a2d1ed','group-3':'#f4d886','group-4':'#a9e3a2','group-5':'#d4d9e4','group-6':'#d0a6ee','group-7':'#f0b9dc','group-8':'#b7c7ff'} as Record<string,string>)[drone.squadId] ?? '#e9f5dd' }} onClick={event => { event.stopPropagation(); onSelect(drone.id); }} aria-pressed={selectedDrones.includes(drone)} title={`${drone.id} · ${drone.squadId} · ${drone.status} · payload ${Math.round(drone.payload * 100)}%`}>✦</button>)}
    </div>
    <div className="ec-map-key">{mode === 'thermal' ? <><b>SIMULATED THERMAL · GROUND TRUTH</b><span>Heat intensity</span><span>■ KNOWN WATER</span></> : mode === 'jev' ? <><b>JEV REPORTS · REGION-LEVEL</b><span>NO REPORT = UNKNOWN</span><span>● KNOWN WATER</span></> : <><span>● Fire</span><span>■ Burned</span><span>KNOWN WATER</span><span>Fuel shaded</span></>}</div>
    {mode === 'thermal' && <div className="ec-mode-label">SIMULATED THERMAL · GROUND TRUTH · not real optics</div>}
    {mode === 'jev' && <div className="ec-landclass-key" aria-label="Known mapped land classes"><b>KNOWN MAP CLASSES</b>{Object.entries(landclassRgb).map(([key, color]) => <span key={key}><i style={{ background: `rgb(${color.join(',')})` }}/>{key === 'wood_building' ? 'Wooden houses' : key === 'grass' ? 'Grass / open' : key[0]!.toUpperCase() + key.slice(1)}</span>)}</div>}
    {mode === 'jev' && mainView && <section className="ec-report-panel" aria-label="Map prior and latest regional observations"><b>MAP PRIOR · RULES · KNOWN MAP / WEATHER</b>{regions.map(region => { const prior = mapPrior?.get(region.id); const report = reportsByRegion.get(region.id); const stale = report ? snapshot.simSeconds > report.validUntilSimSeconds : false; return <article key={region.id}><strong>{region.name} · PRIOR {prior?.band.toUpperCase() ?? 'UNKNOWN'}</strong><span>OBSERVED · {regionStatus(region.id)}</span>{prior && <small>{prior.source} · fuel cells {prior.fuelCells} (forest {prior.forestCells}, grass {prior.grassCells}, wooden buildings {prior.woodBuildings}) · water {prior.waterCells} · roads {prior.roadCells} · weather-adjusted score {prior.score.toFixed(2)}</small>}{report && <small title={`Sources: ${report.sourceDroneIds.join(', ')} · Evidence: ${report.evidence.join('; ')}`}>{report.provider === 'rules' ? 'Observed classification: local rules fallback' : `Observed classification provider: ${report.provider}`} · {Math.max(0, Math.floor(snapshot.simSeconds - report.sampledAtSimSeconds))}s sim age<br/>Sources: {report.sourceDroneIds.slice(0, 3).join(', ') || 'none'}{report.sourceDroneIds.length > 3 ? ` +${report.sourceDroneIds.length - 3} more` : ''}<br/>Evidence: {report.evidence.slice(0, 2).join('; ') || 'none'}{report.evidence.length > 2 ? ` +${report.evidence.length - 2} more` : ''}</small>}{stale && <em>STALE OBSERVED REPORT</em>}</article>; })}<small>Map prior does not classify active fire. Known water is static map data, not optical detection.</small></section>}
    {ignite && <div className="ec-map-note">Click terrain to submit ignition</div>}
    {feedback && <div className={`ec-map-note ${feedback.status}`} role="status">{feedback.status}: {feedback.message}</div>}
  </div>;
}
