// Remover fundo com IA (IS-Net, Apache-2.0) pelo onnxruntime-node (MIT), no processo principal do Electron.
// A janela manda a imagem já reduzida a 1024×1024 em RGB normalizado (CHW, float32); aqui só roda o modelo.
// Tenta a placa de vídeo (DirectML) e, se não der, usa o processador. A sessão fica carregada entre usos.
const fs = require('node:fs');
const path = require('node:path');

const SIZE = 1024;
let session = null, provider = '', loading = null;
function modelPath() {
  const roots = [process.resourcesPath && path.join(process.resourcesPath, 'models'), path.join(__dirname, '..', 'vendor', 'models')].filter(Boolean);
  for (const root of roots) { const file = path.join(root, 'isnet-general-use.onnx'); if (fs.existsSync(file)) return file; }
  return null;
}
async function load() {
  if (session) return session;
  if (loading) return loading;
  loading = (async () => {
    const file = modelPath();
    if (!file) throw new Error('O modelo de IA para remover fundo não está instalado com o GFX Studio.');
    const ort = require('onnxruntime-node');
    for (const executionProviders of [['dml'], ['cpu']]) {
      try { session = await ort.InferenceSession.create(file, { executionProviders, graphOptimizationLevel: 'all' }); provider = executionProviders[0]; return session; }
      catch (error) { if (executionProviders[0] === 'cpu') throw error; }
    }
    throw new Error('Não foi possível carregar o modelo de IA.');
  })();
  try { return await loading; } finally { loading = null; }
}
const available = () => !!modelPath();
/** `input`: Float32Array com 3×1024×1024 valores. Devolve a máscara 1024×1024 normalizada de 0 a 1. */
async function run(input) {
  if (!(input instanceof Float32Array) || input.length !== 3 * SIZE * SIZE) throw new Error('Imagem inválida para o modelo.');
  const s = await load(), ort = require('onnxruntime-node');
  const feeds = { [s.inputNames[0]]: new ort.Tensor('float32', input, [1, 3, SIZE, SIZE]) };
  const out = (await s.run(feeds))[s.outputNames[0]].data;
  let min = Infinity, max = -Infinity;
  for (let i = 0; i < SIZE * SIZE; i++) { const v = out[i]; if (v < min) min = v; if (v > max) max = v; }
  const mask = new Float32Array(SIZE * SIZE), range = max - min || 1;
  for (let i = 0; i < mask.length; i++) mask[i] = (out[i] - min) / range;
  return { mask, provider };
}
module.exports = { available, run, SIZE };
