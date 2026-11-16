import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useEditor } from '../state/EditorContext';
import type { EnvelopeMapping, EnvelopeMode, PathCommand, VectorObject } from '../document/model';
import type { Point } from '../geometry/pathGeometry';
import type { Bounds, Matrix } from '../geometry/objectTransforms';
import { identity, inverse, matrixOf, multiply, selectionIds, transformPoint, translate } from '../geometry/objectTransforms';
import { bitmapEnvelopeMap, perspectiveSides, renderWarp, restoreWarp, storeWarp } from '../bitmap/bitmapEnvelope';
import { worldCommands } from '../geometry/worldGeometry';
import { canDeform, deformError, deformSources, withWorldGeometry, type EnvelopePreset } from '../geometry/deform';
import { addEnvelopeNode, applyEnvelope, commandSpace, deleteEnvelopeNode, envelopeFromShape, fitEnvelope, mapEnvelopeCommands, moveEnvelopeHandle, moveEnvelopeNodes, nearestOnEnvelope, presetEnvelope, rectEnvelope, segment, setNodeSmooth, setSegmentKind, signature, transformEnvelope, type EnvelopeShape } from '../geometry/envelope';

/** Opções da barra de propriedades do Envelope (modo, mapeamento, manter linhas) e nós escolhidos. */
type Settings = { mode: EnvelopeMode; mapping: EnvelopeMapping; keepLines: boolean; nodes: number; pick: null | 'copy' | 'create'; bitmap: boolean };
let settings: Settings = { mode: 'free', mapping: 'original', keepLines: false, nodes: 0, pick: null, bitmap: false };
const listeners = new Set<() => void>();
export const envelopeSettings = {
  get: () => settings,
  set: (patch: Partial<Settings>) => { const next = { ...settings, ...patch }; if ((Object.keys(patch) as (keyof Settings)[]).every(k => next[k] === settings[k])) return; settings = next; listeners.forEach(l => l()); },
  subscribe: (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; },
};
export const useEnvelopeSettings = () => useSyncExternalStore(envelopeSettings.subscribe, envelopeSettings.get);
export type EnvelopeAction = { preset?: EnvelopePreset } | { clear: true } | { reapply: true } | { node: 'add' | 'delete' | 'line' | 'curve' | 'cusp' | 'smooth' };
export const envelopeAction = (detail: EnvelopeAction) => window.dispatchEvent(new CustomEvent('vectorstudio:envelope', { detail }));

/** Sessão no espaço do envelope; `frame` leva esse espaço ao documento. */
type Session = { id: string; ids: string[]; sources: Map<string, PathCommand[]>; box: Bounds; shape: EnvelopeShape; frame: Matrix; produced: Map<string, string>; restored: boolean; image?: ImageState };
/** Envelope num bitmap: imagem original (carregada aos poucos), cópia reduzida para a prévia e quadro pendente. */
type ImageState = { original: string; mode?: EnvelopeMode; img: HTMLImageElement | null; small: HTMLCanvasElement | null; frame: number | null; pending: EnvelopeShape | null };
const originals = new Map<string, Promise<HTMLImageElement>>();
function loadOriginal(src: string): Promise<HTMLImageElement> {
  let p = originals.get(src);
  if (!p) {
    p = new Promise((resolve, reject) => { const image = new Image(); image.onload = () => resolve(image); image.onerror = () => reject(new Error('Não foi possível ler o bitmap.')); image.src = src; });
    originals.set(src, p);
    if (originals.size > 6) originals.delete(originals.keys().next().value!);
  }
  return p;
}
type Drag = { pointerId: number; start: Point; origin: EnvelopeShape } & ({ kind: 'nodes'; indices: number[] } | { kind: 'handle'; seg: number; which: 'c1' | 'c2' });
export type Modifiers = { shiftKey?: boolean; ctrlKey?: boolean; metaKey?: boolean };
const print = (o: VectorObject | undefined) => o ? `${o.type}|${o.x}|${o.y}|${o.width}|${o.height}|${(o.transform ?? []).join(',')}|${signature(o.commands)}|${o.src?.length ?? 0}` : '';

/** Envelope guardado e válido (a curva ainda é a que o envelope produziu). */
const validEnvelope = (o: VectorObject) => o.type === 'path' && !!o.envelope && o.envelope.check === signature(o.commands);

