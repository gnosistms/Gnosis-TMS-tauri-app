#!/usr/bin/env python3
"""Build (and optionally upload) the per-language data Glossary Research downloads on demand.

For each language code it writes, under OUT/v1/<code>/:
  frequency.tsv.gz   word<TAB>zipf (two decimals), most frequent first
  sentences.txt.gz   one sentence per line, from a Leipzig Corpora Collection corpus
and updates OUT/v1/manifest.json (sizes, SHA-256, sources, token counts, attributions).

Frequencies come from wordfreq's "large" list where it exists (CC BY-SA 4.0); otherwise they
are computed from the Leipzig corpus word counts. Sentences are the Leipzig corpus sentences
(CC BY 4.0). Downloads of Leipzig archives are cached in CACHE.

Usage:
  python3 prepare_research_data.py --out DIR --cache DIR es en [vi ...]
  python3 prepare_research_data.py --out DIR --upload        # upload DIR/v1 to Spaces (public-read)
Upload needs SPACES_KEY, SPACES_SECRET, SPACES_BUCKET (and SPACES_REGION, default sgp1) and rclone.
"""
import argparse, gzip, hashlib, json, math, os, subprocess, sys, tarfile, urllib.request

ISO3 = {"es": "spa", "en": "eng", "vi": "vie", "fr": "fra", "de": "deu", "it": "ita", "pt": "por",
        "ru": "rus", "uk": "ukr", "pl": "pol", "nl": "nld", "sv": "swe", "nb": "nob", "fi": "fin",
        "cs": "ces", "he": "heb", "ar": "ara", "tr": "tur", "id": "ind", "ko": "kor", "ja": "jpn",
        "zh": "zho", "th": "tha", "hu": "hun", "ro": "ron", "el": "ell", "bg": "bul", "hr": "hrv",
        "ca": "cat", "da": "dan", "sk": "slk", "sl": "slv", "lt": "lit", "lv": "lav", "et": "est",
        "fa": "fas", "hi": "hin", "bn": "ben", "ms": "msa", "tl": "tgl", "sw": "swa", "sr": "srp",
        "ur": "urd", "af": "afr", "eu": "eus", "gl": "glg", "is": "isl", "ka": "kat", "hy": "hye",
        "sq": "sqi", "mk": "mkd", "be": "bel", "kk": "kaz", "az": "aze", "ta": "tam", "te": "tel",
        "mr": "mar", "ne": "nep", "si": "sin", "km": "khm", "my": "mya", "am": "amh", "yo": "yor",
        "ha": "hau", "zu": "zul", "bs": "bos", "mn": "mon", "uz": "uzb", "pa": "pan", "gu": "guj",
        "kn": "kan", "ml": "mal", "lo": "lao", "cy": "cym", "ga": "gle", "mt": "mlt", "lb": "ltz"}
# Leipzig sometimes files a language under a regional or alternative code.
ALT_CODES = {"zh": ["zho-cn", "zho-tw", "cmn"], "sq": ["als"], "ms": ["zsm"], "fa": ["pes"], "ne": ["npi"],
             "et": ["ekk"], "lv": ["lvs"], "uz": ["uzn"], "sw": ["swh"], "nb": ["nor"], "ar": ["arb"]}
LEIPZIG = "https://downloads.wortschatz-leipzig.de/corpora/"
LEIPZIG_ATTRIBUTION = ("Leipzig Corpora Collection, CC BY 4.0 (D. Goldhahn, T. Eckart, U. Quasthoff: "
                       "Building Large Monolingual Dictionaries at the Leipzig Corpora Collection, LREC 2012)")
WORDFREQ_ATTRIBUTION = "wordfreq by Robyn Speer, CC BY-SA 4.0 (https://github.com/rspeer/wordfreq)"


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def find_corpus(code):
    """The best available Leipzig corpus: 1M sentences preferred, news first; then smaller sizes."""
    iso3 = ISO3.get(code)
    if not iso3:
        return None
    codes = [iso3] + ALT_CODES.get(code, [])
    kinds = ("news", "newscrawl", "web", "wikipedia", "mixed", "community")
    for size in ("1M", "300K", "100K", "30K"):
        for kind in kinds:
            for lang in codes:
                for year in range(2024, 2004, -1):
                    name = f"{lang}_{kind}_{year}_{size}"
                    req = urllib.request.Request(LEIPZIG + name + ".tar.gz", method="HEAD")
                    try:
                        with urllib.request.urlopen(req, timeout=20) as r:
                            if r.status == 200:
                                return name
                    except Exception:
                        continue
    return None


def fetch(name, cache):
    path = os.path.join(cache, name + ".tar.gz")
    if not os.path.exists(path):
        print(f"  downloading {name}.tar.gz", flush=True)
        urllib.request.urlretrieve(LEIPZIG + name + ".tar.gz", path + ".part")
        os.replace(path + ".part", path)
    return path


