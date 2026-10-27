# Glossary Research: false friends, invented compounds and sense frequencies

Status: agreed with Hans 2026-10-06/07. Extends `plans/glossary-research-plan.md`. The written procedure it implements lives in GlossaryGen (`procedure-glossary-term-research.md`).

## Why

A research run on the author's word for "beyond the senses" proposed a calque whose base word does not carry the needed sense in present-day English. No dictionary catches this: the English dictionary still lists that sense (labelled only "especially formally"), and the compound itself is in no dictionary. Only usage frequency, measured sense by sense, shows the sense is practically absent from general English.

## What is added

| Stage | Where | What it does |
|---|---|---|
| Word family | after Word forms | The model proposes words built on the headword (prefixed, suffixed, compounds) and fixed phrases; each is counted in the texts. Found members feed the parts study and the suggested separate studies. |
| Parts and frequency | after "Where the term comes from" | The model takes the term apart and states each part's meaning as the author uses it. Code gets Zipf scores; for a source word that is not an invention, the sentences of a general corpus are classified by sense to get a per-sense score. |
| Candidate checks | after Candidate translations | For every candidate, the model names its words and parts and the sense each must carry, and marks look-alikes of source words. Code scores them; look-alike words get a per-sense measurement in the target-language general corpus. Rules in code decide pass / fail / unclear. Clashes with other glossary entries are found in code. |
| Proposal | existing | Gets the check table; failed renderings are not allowed. Code removes any variant that contains a failed word and logs it (the review pause can restore it). |
| Counting | existing | Two independent judges per occurrence by default (separately shuffled variant order). Counts and agreement are reported per judge. |
| Winner check | after Counting | Rare winners that cannot be understood from their parts get a proposed translator's note (target language). |
| Report | existing | Frequency table, parts, checks, clashes, judge agreement, footnotes, and the list of failed words to sweep for in finished translations. |

## Frequency rule (Hans 2026-10-06)

- Source term and rendering should have similar frequencies; the rendering may be better known, not much less known (more than about 1 Zipf point lower fails, unless it is a term of art, a name, or attested wording the author draws on).
- Compare the score of the sense used, not the whole word: per-sense Zipf = whole-word Zipf + log10(share of the sense in a general-corpus sample).
- A needed sense that never appears in at least 30 classified target sentences, while it appears in the source, fails (false friend), whatever the whole-word score.
- A source word the author invented (absent from the dictionary, Zipf near 0) puts no frequency demand on the rendering; a coined rendering is acceptable when each of its parts carries the needed sense, so the parts are measured instead.

## Language data (download on demand)

Nothing is added to the installer. Per language, on first use, the app downloads from DigitalOcean Spaces (`gnosis` bucket, `research-data/v1/`, public-read objects):

- `frequency.tsv.gz`: word → Zipf. From wordfreq (`large_xx`, CC BY-SA 4.0) where it exists; otherwise from the Leipzig corpus word counts.
- `sentences.txt.gz`: the sentences of a Leipzig Corpora Collection news corpus (1M sentences, CC BY 4.0), about 45–55 MB compressed.
- `manifest.json` lists languages, files, sizes, SHA-256, corpus names, token counts and attributions.

Files are verified against the manifest and cached in the app data folder. `scripts/research-data/prepare_research_data.py` builds and uploads a language.

## Cost controls

- Per-sense measurements only for the source headword (when not an invention), the source parts of an invented compound, and target words that look like a source word or part; at most 8 per run; one low-effort call of at most 100 sentences each.
- The second judge doubles counting; it can be turned off under Advanced.