/** Bitmap (sem recorte) sozinho na seleção: envelope com perspectiva sobre a imagem. */
function imageTarget(objects: VectorObject[], selected: string[]) {
  const chosen = objects.filter(o => selected.includes(o.id) && !o.locked);
  return chosen.length === 1 && chosen[0].type === 'image' && chosen[0].src && !chosen[0].crop ? chosen[0] : null;
}
function buildImage(o: VectorObject): Session {
  const restored = restoreWarp(o), box = restored?.box ?? { x: o.x, y: o.y, width: o.width || 1, height: o.height || 1 };
  return { id: `${o.id}:${restored ? 'warp' : 'new'}`, ids: [o.id], sources: new Map(), box, shape: restored?.shape ?? rectEnvelope(box), frame: matrixOf(o), produced: new Map([[o.id, print(o)]]), restored: !!restored,
    image: { original: restored?.original ?? o.src!, mode: restored?.mode, img: null, small: null, frame: null, pending: null } };
}
function build(objects: VectorObject[], selected: string[]): Session | null {
  const image = imageTarget(objects, selected);
  if (image) return buildImage(image);
  const targets = objects.filter(o => selected.includes(o.id) && canDeform(o) && !o.locked);
  if (!targets.length) return null;
  const first = targets[0].envelope, ids = targets.map(o => o.id), produced = new Map(targets.map(o => [o.id, print(o)]));
  // Objeto que já tem envelope: retoma o envelope (nós, forma original e modo), como no CorelDRAW.
  if (first && targets.every(o => validEnvelope(o) && o.envelope!.id === first.id)) {
    try {
      const frame = multiply(commandSpace(targets[0]), first.frame), back = inverse(frame);
      const sources = new Map(targets.map(o => [o.id, mapEnvelopeCommands(o.envelope!.source, multiply(back, multiply(commandSpace(o), o.envelope!.frame)))]));
      return { id: first.id, ids, sources, box: first.box, shape: { nodes: first.nodes, corners: first.corners }, frame, produced, restored: true };
    } catch { /* matriz degenerada: começa um envelope novo */ }
  }
  const found = deformSources(objects, ids);
  return found ? { id: crypto.randomUUID(), ids: [...found.sources.keys()], sources: found.sources, box: found.box, shape: rectEnvelope(found.box), frame: identity(), produced, restored: false } : null;
}

/**
 * Ferramenta Envelope (CorelDRAW): clique num objeto para ver o envelope (nós nos cantos e no meio dos lados) e
 * arraste os nós. Modos reta, arco simples, arco duplo e sem restrições (alças, adicionar/excluir nós com duplo
 * clique); Ctrl move o nó oposto no mesmo sentido, Shift no sentido contrário. O envelope fica guardado no objeto
 * e volta a ser editável quando ele for escolhido de novo.
 */
