// Back-end initialisation helper for ONNX Runtime Web.
// At runtime the caller can specify preferred backend ("webgpu", "wasm").
// The function resolves once ONNX Runtime is ready and returns the `ort` module.

/**
 * Initialise ONNX Runtime Web and pick the execution provider.
 * If WebGPU is requested but not supported, we transparently fall back to WASM.
 * @param {Object} opts
 * @param {('webgpu'|'wasm')} [opts.backend='webgpu'] Desired backend.
 * @param {string} [opts.wasmPaths] Optional path prefix for WASM binaries.
 * @returns {Promise<typeof import('onnxruntime-web').default>}
 */
export async function initOrt({ backend = 'webgpu', wasmPaths, numThreads } = {}) {
  // Dynamic import to handle Vite bundling issues
  let ort;
  
  try {
    const ortModule = await import('onnxruntime-web');
    ort = ortModule.default || ortModule;

    // Some bundler configurations expose the namespace as ortModule.ort.
    if (!ort.env && ortModule.ort) {
      ort = ortModule.ort;
    }
  } catch (e) {
    console.error('[Parakeet.js] Failed to import onnxruntime-web:', e);
    throw new Error('Failed to load ONNX Runtime Web. Please check your network connection.');
  }
  
  if (!ort || !ort.env) {
    throw new Error('ONNX Runtime Web loaded but env is not available. This might be a bundling issue.');
  }
  
  // Serve WASM artifacts from same-origin (vendored under app/ui/public/ort/).
  // Avoids trusting a public CDN at runtime — a jsDelivr/npm compromise would
  // otherwise silently swap the ML engine for every visitor. Files are baked
  // into the build, so the version always matches the vendored JS loader.
  if (!ort.env.wasm.wasmPaths) {
    ort.env.wasm.wasmPaths = '/ort/';
  }

  // Configure WASM for better performance
  if (backend === 'wasm' || backend === 'webgpu') {
    // Enable multi-threading if supported
    if (typeof SharedArrayBuffer !== 'undefined') {
      ort.env.wasm.numThreads = numThreads || navigator.hardwareConcurrency || 4;
      ort.env.wasm.simd = true;
      console.log(`[Parakeet.js] WASM configured with ${ort.env.wasm.numThreads} threads, SIMD enabled`);
    } else {
      console.warn('[Parakeet.js] SharedArrayBuffer not available - using single-threaded WASM');
      ort.env.wasm.numThreads = 1;
    }
    
    // Enable other WASM optimizations
    ort.env.wasm.proxy = false; // Direct execution for better performance
  }

  if (backend === 'webgpu') {
    if (!('gpu' in navigator)) {
      console.warn('[Parakeet.js] WebGPU not supported – falling back to WASM');
      backend = 'wasm';
    }
    // Otherwise WebGPU is initialised automatically when the session is created.
  }

  // Expose ort globally so other modules (like SileroVAD) can reuse the same
  // configured instance without re-importing and re-initialising.
  if (typeof globalThis !== 'undefined') {
    globalThis.ort = ort;
  }

  // Return the ort module for use in creating sessions and tensors
  return ort;
}