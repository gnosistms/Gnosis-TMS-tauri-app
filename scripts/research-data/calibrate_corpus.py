"""Per-language calibration of corpus sentence counts to the frequency list's Zipf scale.

zipf(word) ≈ log10(sentences containing the word in the whole corpus) + offset.
The offset is the median over ~400 mid-frequency list words, counted the way the app counts
(whole words at word edges; substrings in scripts written without spaces).
"""
import gzip, hashlib, json, math, os, statistics, sys
from multiprocessing import Pool
import regex

S = sys.argv[1]
ROOTS = [f"{S}/research-data-2/v1", f"{S}/research-data/v1"]
live = json.load(open(f"{S}/live_manifest.json"))
UNSPACED = {"zh", "ja", "th", "lo", "km", "my"}
WORD = regex.compile(r"[\p{L}\p{N}\p{M}_‌‍]+")
LETTERS = regex.compile(r"^[\p{L}\p{M}‌‍]+$")
SAMPLE_LINES = 300_000

def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""): h.update(chunk)
    return h.hexdigest()

def local(code, kind, entry):
    for root in ROOTS:
        p = f"{root}/{entry['file']}"
        if os.path.exists(p) and os.path.getsize(p) == entry["bytes"] and sha(p) == entry["sha256"]:
            return p
    return None

def calibrate(code):
    e = live["languages"][code]
    fp, sp = local(code, "frequency", e["frequency"]), local(code, "sentences", e["sentences"])
    if not fp or not sp:
        return code, {"error": f"local files not matching the published ones (freq={bool(fp)}, sentences={bool(sp)})"}
    entries = []
    with gzip.open(fp, "rt", encoding="utf-8") as f:
        for line in f:
            parts = line.rstrip("\n").split("\t")
            if len(parts) < 2: continue
            w, z = parts[0].lower(), float(parts[1])
            if 3.0 <= z <= 5.0 and LETTERS.match(w) and len(w) >= 2:
                entries.append((w, z))
    step = max(1, len(entries) // 400)
    sample = dict(entries[::step][:400])
    counts = dict.fromkeys(sample, 0)
    total = 0
    unspaced = code in UNSPACED
    words = list(sample)
    with gzip.open(sp, "rt", encoding="utf-8") as f:
        for line in f:
            total += 1
            if total > SAMPLE_LINES: continue
            low = line.lower()
            if unspaced:
                for w in words:
                    if w in low: counts[w] += 1
            else:
                for t in set(WORD.findall(low)):
                    if t in counts: counts[t] += 1
    scale = total / min(total, SAMPLE_LINES)
    diffs = [z - math.log10(counts[w] * scale) for w, z in sample.items() if counts[w] >= 5]
    if len(diffs) < 30:
        return code, {"error": f"too few words found in the corpus ({len(diffs)})", "sentences": total}
    diffs.sort()
    q1, med, q3 = diffs[len(diffs)//4], statistics.median(diffs), diffs[3*len(diffs)//4]
    return code, {"zipfOffset": round(med, 3), "zipfOffsetWords": len(diffs), "zipfOffsetIqr": round(q3 - q1, 3), "sentences": total}

if __name__ == "__main__":
    codes = sorted(live["languages"])
    with Pool(8) as pool:
        results = dict(pool.map(calibrate, codes))
    json.dump(results, open(f"{S}/calibration.json", "w"), indent=1)
    for c in codes:
        r = results[c]
        print(c, r.get("zipfOffset"), r.get("zipfOffsetWords"), r.get("zipfOffsetIqr"), r.get("sentences"), r.get("error", ""))
