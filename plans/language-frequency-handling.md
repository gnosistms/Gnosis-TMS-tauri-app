# Word frequencies across the 71 research languages

Status: research done 2026-10-08 after the vanidad (ES→VI) test; approved and implemented the same day (calibrated manifest published).

## What went wrong with vanidad

The frequency check rejected **phù phiếm** with "Zipf 0.00". The Vietnamese list has it (**2.98**). The tool
looked it up as **phu phiem**: every frequency lookup on the target side strips accents and tone marks
(`fold()` in `checkCandidates` and `renderingTokens`). For Vietnamese the tone marks are the word. The same
stripping corrupts lookups in every target language with diacritics (French, German, Portuguese, Polish,
Czech, Turkish, Romanian, Spanish as a target, …). English barely notices, which is why the earlier tests
did not show it. Other Vietnamese candidates passed by luck: a toneless syllable ("vinh") exists in the list.

## What the data really contains (checked file by file)

- **Vietnamese** (Leipzig): the list is word-segmented. Compounds are entries: phù phiếm 2.98, hư vinh 2.28,
  ngưỡng mộ 4.52, trong suốt 4.79. 12,383 of the top 20,000 entries are multi-syllable.
- **Persian, Urdu** (Leipzig): the data contains no zero-width non-joiner at all (0 of 20,000 sentences);
  compounds appear joined (خودپسندی 1.91). Multi-word units are entries too (رئیس جمهور).
- **Chinese, Japanese** (wordfreq): lists are segmented into words (虚荣 3.33, 虚荣心 3.05); idioms and many
  compounds are missing (爱慕虚荣). The sentences have no spaces.
- **Korean** (Leipzig): the list is split into morphemes (particles 이, 고 are entries); compounds such as
  허영심 are missing.
- **Thai** (Leipzig): list entries are the space-separated chunks Thai uses between phrases, not words
  (ความหยิ่ง missing); the corpus is small (1.6 M tokens).
- **Arabic, Hebrew** (wordfreq): particles written onto the word make separate entries:
  غرور 3.36 / الغرور 3.63 / والغرور 2.93 / بالغرور 2.75; גאווה 4.08 / הגאווה 3.97 / והגאווה 2.57.
  One form understates the word.
- **Inflected and agglutinative languages**: the share of distinct words in 20,000 sentences shows how many
  forms a word takes: Malayalam 0.41, Korean 0.36, Kannada 0.34, Telugu 0.34, Tamil 0.33, Zulu 0.30,
  Finnish 0.28, Armenian 0.26 … against English 0.10, Spanish 0.09, Vietnamese 0.03. One form understates
  these words badly.
- **Corpus size is missing for 31 languages** (incl. Chinese, Japanese, Hebrew, Urdu, Mongolian), so a corpus
  count cannot be turned into a Zipf score for them today.
- Khmer, Lao, Burmese, Amharic, Yoruba, Hausa: no corpus available (the app already says to write to
  gnosistms@gmail.com).

## Proposed handling

**For every language**
1. Look words up exactly as written (lower case, Unicode NFC); never strip accents or tone marks.
2. Score a target word by **adding the frequencies of its surface forms** as they occur in running text
   (inflections, plural, forms with attached particles), the way the source side already adds its forms.
   The check step lists these forms for each word.
3. Score a rendering by its **rarest own word**, using the words the check step lists, not syllables,
   characters or space-separated pieces; parts listed only for the decomposition check do not count.
4. A word that is not in the list as a unit is **counted whole in the general corpus** (never split).
5. Put corpus counts on the list's Zipf scale with a **per-language calibration** computed once from words
   that are in both (fixes the 31 missing corpus sizes and the sentence-vs-occurrence difference), stored in
   the manifest.

**Per script**
- Persian, Urdu: remove ZWNJ before lookup and also try the spaced spelling.
- Chinese, Japanese: compounds and idioms not in the list are counted in the corpus.
- Thai: always count in the corpus (the list does not hold words).
- Korean: compounds not in the list are counted in the corpus; particles are forms to add.
- Arabic, Hebrew, Maltese: forms with attached particles are listed and added.

