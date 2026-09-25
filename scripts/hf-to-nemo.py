# /// script
# requires-python = ">=3.10"
# dependencies = ["torch", "safetensors", "numpy"]
# ///
"""Turn a HuggingFace-format Parakeet TDT checkpoint back into a NeMo .nemo, so
it can go through the same ONNX export as every other model this app ships.

Needed for moondream/parakeet-ultra and moondream/parakeet-redux, which are
published only as `transformers` ParakeetForTDT safetensors. HF's own converter
(transformers/models/parakeet/convert_nemo_to_hf.py) goes NeMo -> HF by renaming
keys and nothing else, so the way back needs no tensor surgery: take the BASE
.nemo of the same architecture (nvidia/parakeet-tdt-0.6b-v3), push each of its
keys through the same rename table, and pull that tensor from the safetensors.
The base supplies the config, the tokenizer and the few deterministic buffers
HF does not store; every learned weight comes from the HF checkpoint, and any
learned key that cannot be found is an error rather than a silent base weight.

Ternary checkpoints (parakeet-redux: `<module>.qweight` uint8, five base-3
digits per byte, plus `<module>.scales` fp16 per group of `ternary_group_size`)
are expanded to dense weights, w = scale[row, col // group] * (code - 1), which
is exact. quantize-nbits.py --ternary later packs them back without loss.

Usage: hf-to-nemo.py <hf_dir> <base.nemo> <out.nemo>
Written with Claude Code.
"""
import argparse
import io
import json
import re
import tarfile
from pathlib import Path

import numpy as np
import torch
from safetensors.numpy import load_file

# Copied from transformers' convert_nemo_to_hf.py (NEMO_TO_HF_WEIGHT_MAPPING +
# NEMO_TDT_WEIGHT_MAPPING, minus the CTC head). Applied in order, like HF does.
NEMO_TO_HF = {
    r"encoder\.pre_encode\.conv\.": r"encoder.subsampling.layers.",
    r"encoder\.pre_encode\.out\.": r"encoder.subsampling.linear.",
    r"encoder\.pos_enc\.": r"encoder.encode_positions.",
    r"encoder\.layers\.(\d+)\.conv\.batch_norm\.": r"encoder.layers.\1.conv.norm.",
    r"linear_([kv])": r"\1_proj",
    r"linear_out": r"o_proj",
    r"linear_q": r"q_proj",
    r"pos_bias_([uv])": r"bias_\1",
    r"linear_pos": r"relative_k_proj",
    r"decoder\.prediction\.embed\.": r"decoder.embedding.",
    r"decoder\.prediction\.dec_rnn\.lstm\.": r"decoder.lstm.",
    r"joint\.enc\.": r"encoder_projector.",
    r"joint\.pred\.": r"decoder.decoder_projector.",
    r"joint\.joint_net\.2\.": r"joint.head.",
}
# Deterministic buffers HF does not serialize (the mel filterbank and window,
# the sinusoidal position table): the base values are the right ones.
KEEP_FROM_BASE = re.compile(r"(^preprocessor\.featurizer\.(window|fb)$|^encoder\.pos_enc\.pe$)")


def to_hf(key):
    for pat, rep in NEMO_TO_HF.items():
        key = re.sub(pat, rep, key)
    return key


def unpack_ternary(qweight, scales, in_features, group):
    """uint8 [out, ceil(in/5)] -> fp32 [out, in]. Element i of a row is base-3
    digit i%5 of byte i//5, least significant first (ternary.json 'packing')."""
    digits = np.stack([(qweight // 3**d) % 3 for d in range(5)], axis=-1)
    codes = digits.reshape(qweight.shape[0], -1)[:, :in_features].astype(np.float32)
    scale = np.repeat(scales.astype(np.float32), group, axis=1)[:, :in_features]
    return (codes - 1.0) * scale


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("hf_dir", type=Path, help="folder with model.safetensors and config.json")
    ap.add_argument("base_nemo", type=Path, help="nvidia/parakeet-tdt-0.6b-v3 .nemo (config, tokenizer, buffers)")
    ap.add_argument("out_nemo", type=Path)
    args = ap.parse_args()

    cfg = json.loads((args.hf_dir / "config.json").read_text())
    group = cfg.get("ternary_group_size")
    hf = load_file(str(args.hf_dir / "model.safetensors"))
    print(f"HF checkpoint: {len(hf)} tensors, ternary group {group}", flush=True)

    with tarfile.open(args.base_nemo) as tar:
        members = [m for m in tar.getmembers() if m.isfile()]
        blobs = {m.name: tar.extractfile(m).read() for m in members}
    ckpt_name = next(n for n in blobs if n.endswith("model_weights.ckpt"))
    base = torch.load(io.BytesIO(blobs[ckpt_name]), map_location="cpu", weights_only=True)

    used, out, kept, ternary = set(), {}, [], 0
    for key, ref in base.items():
        name = to_hf(key)
        if name in hf:
            arr = hf[name]
            used.add(name)
        elif name.endswith(".weight") and name[:-7] + ".qweight" in hf:
            stem = name[:-7]
            q, s = hf[stem + ".qweight"], hf[stem + ".scales"]
            arr = unpack_ternary(q, s, int(np.prod(ref.shape[1:])), group)
            used.update({stem + ".qweight", stem + ".scales"})
            ternary += 1
        elif KEEP_FROM_BASE.search(key):
            out[key] = ref
            kept.append(key)
            continue
        else:
            raise SystemExit(f"no HF tensor for NeMo key {key} (looked for {name})")
        t = torch.from_numpy(np.ascontiguousarray(arr)).to(ref.dtype)
        if t.numel() != ref.numel():
            raise SystemExit(f"{key}: HF {tuple(t.shape)} vs NeMo {tuple(ref.shape)}")
        out[key] = t.reshape(ref.shape)

    unused = sorted(set(hf) - used)
    print(f"mapped {len(out) - len(kept)} tensors ({ternary} ternary expanded), "
          f"kept {len(kept)} base buffers: {kept}", flush=True)
    # The VAD head has no NeMo counterpart; anything else left over would be a
    # learned weight this conversion is dropping on the floor.
    stray = [k for k in unused if not k.startswith("vad_head.")]
    if stray:
        raise SystemExit(f"unmapped HF tensors: {stray[:10]} ({len(stray)} total)")
    print(f"ignored {len(unused)} vad_head tensors", flush=True)

    buf = io.BytesIO()
    torch.save(out, buf)
    blobs[ckpt_name] = buf.getvalue()
    args.out_nemo.parent.mkdir(parents=True, exist_ok=True)
    with tarfile.open(args.out_nemo, "w") as tar:
        for m in members:
            data = blobs[m.name]
            m.size = len(data)
            tar.addfile(m, io.BytesIO(data))
    print(f"wrote {args.out_nemo} ({args.out_nemo.stat().st_size / 1e9:.2f} GB)", flush=True)


if __name__ == "__main__":
    main()
