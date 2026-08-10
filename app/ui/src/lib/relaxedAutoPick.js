// First-load micro-bench that decides whether the Relaxed-SIMD ORT runtime
// should engage on THIS engine+CPU, without downloading anything.
//
// Why a bench and not a capability probe: every measured engine VALIDATES the
// relaxed opcodes, but they do not all profit from them. On the same AVX2 box
// the relaxed ORT build is -18.6% wall in Chromium 148, a wash-to-slightly-
// slower under Node 22's V8 CLI path, and +4% SLOWER in Firefox 153
// (2026-08-10, PERF_PLAN #5): SpiderMonkey accepts i32x4.relaxed_dot_* and
// then lowers it no faster than the plain-SIMD emulation. So "supported" is
// the wrong question; "faster HERE" is the question, and only running both
// flavors answers it.
//
// What is measured: the one instruction family the relaxed ORT build actually
// wins on, the int8 dot product at the heart of the quantized GEMM. Two
// tiny (<400 byte) WebAssembly modules run the same 2 KiB x 2 KiB dot-product
// loop; one accumulates via i32x4.relaxed_dot_i8x16_i7x16_add_s, the other
// via the stock-SIMD emulation ORT uses without it (extmul low/high +
// extadd_pairwise + add). This is deliberately model-independent: ORT-WASM
// initialises once per page, so the real runtimes cannot be A/B'd in place,
// and re-downloading models to compare them would be absurd. ~a few ms per
// call, cheap enough to run fresh on every model load (no persistence, so an
// engine update can never leave a stale pick behind).
//
// The pick rule is asymmetric on purpose: relaxed must beat plain by a clear
// margin (default 10%) to be chosen, because stock is the auditable
// npm-vendored runtime and relaxed numerics are implementation-defined. Ties
// and losses go to stock; so do all failure modes (no WebAssembly, compile
// error, nonsensical timings).
//
// Written with the help of Claude Code.

// ---- wasm module assembly ---------------------------------------------------
// Hand-assembled because the modules must exist as bytes at runtime with no
// toolchain. Helpers keep the encoding readable; byte layouts follow the wasm
// binary spec (LEB128 sizes, sections, 0xFD SIMD prefix with LEB opcodes).

function leb(n) {
  const out = [];
  do {
    let b = n & 0x7f;
    n >>>= 7;
    if (n !== 0) b |= 0x80;
    out.push(b);
  } while (n !== 0);
  return out;
}

function section(id, body) {
  return [id, ...leb(body.length), ...body];
}

const SIMD = 0xfd;
const op = (code) => [SIMD, ...leb(code)];
// memarg: v128 natural alignment (log2 = 4) + offset
const V128_LOAD = (offset) => [...op(0x00), 0x04, ...leb(offset)];
const I16X8_EXTMUL_LOW_I8X16_S = op(0x9c);
const I16X8_EXTMUL_HIGH_I8X16_S = op(0x9d);
const I32X4_EXTADD_PAIRWISE_I16X8_S = op(0x7e);
const I32X4_ADD = op(0xae);
const I32X4_EXTRACT_LANE_0 = [...op(0x1b), 0x00];
const I32X4_RELAXED_DOT_I8X16_I7X16_ADD_S = op(0x113);

const LOCAL_GET = (i) => [0x20, ...leb(i)];
const LOCAL_SET = (i) => [0x21, ...leb(i)];
const LOCAL_TEE = (i) => [0x22, ...leb(i)];
const I32_CONST = (n) => [0x41, ...leb(n)];

// Both kernels: run(iters) sweeps a 2 KiB x 2 KiB int8 dot product iters
// times, accumulating into a v128, and returns lane 0 so the loop cannot be
// dead-code-eliminated. Locals: 0=iters(param) 1=i 2=off 3=acc 4=va 5=vb.
const BYTES_PER_STEP = 16;
const REGION = 2048;

function kernelBody(dotStep) {
  return [
    // block: bail out on iters == 0 so the loop below can be do-while shaped
    0x02, 0x40,
    ...LOCAL_GET(0), 0x45, 0x0d, 0x00, // i32.eqz, br_if @block
    0x03, 0x40, // loop (outer, per-iter)
    ...I32_CONST(0), ...LOCAL_SET(2),
    0x03, 0x40, // loop (inner, per-16-byte step)
    ...LOCAL_GET(2), ...V128_LOAD(0), ...LOCAL_SET(4),
    ...LOCAL_GET(2), ...V128_LOAD(REGION), ...LOCAL_SET(5),
    ...dotStep,
    ...LOCAL_GET(2), ...I32_CONST(BYTES_PER_STEP), 0x6a, // i32.add
    ...LOCAL_TEE(2), ...I32_CONST(REGION), 0x49, // i32.lt_u
    0x0d, 0x00, // br_if inner loop
    0x0b,
    ...LOCAL_GET(1), ...I32_CONST(1), 0x6a,
    ...LOCAL_TEE(1), ...LOCAL_GET(0), 0x49,
    0x0d, 0x00, // br_if outer loop
    0x0b,
    0x0b,
    ...LOCAL_GET(3), ...I32X4_EXTRACT_LANE_0,
    0x0b, // end of function
  ];
}