**Known limits**: a raw corpus count can include accidental matches across word edges (it overstates, never
understates); agglutinative languages have more forms than any list of forms covers (understates, so their
frequency demands are applied leniently: a rendering is failed only by the per-sense check, not by a whole-word
score that is likely too low).

## The 71 languages

| Code | Language | List from | Corpus size known | Words per sentence | Distinct-word ratio | Handling beyond the universal fixes |
|---|---|---|---|---|---|---|
| af | Afrikaans | leipzig | **no** | 18.3 | 0.111 | — |
| ar | Arabic | wordfreq | yes | 21.9 | 0.179 | attached particles make separate entries (غرور 3.36, الغرور 3.63, والغرور 2.93): sum the forms |
| az | Azerbaijani | leipzig | **no** | 15.3 | 0.179 | strongly inflected: sum the forms |
| be | Belarusian | leipzig | **no** | 15.2 | 0.184 | strongly inflected: sum the forms |
| bg | Bulgarian | leipzig | yes | 16.7 | 0.14 | — |
| bn | Bengali | wordfreq | **no** | 14.2 | 0.157 | — |
| bs | Bosnian | leipzig | **no** | 18.7 | 0.143 | — |
| ca | Catalan | wordfreq | **no** | 22.7 | 0.096 | — |
| cs | Czech | wordfreq | yes | 15.0 | 0.167 | — |
| cy | Welsh | leipzig | **no** | 15.3 | 0.128 | — |
| da | Danish | leipzig | yes | 17.2 | 0.11 | — |
| de | German | wordfreq | yes | 14.6 | 0.153 | — |
| el | Greek | leipzig | yes | 18.6 | 0.14 | — |
| en | English | wordfreq | yes | 21.6 | 0.099 | — |
| es | Spanish | wordfreq | yes | 22.7 | 0.091 | — |
| et | Estonian | leipzig | **no** | 15.3 | 0.212 | strongly inflected: sum the forms |
| eu | Basque | leipzig | yes | 12.9 | 0.184 | strongly inflected: sum the forms |
| fa | Persian | leipzig | yes | 17.5 | 0.089 | data has no ZWNJ (joined: خودپسندی): remove ZWNJ before lookup, also try the spaced spelling |
| fi | Finnish | wordfreq | yes | 11.4 | 0.284 | heavily inflected/agglutinative: sum many forms; expect undercount |
| fr | French | wordfreq | yes | 21.1 | 0.108 | — |
| ga | Irish | leipzig | **no** | 21.0 | 0.09 | — |
| gl | Galician | leipzig | **no** | 18.8 | 0.126 | — |
| gu | Gujarati | leipzig | **no** | 15.1 | 0.178 | strongly inflected: sum the forms |
| he | Hebrew | wordfreq | **no** | 15.2 | 0.192 | attached particles make separate entries (גאווה 4.08, הגאווה 3.97): sum the forms |
| hi | Hindi | leipzig | yes | 17.5 | 0.086 | — |
| hr | Croatian | leipzig | **no** | 19.2 | 0.135 | — |
| hu | Hungarian | leipzig | yes | 18.6 | 0.188 | strongly inflected: sum the forms |
| hy | Armenian | leipzig | **no** | 14.7 | 0.255 | heavily inflected/agglutinative: sum many forms; expect undercount |
| id | Indonesian | leipzig | yes | 16.3 | 0.101 | — |
| is | Icelandic | leipzig | yes | 17.5 | 0.143 | — |
| it | Italian | wordfreq | yes | 20.1 | 0.111 | — |
| ja | Japanese | wordfreq | **no** | 2.0 | 0.812 | list segmented; compounds missing from it: count in the corpus |
| ka | Georgian | leipzig | **no** | 15.7 | 0.194 | strongly inflected: sum the forms |
| kk | Kazakh | leipzig | **no** | 17.7 | 0.152 | — |
| kn | Kannada | leipzig | **no** | 11.7 | 0.343 | heavily inflected/agglutinative: sum many forms; expect undercount |
| ko | Korean | leipzig | yes | 12.8 | 0.355 | list split into morphemes (particles separate); compounds such as 허영심 missing: count those in the corpus |
| lb | Luxembourgish | leipzig | **no** | 18.3 | 0.123 | — |
| lt | Lithuanian | leipzig | **no** | 15.5 | 0.187 | strongly inflected: sum the forms |
| lv | Latvian | leipzig | **no** | 16.9 | 0.188 | strongly inflected: sum the forms |
| mk | Macedonian | wordfreq | yes | 18.9 | 0.128 | — |
| ml | Malayalam | leipzig | **no** | 9.6 | 0.408 | heavily inflected/agglutinative: sum many forms; expect undercount |
| mn | Mongolian | leipzig | **no** | 13.3 | 0.135 | — |
| mr | Marathi | leipzig | **no** | 13.6 | 0.202 | strongly inflected: sum the forms |
| ms | Malay | leipzig | **no** | 19.5 | 0.075 | — |
| mt | Maltese | leipzig | yes | 16.8 | 0.165 | article/particles attach with hyphen/apostrophe: sum the forms |
| nb | Norwegian | wordfreq | **no** | 18.2 | 0.12 | — |
| ne | Nepali | leipzig | **no** | 13.9 | 0.144 | — |
| nl | Dutch | wordfreq | yes | 15.6 | 0.124 | — |
| pa | Punjabi | leipzig | **no** | 17.9 | 0.113 | — |
| pl | Polish | wordfreq | yes | 13.4 | 0.189 | strongly inflected: sum the forms |
| pt | Portuguese | wordfreq | yes | 21.3 | 0.087 | — |
| ro | Romanian | leipzig | yes | 19.1 | 0.108 | — |
| ru | Russian | wordfreq | yes | 14.6 | 0.206 | strongly inflected: sum the forms |
| si | Sinhala | leipzig | **no** | 14.9 | 0.205 | strongly inflected: sum the forms |
| sk | Slovak | leipzig | **no** | 15.5 | 0.203 | strongly inflected: sum the forms |
| sl | Slovenian | leipzig | **no** | 17.5 | 0.145 | — |
| sq | Albanian | leipzig | **no** | 19.6 | 0.096 | — |
| sr | Serbian | leipzig | **no** | 16.3 | 0.217 | strongly inflected: sum the forms |
| sv | Swedish | wordfreq | yes | 13.8 | 0.139 | — |
| sw | Swahili | leipzig | **no** | 16.0 | 0.135 | — |
| ta | Tamil | leipzig | yes | 10.8 | 0.326 | heavily inflected/agglutinative: sum many forms; expect undercount |
| te | Telugu | leipzig | yes | 10.6 | 0.335 | heavily inflected/agglutinative: sum many forms; expect undercount |
| th | Thai | leipzig | yes | 11.1 | 0.34 | list entries are space-separated chunks, not words: count every word in the corpus |
| tl | Tagalog | leipzig | **no** | 19.2 | 0.124 | — |
| tr | Turkish | leipzig | yes | 15.3 | 0.17 | strongly inflected: sum the forms |
| uk | Ukrainian | wordfreq | yes | 14.4 | 0.182 | strongly inflected: sum the forms |
| ur | Urdu | leipzig | **no** | 25.3 | 0.07 | same as Persian (ZWNJ dropped in the data) |
| uz | Uzbek | leipzig | yes | 13.1 | 0.241 | strongly inflected: sum the forms |
| vi | Vietnamese | leipzig | yes | 22.2 | 0.031 | list is word-segmented (phù phiếm 2.98): fine once tone marks are kept |
| zh | Chinese | wordfreq | **no** | 1.5 | 0.863 | list segmented (虚荣 3.33, 虚荣心 3.05); idioms/compounds missing (爱慕虚荣): count in the corpus |
| zu | Zulu | leipzig | **no** | 12.4 | 0.304 | heavily inflected/agglutinative: sum many forms; expect undercount |