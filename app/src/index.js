export { ParakeetModel } from './parakeet.js';
export { getModelFile, getModelText, getParakeetModel } from './hub.js';

/**
 * Convenience factory to load from a local path.
 *
 * Example:
 * import { fromUrls } from 'parakeet.js';
 * const model = await fromUrls({ ... });
 */
export async function fromUrls(cfg) {
  const { ParakeetModel } = await import('./parakeet.js');
  return ParakeetModel.fromUrls(cfg);
}

/**
 * Convenience factory to load from HuggingFace Hub.
 *
 * Example:
 * import { fromHub } from 'parakeet.js';
 * const model = await fromHub('nvidia/parakeet-tdt-1.1b', { quantization: 'int8' });
 */
export async function fromHub(repoId, options = {}) {
  const { getParakeetModel } = await import('./hub.js');
  const { ParakeetModel } = await import('./parakeet.js');
  
  const urls = await getParakeetModel(repoId, options);
  return ParakeetModel.fromUrls({ ...urls, ...options });
} 