def build(code, out, cache, corpus=None):
    lang_dir = os.path.join(out, "v1", code)
    os.makedirs(lang_dir, exist_ok=True)
    name = corpus or find_corpus(code)
    if not name:
        print(f"  {code}: no Leipzig corpus found, skipped", flush=True)
        return False
    archive = fetch(name, cache)
    tokens = sentences = None
    counts = {}
    sent_path = os.path.join(lang_dir, "sentences.txt.gz")
    with tarfile.open(archive, "r:gz") as tar:
        for member in tar.getmembers():
            base = os.path.basename(member.name)
            if base.endswith("-meta.txt"):
                for line in tar.extractfile(member).read().decode("utf-8").splitlines():
                    parts = line.split("\t")
                    if len(parts) == 3 and parts[1] == "WORD_TOKENS":
                        tokens = int(parts[2])
                    if len(parts) == 3 and parts[1] == "SENTENCES":
                        sentences = int(parts[2])
        for member in tar.getmembers():
            base = os.path.basename(member.name)
            if base.endswith("-sentences.txt"):
                with gzip.open(sent_path, "wt", encoding="utf-8", compresslevel=9) as w:
                    for raw in tar.extractfile(member):
                        line = raw.decode("utf-8", "replace").rstrip("\n")
                        text = line.split("\t", 1)[1] if "\t" in line else line
                        w.write(text.replace("\t", " ") + "\n")
            elif base.endswith("-words.txt"):
                for raw in tar.extractfile(member):
                    parts = raw.decode("utf-8", "replace").rstrip("\n").split("\t")
                    if len(parts) >= 3 and parts[2].isdigit():
                        word = parts[1].lower()
                        counts[word] = counts.get(word, 0) + int(parts[2])
    freq_path = os.path.join(lang_dir, "frequency.tsv.gz")
    source = None
    try:
        import wordfreq
        # wordfreq falls back to a "nearest" language (Mongolian -> Russian); only an exact list counts.
        if code not in wordfreq.available_languages(wordlist="large"):
            raise ValueError("no large wordfreq list for this language")
        table = wordfreq.get_frequency_dict(code, wordlist="large")
        if len(table) < 50000:
            raise ValueError("only a small list")
        rows = sorted(((w, math.log10(f) + 9) for w, f in table.items() if f > 0), key=lambda r: -r[1])
        source = WORDFREQ_ATTRIBUTION + f" (large_{code})"
    except Exception:
        total = tokens or sum(counts.values())
        rows = sorted(((w, math.log10(c / total) + 9) for w, c in counts.items() if c >= 2), key=lambda r: -r[1])
        source = f"word counts of {name}, " + LEIPZIG_ATTRIBUTION
    with gzip.open(freq_path, "wt", encoding="utf-8", compresslevel=9) as w:
        for word, zipf in rows:
            if "\t" not in word and "\n" not in word:
                w.write(f"{word}\t{zipf:.2f}\n")
    manifest_path = os.path.join(out, "v1", "manifest.json")
    manifest = json.load(open(manifest_path)) if os.path.exists(manifest_path) else {"version": 1, "languages": {}}
    manifest["languages"][code] = {
        "frequency": {"file": f"{code}/frequency.tsv.gz", "bytes": os.path.getsize(freq_path),
                      "sha256": sha256(freq_path), "words": len(rows), "source": source},
        "sentences": {"file": f"{code}/sentences.txt.gz", "bytes": os.path.getsize(sent_path),
                      "sha256": sha256(sent_path), "corpus": name, "sentences": sentences,
                      "tokens": tokens, "source": LEIPZIG_ATTRIBUTION},
    }
    json.dump(manifest, open(manifest_path, "w"), indent=1, sort_keys=True)
    print(f"  {code}: {name}, {len(rows)} words, frequency {os.path.getsize(freq_path)} B, "
          f"sentences {os.path.getsize(sent_path)} B", flush=True)
    return archive


def upload(out):
    for var in ("SPACES_KEY", "SPACES_SECRET", "SPACES_BUCKET"):
        if not os.environ.get(var):
            sys.exit(f"{var} is not set")
    region = os.environ.get("SPACES_REGION", "sgp1")
    bucket = os.environ["SPACES_BUCKET"]
    subprocess.run([
        "rclone", "copy", os.path.join(out, "v1"), f":s3:{bucket}/research-data/v1",
        "--s3-provider", "DigitalOcean", "--s3-endpoint", f"{region}.digitaloceanspaces.com",
        "--s3-access-key-id", os.environ["SPACES_KEY"], "--s3-secret-access-key", os.environ["SPACES_SECRET"],
        "--s3-acl", "public-read", "--s3-no-check-bucket", "--checksum", "--progress",
    ], check=True)
    print(f"uploaded: https://{bucket}.{region}.digitaloceanspaces.com/research-data/v1/manifest.json")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", required=True)
    parser.add_argument("--cache", default=None)
    parser.add_argument("--upload", action="store_true")
    parser.add_argument("--corpus", default=None, help="force a Leipzig corpus name (one language only)")
    parser.add_argument("--delete-archives", action="store_true", help="remove each Leipzig archive after building")
    parser.add_argument("languages", nargs="*")
    args = parser.parse_args()
    os.makedirs(args.cache or args.out, exist_ok=True)
    for code in args.languages:
        if os.path.exists(os.path.join(args.out, "v1", code, "sentences.txt.gz")) and not args.corpus:
            print(f"  {code}: already built", flush=True)
            continue
        try:
            archive = build(code, args.out, args.cache or args.out, args.corpus)
        except Exception as error:  # one bad archive must not stop the batch
            print(f"  {code}: FAILED {error}", flush=True)
            continue
        if archive and args.delete_archives:
            os.remove(archive)
        if args.upload:
            upload(args.out)
    if args.upload and not args.languages:
        upload(args.out)


if __name__ == "__main__":
    main()