export function useEnvelopeTool() {
  const { tool, document, selectedIds, setSelection, dispatch, beginEdit, commitEdit, setMessage, viewport, convertCurvesCommand } = useEditor();
  const active = tool === 'envelope', opts = useEnvelopeSettings();
  const session = useRef<Session | null>(null), drag = useRef<Drag | null>(null), chosen = useRef<number[]>([]), lastEdge = useRef(0), [, redraw] = useState(0);
  const objects = document.objects;
  const deformable = selectedIds.filter(id => objects.some(o => o.id === id && canDeform(o) && !o.locked));
  const imageId = imageTarget(objects, selectedIds)?.id;
  const valid = (s: Session | null) => !!s && s.image ? s.ids[0] === imageId && print(objects.find(o => o.id === imageId)) === s.produced.get(s.ids[0]) : !!s && !imageId && s.ids.length === deformable.length && deformable.every(id => s.sources.has(id)) && s.ids.every(id => print(objects.find(o => o.id === id)) === s.produced.get(id));
  if (active && !drag.current && !valid(session.current)) {
    const before = session.current; session.current = build(objects, selectedIds);
    // Mesmo envelope retomado (o documento foi atualizado): mantém os nós escolhidos.
    if (!session.current || session.current.id !== before?.id || session.current.shape.nodes.length !== before.shape.nodes.length) chosen.current = [];
  }
  if (!active) session.current = null;
  const s = active ? session.current : null;
  // Ao retomar um envelope, a barra mostra o modo e o mapeamento dele.
  const restoredId = s?.restored ? s.id : null;
  useEffect(() => {
    const env = restoredId ? objects.find(o => o.envelope?.id === restoredId)?.envelope : null;
    if (env) envelopeSettings.set({ mode: env.mode, mapping: env.mapping, keepLines: !!env.keepLines });
  }, [restoredId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { envelopeSettings.set({ nodes: active ? chosen.current.length : 0, bitmap: !!s?.image }); });
  // Bitmap: ao começar, modo reta (cantos em perspectiva, lados retos); retomado, o modo guardado. A original carrega em segundo plano.
  const imageSession = s?.image ? s.id : null;
  useEffect(() => {
    const ss = session.current; if (!ss?.image) return;
    envelopeSettings.set({ mode: ss.image.mode ?? 'line' });
    if (!ss.restored) setMessage('Envelope no bitmap: arraste os cantos para encaixar a imagem em perspectiva (ex.: numa parede). Os nós do meio curvam os lados.');
  }, [imageSession]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const ss = session.current; if (!ss?.image || ss.image.img) return;
    loadOriginal(ss.image.original).then(img => { if (ss.image) ss.image.img = img; }).catch((e: Error) => setMessage(e.message));
  });
  const latestObjects = useRef(objects); latestObjects.current = objects;
  /** Redesenha o bitmap no envelope (prévia reduzida durante o arraste; resolução original no fim). */
  function renderImage(ss: Session, shape: EnvelopeShape, final: boolean): VectorObject[] | null {
    const im = ss.image!, img = im.img, o = latestObjects.current.find(x => x.id === ss.ids[0]);
    if (!img || !o) return null;
    let source: CanvasImageSource = img, sw = img.naturalWidth, sh = img.naturalHeight;
    if (!final) {
      if (!im.small) { const k = Math.min(1, 900 / Math.max(sw, sh)), c = window.document.createElement('canvas'); c.width = Math.max(1, Math.round(sw * k)); c.height = Math.max(1, Math.round(sh * k)); c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height); im.small = c; }
      source = im.small; sw = im.small.width; sh = im.small.height;
    }
    const density = Math.sqrt((sw / ss.box.width) * (sh / ss.box.height));
    const { canvas, bounds } = renderWarp(source, sw, sh, bitmapEnvelopeMap(shape), density, final ? 4000 : 900, final ? 48 : 20);
    const src = canvas.toDataURL('image/png'), next: VectorObject = { ...o, x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height, src, warp: storeWarp(im.original, shape, ss.box, bounds, envelopeSettings.get().mode, src) };
    ss.shape = shape; ss.produced = new Map([[o.id, print(next)]]);
    return latestObjects.current.map(x => x.id === o.id ? next : x);
  }
  /** `commit`: etapa própria no Desfazer; `close`: termina o gesto (arraste) aberto com beginEdit. */
  function applyImage(ss: Session, shape: EnvelopeShape, how: 'preview' | 'commit' | 'close') {
    const im = ss.image!;
    ss.shape = shape;
    if (how === 'preview') {
      im.pending = shape;
      if (im.frame === null) im.frame = window.requestAnimationFrame(() => {
        im.frame = null; const pending = im.pending; im.pending = null;
        if (!pending || session.current !== ss) return;
        const next = renderImage(ss, pending, false); if (next) dispatch({ type: 'set-objects', objects: next });
      });
      return;
    }
    if (im.frame !== null) { window.cancelAnimationFrame(im.frame); im.frame = null; im.pending = null; }
    void (async () => {
      if (!im.img) im.img = await loadOriginal(im.original);
      const next = renderImage(ss, shape, true);
      if (how === 'commit') commitEdit();
      if (next) dispatch({ type: 'set-objects', objects: next });
      commitEdit(); redraw(n => n + 1);
    })().catch((e: Error) => { setMessage(e.message); if (how === 'close') commitEdit(); });
  }
  useEffect(() => { if (!active) envelopeSettings.set({ pick: null }); }, [active]);
  // Ferramenta escolhida com algo selecionado que não recebe envelope: o texto vira curvas na hora (como ao clicar
  // nele); bitmaps e objetos bloqueados avisam na barra de status, em vez de a ferramenta parecer não fazer nada.
  const selectionKey = selectedIds.join('|');
  useEffect(() => {
    if (!active || !selectedIds.length || session.current) return;
    const chosenObjects = objects.filter(o => selectedIds.includes(o.id));
    if (chosenObjects.some(o => o.type === 'text' && !o.locked) && !chosenObjects.some(o => canDeform(o) && !o.locked)) {
      const t = window.setTimeout(() => { void convertCurvesCommand().then(() => setMessage('Texto convertido em curvas para receber o envelope (Ctrl+Z desfaz).')); }, 0);
      return () => window.clearTimeout(t);
    }
    const error = deformError(objects, selectedIds);
    setMessage(chosenObjects.some(o => o.type === 'image' && o.crop) ? 'Envelope: bitmap recortado não recebe envelope; desfaça o recorte (ferramenta Forma) ou converta o recorte num PowerClip.' : chosenObjects.some(o => o.type === 'image') && chosenObjects.length > 1 ? 'Envelope: escolha um bitmap de cada vez.' : error ? `Envelope: ${error}` : 'Envelope: arraste os nós (quadrados azuis) para deformar.');
  }, [active, selectionKey]); // eslint-disable-line react-hooks/exhaustive-deps

  function apply(shape: EnvelopeShape, commit: boolean) {
    const ss = session.current; if (!ss) return;
    if (ss.image) { applyImage(ss, shape, commit ? 'commit' : 'preview'); return; }
    const { mode, mapping, keepLines } = envelopeSettings.get();
    try {
      const next = objects.map(o => {
        const source = ss.sources.get(o.id);
        if (!source || !ss.ids.includes(o.id)) return o;
        const p = withWorldGeometry(o, mapEnvelopeCommands(applyEnvelope(source, ss.box, shape, mapping, keepLines), ss.frame));
        return { ...p, envelope: { id: ss.id, source, nodes: shape.nodes, corners: shape.corners, box: ss.box, frame: multiply(translate(-p.x, -p.y), ss.frame), mode, mapping, ...(keepLines ? { keepLines: true } : {}), check: signature(p.commands) } };
      });
      ss.shape = shape; ss.produced = new Map(next.filter(o => ss.sources.has(o.id)).map(o => [o.id, print(o)]));
      if (commit) commitEdit();
      dispatch({ type: 'set-objects', objects: next });
      if (commit) commitEdit();
    } catch (e) { setMessage((e as Error).message); }
  }
  /** Limpar envelope: volta à forma de antes do envelope. */
  function clear() {
    const ss = session.current; if (!ss) return;
    if (ss.image) {
      const o = objects.find(x => x.id === ss.ids[0]); if (!o) return;
      const { warp: _w, ...rest } = o, original: VectorObject = { ...rest, src: ss.image.original, x: ss.box.x, y: ss.box.y, width: ss.box.width, height: ss.box.height };
      commitEdit(); dispatch({ type: 'set-objects', objects: objects.map(x => x.id === o.id ? original : x) }); commitEdit();
      session.current = null; chosen.current = []; setMessage('Envelope removido: bitmap original restaurado.'); return;
    }
    const next = objects.map(o => { const source = ss.sources.get(o.id); if (!source || !ss.ids.includes(o.id)) return o; const { envelope: _e, ...rest } = withWorldGeometry(o, mapEnvelopeCommands(source, ss.frame)); return rest as VectorObject; });
    commitEdit(); dispatch({ type: 'set-objects', objects: next }); commitEdit();
    session.current = null; chosen.current = []; setMessage('Envelope removido.');
  }
  useEffect(() => {
    const listen = (e: Event) => {
      const ss = session.current, d = (e as CustomEvent<EnvelopeAction>).detail;
      if (!ss) { setMessage(deformError(objects, selectedIds) ?? 'Selecione um objeto.'); return; }
      if ('clear' in d) { clear(); return; }
      if ('reapply' in d) { apply(ss.shape, true); return; }
      if ('preset' in d && d.preset) { chosen.current = []; apply(presetEnvelope(ss.box, d.preset), true); return; }
      if (!('node' in d)) return;
      const sel = chosen.current;
      if (!sel.length) { setMessage('Escolha um nó do envelope (clique nele; Shift adiciona).'); return; }
      if (d.node === 'add') { let shape = ss.shape; for (const i of [...sel].sort((a, b) => b - a)) shape = addEnvelopeNode(shape, i, 0.5); chosen.current = []; apply(shape, true); }
      else if (d.node === 'delete') { let shape: EnvelopeShape | null = ss.shape; for (const i of [...sel].sort((a, b) => b - a)) shape = shape && (deleteEnvelopeNode(shape, i) ?? shape); chosen.current = []; if (shape === ss.shape) setMessage('Os nós dos cantos não podem ser excluídos.'); else apply(shape!, true); }
      else if (d.node === 'line' || d.node === 'curve') apply(setSegmentKind(ss.shape, sel, d.node === 'curve'), true);
      else apply(setNodeSmooth(ss.shape, sel, d.node === 'smooth'), true);
      redraw(n => n + 1);
    };
    window.addEventListener('vectorstudio:envelope', listen);
    return () => window.removeEventListener('vectorstudio:envelope', listen);
  });
  const toEnv = (p: Point) => { const ss = session.current; return ss ? transformPoint(inverse(ss.frame), p) : p; };

  function down(target: Element, world: Point, pointerId: number, clickedId: string | null, mods: Modifiers = {}) {
    const ss = session.current, { mode, pick } = envelopeSettings.get(), p = toEnv(world);
    // Copiar propriedades do envelope / Criar envelope a partir de: o próximo clique escolhe o objeto de origem.
    if (pick && ss) {
      envelopeSettings.set({ pick: null });
      const from = objects.find(o => o.id === clickedId);
      if (!from || ss.ids.includes(from.id)) { setMessage('Nada foi copiado: clique em outro objeto.'); return false; }
      if (pick === 'copy') {
        if (!validEnvelope(from)) { setMessage('O objeto clicado não tem envelope.'); return false; }
        envelopeSettings.set({ mode: from.envelope!.mode, mapping: from.envelope!.mapping, keepLines: !!from.envelope!.keepLines });
        apply(fitEnvelope({ nodes: from.envelope!.nodes, corners: from.envelope!.corners }, from.envelope!.box, ss.box), true); return false;
      }
      if (from.type === 'text' || from.type === 'image') { setMessage('Clique numa curva, retângulo ou elipse para criar o envelope a partir dela.'); return false; }
      const shape = envelopeFromShape(mapEnvelopeCommands(worldCommands(from), inverse(ss.frame)), ss.box);
      if (!shape) { setMessage('Essa forma não serve de envelope.'); return false; }
      envelopeSettings.set({ mode: 'free' }); chosen.current = []; apply(shape, true); return false;
    }
    const node = target.closest('[data-env-node]')?.getAttribute('data-env-node');
    if (node != null && ss) {
      const i = Number(node), now = performance.now(), again = lastEdge.current && now - lastEdge.current < 400 && chosen.current.length === 1 && chosen.current[0] === i;
      lastEdge.current = now;
      // Duplo clique no nó: exclui (modo sem restrições), como no CorelDRAW.
      if (again && mode === 'free') { lastEdge.current = 0; const shape = deleteEnvelopeNode(ss.shape, i); if (shape) { chosen.current = []; apply(shape, true); } else setMessage('Os nós dos cantos não podem ser excluídos.'); redraw(n => n + 1); return false; }
      if (mods.shiftKey && mode === 'free') chosen.current = chosen.current.includes(i) ? chosen.current.filter(x => x !== i) : [...chosen.current, i];
      else if (!chosen.current.includes(i)) chosen.current = [i];
      if (!chosen.current.length) { redraw(n => n + 1); return false; }
      beginEdit(); drag.current = { kind: 'nodes', pointerId, start: p, origin: ss.shape, indices: [...chosen.current] }; redraw(n => n + 1); return true;
    }
    const handle = target.closest('[data-env-handle]')?.getAttribute('data-env-handle');
    if (handle && ss) { const [seg, which] = handle.split(':'); beginEdit(); drag.current = { kind: 'handle', pointerId, start: p, origin: ss.shape, seg: Number(seg), which: which as 'c1' | 'c2' }; return true; }
    if (target.closest('[data-env-edge]') && ss) {
      const now = performance.now(), again = now - lastEdge.current < 400; lastEdge.current = now;
      if (again) {
        lastEdge.current = 0;
        if (mode !== 'free') { setMessage('Para adicionar nós, use o modo sem restrições.'); return false; }
        const near = nearestOnEnvelope(ss.shape, p); chosen.current = [near.seg + 1]; apply(addEnvelopeNode(ss.shape, near.seg, near.t), true); redraw(n => n + 1);
      } else { chosen.current = []; redraw(n => n + 1); }
      return false;
    }
    if (clickedId) {
      const ids = selectionIds(objects, clickedId); setSelection(ids);
      if (objects.some(o => ids.includes(o.id) && o.type === 'text') && !objects.some(o => ids.includes(o.id) && canDeform(o))) {
        // O envelope precisa de curvas: o texto é convertido (Ctrl+Z desfaz).
        setTimeout(() => { void convertCurvesCommand().then(() => setMessage('Texto convertido em curvas para receber o envelope (Ctrl+Z desfaz).')); }, 0);
      } else if (!imageTarget(objects, ids)) { const error = deformError(objects, ids); if (error) setMessage(error); }
    } else { setSelection([]); chosen.current = []; }
    return false;
  }
  function move(world: Point, pointerId: number, mods: Modifiers = {}) {
    const d = drag.current; if (!d || d.pointerId !== pointerId || !session.current) return;
    const p = toEnv(world), { mode } = envelopeSettings.get();
    let shape = d.kind === 'handle' ? moveEnvelopeHandle(d.origin, d.seg, d.which, p) : moveEnvelopeNodes(d.origin, d.indices, { x: p.x - d.start.x, y: p.y - d.start.y }, mode, mods.ctrlKey || mods.metaKey ? 'same' : mods.shiftKey && d.indices.length === 1 ? 'mirror' : 'none');
    // Bitmap no modo reta: os nós do meio dos lados cujos cantos mudaram acompanham a perspectiva.
    if (session.current.image && mode === 'line' && d.kind === 'nodes') {
      const moved = d.origin.corners.flatMap((i, c) => shape.nodes[i].x !== d.origin.nodes[i].x || shape.nodes[i].y !== d.origin.nodes[i].y ? [c, (c + 3) % 4] : []);
      if (moved.length) shape = perspectiveSides(shape, moved);
    }
    apply(shape, false); redraw(n => n + 1);
  }
  function up(pointerId: number) {
    if (drag.current?.pointerId !== pointerId) return;
    drag.current = null;
    const ss = session.current;
    // Bitmap: ao soltar, a imagem é refeita na resolução original e o gesto vira uma etapa do Desfazer.
    if (ss?.image) { applyImage(ss, ss.image.pending ?? ss.shape, 'close'); return; }
    commitEdit(); redraw(n => n + 1);
  }

  const z = viewport.zoom;
  let element = null;
  if (s) {
    const w = transformEnvelope(s.shape, p => transformPoint(s.frame, p)), n = w.nodes.length;
    const d = w.nodes.map((_, i) => { const c = segment(w, i); return `${i ? '' : `M${c[0].x} ${c[0].y}`}C${c[1].x} ${c[1].y} ${c[2].x} ${c[2].y} ${c[3].x} ${c[3].y}`; }).join('') + 'Z';
    const handles = opts.mode === 'free' ? chosen.current.flatMap(i => {
      const out = segment(w, i), inn = segment(w, (i + n - 1) % n), node = w.nodes[i], list: [string, Point][] = [];
      if (w.nodes[i].c1) list.push([`${i}:c1`, out[1]]);
      if (w.nodes[(i + n - 1) % n].c2) list.push([`${(i + n - 1) % n}:c2`, inn[2]]);
      return list.map(([key, h]) => <g key={key}><line x1={node.x} y1={node.y} x2={h.x} y2={h.y} stroke="#1f6fd1" strokeWidth={1 / z} pointerEvents="none" /><circle data-env-handle={key} cx={h.x} cy={h.y} r={4 / z} fill="#ffffff" stroke="#1f6fd1" strokeWidth={1.2 / z} style={{ cursor: 'move' }} /></g>);
    }) : null;
    element = <g className="deform-handles envelope-handles">
      <path data-env-edge="" d={d} fill="none" stroke="transparent" strokeWidth={10 / z} style={{ cursor: opts.mode === 'free' ? 'copy' : 'default' }}><title>{opts.mode === 'free' ? 'Duplo clique: adicionar nó' : 'Envelope'}</title></path>
      <path d={d} fill="none" stroke="#1f6fd1" strokeWidth={1 / z} strokeDasharray={`${5 / z} ${3 / z}`} pointerEvents="none" />
      {handles}
      {w.nodes.map((p, i) => { const on = chosen.current.includes(i), corner = w.corners.includes(i); return <rect key={i} data-env-node={i} x={p.x - 4 / z} y={p.y - 4 / z} width={8 / z} height={8 / z} fill={on ? '#1f6fd1' : '#ffffff'} stroke={corner ? '#0b3d91' : '#1f6fd1'} strokeWidth={(corner ? 1.6 : 1.2) / z} style={{ cursor: 'move' }}><title>{corner ? 'Canto do envelope' : 'Nó do envelope'} · Ctrl: nó oposto junto · Shift: nó oposto espelhado{opts.mode === 'free' ? ' · Duplo clique: excluir' : ''}</title></rect>; })}
    </g>;
  }
  return { active, down, move, up, isDragging: () => drag.current !== null, element };
}