// acc = relaxed_dot_add(va, vb, acc): the single instruction ORT's int8 GEMM
// gains from the relaxed build.
const RELAXED_STEP = [
  ...LOCAL_GET(4), ...LOCAL_GET(5), ...LOCAL_GET(3),
  ...I32X4_RELAXED_DOT_I8X16_I7X16_ADD_S, ...LOCAL_SET(3),
];
// The stock-SIMD emulation of the same reduction: widen-multiply both halves,
// pairwise-add to i32x4, accumulate.
const PLAIN_STEP = [
  ...LOCAL_GET(3),
  ...LOCAL_GET(4), ...LOCAL_GET(5), ...I16X8_EXTMUL_LOW_I8X16_S,
  ...I32X4_EXTADD_PAIRWISE_I16X8_S, ...I32X4_ADD,
  ...LOCAL_GET(4), ...LOCAL_GET(5), ...I16X8_EXTMUL_HIGH_I8X16_S,
  ...I32X4_EXTADD_PAIRWISE_I16X8_S, ...I32X4_ADD,
  ...LOCAL_SET(3),
];

function moduleBytes(dotStep) {
  const body = kernelBody(dotStep);
  // locals: 2 x i32, 3 x v128
  const code = [0x02, 0x02, 0x7f, 0x03, 0x7b, ...body];
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, // magic + version
    ...section(1, [0x01, 0x60, 0x01, 0x7f, 0x01, 0x7f]), // type: (i32) -> i32
    ...section(3, [0x01, 0x00]), // function: 1 func of type 0
    ...section(5, [0x01, 0x00, 0x01]), // memory: min 1 page
    ...section(7, [0x01, 0x03, 0x72, 0x75, 0x6e, 0x00, 0x00]), // export "run"
    ...section(10, [0x01, ...leb(code.length), ...code]), // code
  ]);
}

export function plainKernelBytes() { return moduleBytes(PLAIN_STEP); }
export function relaxedKernelBytes() { return moduleBytes(RELAXED_STEP); }

// ---- pick logic -------------------------------------------------------------

export const AUTO_PICK_MARGIN = 1.1;

// Pure decision: relaxed only on a clear win; every degenerate timing
// (zero, NaN, missing) falls back to the auditable stock runtime.
export function pickFromTimings(plainMs, relaxedMs, margin = AUTO_PICK_MARGIN) {
  if (!Number.isFinite(plainMs) || !Number.isFinite(relaxedMs) || plainMs <= 0 || relaxedMs <= 0) return 'stock';
  return plainMs / relaxedMs >= margin ? 'relaxed' : 'stock';
}

function median(xs) {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
}

// Time both kernels and pick. Injectable clock for tests; the defaults spend
// roughly (2 kernels x samples x targetMs) ~= 40 ms, noise-fenced by
// calibrating the iteration count to targetMs, interleaving the arms (ABAB,
// so ambient load drifts across both), and taking medians.
export function benchRelaxedAutoPick({
  now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  targetMs = 4,
  samples = 5,
  margin = AUTO_PICK_MARGIN,
} = {}) {
  try {
    if (typeof WebAssembly === 'undefined') return { pick: 'stock', reason: 'no-webassembly' };
    let plainRun, relaxedRun;
    try {
      plainRun = new WebAssembly.Instance(new WebAssembly.Module(plainKernelBytes()), {}).exports.run;
      relaxedRun = new WebAssembly.Instance(new WebAssembly.Module(relaxedKernelBytes()), {}).exports.run;
    } catch {
      // CompileError on the relaxed module: the engine has no relaxed SIMD at
      // all, so there is nothing to compare (the caller's probe gate should
      // have caught this first).
      return { pick: 'stock', reason: 'compile-failed' };
    }
    const timeOne = (run, iters) => {
      const t0 = now();
      run(iters);
      return now() - t0;
    };
    // Calibrate on the plain kernel: scale a small probe run up to targetMs.
    const PROBE_ITERS = 64;
    plainRun(PROBE_ITERS); // warm both compilers/tiers before any timing
    relaxedRun(PROBE_ITERS);
    const probeMs = Math.max(timeOne(plainRun, PROBE_ITERS), 0.01);
    const iters = Math.max(PROBE_ITERS, Math.min(1 << 20, Math.round((PROBE_ITERS * targetMs) / probeMs)));
    const plainTimes = [];
    const relaxedTimes = [];
    for (let s = 0; s < samples; s++) {
      plainTimes.push(timeOne(plainRun, iters));
      relaxedTimes.push(timeOne(relaxedRun, iters));
    }
    const plainMs = median(plainTimes);
    const relaxedMs = median(relaxedTimes);
    return { pick: pickFromTimings(plainMs, relaxedMs, margin), plainMs, relaxedMs, iters, reason: null };
  } catch {
    return { pick: 'stock', reason: 'bench-failed' };
  }
}
