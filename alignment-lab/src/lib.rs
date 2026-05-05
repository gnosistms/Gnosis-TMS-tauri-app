use std::{
    collections::{BTreeMap, BTreeSet, HashMap, HashSet},
    fs,
    path::Path,
};

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TextUnit {
    pub id: usize,
    pub text: String,
    pub original_line_number: usize,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PromptInput {
    pub source_units: Vec<TextUnit>,
    pub target_units: Vec<TextUnit>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Alignment {
    pub target_id: usize,
    pub source_ids: Vec<usize>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentResponse {
    pub alignments: Vec<Alignment>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AlignmentReport {
    pub model_id: String,
    pub prompt_hash: String,
    #[serde(default)]
    pub split_prompt_hash: Option<String>,
    pub source_units: Vec<TextUnit>,
    pub target_units: Vec<TextUnit>,
    pub alignments: Vec<Alignment>,
    #[serde(default)]
    pub split_targets: Vec<ValidatedSplitTarget>,
    #[serde(default)]
    pub split_target_errors: Vec<SplitTargetError>,
    #[serde(default)]
    pub final_checks: Vec<FinalCheck>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FinalCheck {
    pub name: String,
    pub passed: bool,
    #[serde(default)]
    pub details: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetSourceInput {
    pub source_id: usize,
    pub source_text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetInput {
    pub target_id: usize,
    pub target_text: String,
    pub sources: Vec<SplitTargetSourceInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetPromptInput {
    pub split_targets: Vec<SplitTargetInput>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetFragmentHint {
    pub source_id: usize,
    pub target_text_fragment: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetResponseItem {
    pub target_id: usize,
    pub fragments: Vec<SplitTargetFragmentHint>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetResponse {
    pub split_targets: Vec<SplitTargetResponseItem>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedSplitTarget {
    pub target_id: usize,
    pub fragments: Vec<SplitTargetFragment>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetFragment {
    pub source_id: usize,
    pub range: [usize; 2],
    pub text: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetError {
    pub target_id: usize,
    pub target_text: String,
    pub sources: Vec<SplitTargetSourceInput>,
    #[serde(default)]
    pub raw_fragments: Vec<SplitTargetFragmentHint>,
    pub errors: Vec<String>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SplitTargetValidationResult {
    pub split_targets: Vec<ValidatedSplitTarget>,
    pub errors: Vec<SplitTargetError>,
}

pub fn read_units(path: &Path) -> Result<Vec<TextUnit>, String> {
    let text = fs::read_to_string(path)
        .map_err(|error| format!("Could not read '{}': {error}", path.display()))?;
    Ok(parse_units(&text))
}

pub fn parse_units(text: &str) -> Vec<TextUnit> {
    let mut units = Vec::new();

    for (line_index, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        units.push(TextUnit {
            id: units.len() + 1,
            text: trimmed.to_string(),
            original_line_number: line_index + 1,
        });
    }

    units
}

pub fn build_prompt(
    source_units: &[TextUnit],
    target_units: &[TextUnit],
) -> Result<String, String> {
    let prompt_input = PromptInput {
        source_units: source_units.to_vec(),
        target_units: target_units.to_vec(),
    };
    let input_json = serde_json::to_string_pretty(&prompt_input)
        .map_err(|error| format!("Could not serialize prompt input: {error}"))?;

    Ok(format!(
        r#"You align translated target-language text units to authoritative source-language text units.

Rules:
- Return JSON matching the provided schema.
- Return every target unit exactly once.
- For each target unit, return only the targetId and sourceIds.
- Use sourceIds: [] when the target unit has no corresponding source text.
- Multiple target units may reference the same source id when one source unit is split across target units.
- One target unit may reference multiple source ids when it combines source units.
- Use only ids from the input. Do not copy, quote, rewrite, or translate any text in the response.
- Preserve the semantic reading order of sourceIds.

Input:
{input_json}"#
    ))
}

pub fn prompt_hash(prompt: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(prompt.as_bytes());
    format!("{:x}", hasher.finalize())
}

pub fn alignment_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["alignments"],
        "properties": {
            "alignments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["targetId", "sourceIds"],
                    "properties": {
                        "targetId": {
                            "type": "integer",
                            "minimum": 1
                        },
                        "sourceIds": {
                            "type": "array",
                            "items": {
                                "type": "integer",
                                "minimum": 1
                            }
                        }
                    }
                }
            }
        }
    })
}

pub fn split_target_response_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": false,
        "required": ["splitTargets"],
        "properties": {
            "splitTargets": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": false,
                    "required": ["targetId", "fragments"],
                    "properties": {
                        "targetId": {
                            "type": "integer",
                            "minimum": 1
                        },
                        "fragments": {
                            "type": "array",
                            "items": {
                                "type": "object",
                                "additionalProperties": false,
                                "required": ["sourceId", "targetTextFragment"],
                                "properties": {
                                    "sourceId": {
                                        "type": "integer",
                                        "minimum": 1
                                    },
                                    "targetTextFragment": {
                                        "type": "string"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    })
}

pub fn validate_alignments(
    response: AlignmentResponse,
    source_units: &[TextUnit],
    target_units: &[TextUnit],
) -> Result<Vec<Alignment>, String> {
    let source_ids = source_units
        .iter()
        .map(|unit| unit.id)
        .collect::<HashSet<_>>();
    let target_ids = target_units
        .iter()
        .map(|unit| unit.id)
        .collect::<BTreeSet<_>>();
    let mut seen_target_ids = HashSet::new();
    let mut by_target_id = HashMap::new();

    for alignment in response.alignments {
        if !target_ids.contains(&alignment.target_id) {
            return Err(format!(
                "GPT returned target id {}, but that target unit is not in the input.",
                alignment.target_id
            ));
        }

        if !seen_target_ids.insert(alignment.target_id) {
            return Err(format!(
                "GPT returned target id {} more than once.",
                alignment.target_id
            ));
        }

        for source_id in &alignment.source_ids {
            if !source_ids.contains(source_id) {
                return Err(format!(
                    "GPT aligned target id {} to source id {}, but that source unit is not in the input.",
                    alignment.target_id, source_id
                ));
            }
        }

        by_target_id.insert(alignment.target_id, alignment);
    }

    let missing_target_ids = target_ids
        .iter()
        .copied()
        .filter(|target_id| !seen_target_ids.contains(target_id))
        .collect::<Vec<_>>();
    if !missing_target_ids.is_empty() {
        return Err(format!(
            "GPT did not return alignments for target ids: {}.",
            join_ids(&missing_target_ids)
        ));
    }

    Ok(target_ids
        .into_iter()
        .filter_map(|target_id| by_target_id.remove(&target_id))
        .collect())
}

pub fn build_report(
    model_id: &str,
    prompt: &str,
    source_units: Vec<TextUnit>,
    target_units: Vec<TextUnit>,
    alignments: Vec<Alignment>,
) -> AlignmentReport {
    AlignmentReport {
        model_id: model_id.to_string(),
        prompt_hash: prompt_hash(prompt),
        split_prompt_hash: None,
        source_units,
        target_units,
        alignments,
        split_targets: Vec::new(),
        split_target_errors: Vec::new(),
        final_checks: Vec::new(),
    }
}

pub fn run_final_checks(report: &AlignmentReport) -> Vec<FinalCheck> {
    vec![
        check_source_text_coverage(report),
        check_target_word_coverage(report),
    ]
}

pub fn apply_final_checks(report: &mut AlignmentReport, final_checks: Vec<FinalCheck>) {
    report.final_checks = final_checks;
}

fn check_source_text_coverage(report: &AlignmentReport) -> FinalCheck {
    let input_source = normalize_without_whitespace(&concat_unit_texts(&report.source_units));
    let output_source = normalize_without_whitespace(&concat_unit_texts(&report.source_units));
    let passed = input_source == output_source;
    FinalCheck {
        name: "sourceTextCoverage".to_string(),
        passed,
        details: if passed {
            Vec::new()
        } else {
            vec!["Concatenated output source text does not match input source text when whitespace is ignored.".to_string()]
        },
    }
}

fn check_target_word_coverage(report: &AlignmentReport) -> FinalCheck {
    let input_counts = token_counts(report.target_units.iter().map(|unit| unit.text.as_str()));
    let output_texts = rendered_target_texts(report);
    let output_counts = token_counts(output_texts.iter().map(String::as_str));
    let mut missing = Vec::new();

    for (token, input_count) in input_counts {
        let output_count = output_counts.get(&token).copied().unwrap_or(0);
        if output_count < input_count {
            missing.push(format!(
                "{token:?}: expected at least {input_count}, found {output_count}"
            ));
        }
    }

    FinalCheck {
        name: "targetWordCoverage".to_string(),
        passed: missing.is_empty(),
        details: missing,
    }
}

fn concat_unit_texts(units: &[TextUnit]) -> String {
    units
        .iter()
        .map(|unit| unit.text.as_str())
        .collect::<Vec<_>>()
        .join("")
}

fn normalize_without_whitespace(text: &str) -> String {
    text.chars()
        .filter(|character| !character.is_whitespace())
        .collect()
}

fn token_counts<'a>(texts: impl Iterator<Item = &'a str>) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for text in texts {
        for token in text.split_whitespace() {
            *counts.entry(token.to_string()).or_insert(0) += 1;
        }
    }
    counts
}

fn rendered_target_texts(report: &AlignmentReport) -> Vec<String> {
    let target_by_id = report
        .target_units
        .iter()
        .map(|unit| (unit.id, unit))
        .collect::<HashMap<_, _>>();
    let split_target_by_id = report
        .split_targets
        .iter()
        .map(|split_target| (split_target.target_id, split_target))
        .collect::<HashMap<_, _>>();
    let mut rendered = Vec::new();

    for alignment in &report.alignments {
        let Some(target_unit) = target_by_id.get(&alignment.target_id) else {
            continue;
        };

        if alignment.source_ids.len() > 1 {
            if let Some(split_target) = split_target_by_id.get(&alignment.target_id) {
                rendered.extend(
                    split_target
                        .fragments
                        .iter()
                        .map(|fragment| fragment.text.clone()),
                );
                continue;
            }
        }

        rendered.push(target_unit.text.clone());
    }

    rendered
}

pub fn find_split_targets(
    alignments: &[Alignment],
    source_units: &[TextUnit],
    target_units: &[TextUnit],
) -> Vec<SplitTargetInput> {
    let source_by_id = source_units
        .iter()
        .map(|unit| (unit.id, unit))
        .collect::<HashMap<_, _>>();
    let target_by_id = target_units
        .iter()
        .map(|unit| (unit.id, unit))
        .collect::<HashMap<_, _>>();

    alignments
        .iter()
        .filter(|alignment| alignment.source_ids.len() > 1)
        .filter_map(|alignment| {
            let target_unit = target_by_id.get(&alignment.target_id)?;
            let sources = alignment
                .source_ids
                .iter()
                .filter_map(|source_id| {
                    source_by_id
                        .get(source_id)
                        .map(|source_unit| SplitTargetSourceInput {
                            source_id: *source_id,
                            source_text: source_unit.text.clone(),
                        })
                })
                .collect::<Vec<_>>();
            Some(SplitTargetInput {
                target_id: alignment.target_id,
                target_text: target_unit.text.clone(),
                sources,
            })
        })
        .collect()
}

pub fn build_split_target_prompt(split_targets: &[SplitTargetInput]) -> Result<String, String> {
    let prompt_input = SplitTargetPromptInput {
        split_targets: split_targets.to_vec(),
    };
    let input_json = serde_json::to_string_pretty(&prompt_input)
        .map_err(|error| format!("Could not serialize split target prompt input: {error}"))?;

    Ok(format!(
        r#"You split target-language text units into the parts that correspond to each source-language unit.

Rules:
- Return JSON matching the provided schema.
- Return every split target exactly once.
- For each split target, return one or more fragments for each source id listed in that target's sources.
- Each targetTextFragment must be copied exactly from the targetText. Do not paraphrase or translate.
- Do not include source text in the response.
- Do not include confidence, rationale, commentary, or extra fields.
- The returned targetTextFragments should cover the full targetText except for whitespace-only gaps.
- Fragments must not overlap.
- Preserve the reading order of fragments.

Input:
{input_json}"#
    ))
}

pub fn apply_split_target_validation(
    report: &mut AlignmentReport,
    split_prompt: Option<&str>,
    validation: SplitTargetValidationResult,
) {
    report.split_prompt_hash = split_prompt.map(prompt_hash);
    report.split_targets = validation.split_targets;
    report.split_target_errors = validation.errors;
}

pub fn validate_split_target_response(
    response: SplitTargetResponse,
    expected_split_targets: &[SplitTargetInput],
) -> SplitTargetValidationResult {
    let expected_by_id = expected_split_targets
        .iter()
        .map(|target| (target.target_id, target))
        .collect::<HashMap<_, _>>();
    let mut response_by_id: HashMap<usize, SplitTargetResponseItem> = HashMap::new();
    let mut errors = Vec::new();

    for item in response.split_targets {
        if !expected_by_id.contains_key(&item.target_id) {
            errors.push(SplitTargetError {
                target_id: item.target_id,
                target_text: String::new(),
                sources: Vec::new(),
                raw_fragments: item.fragments,
                errors: vec![format!(
                    "GPT returned split target id {}, but that target is not a split target.",
                    item.target_id
                )],
            });
            continue;
        }

        if let Some(previous) = response_by_id.insert(item.target_id, item) {
            let expected = expected_by_id[&previous.target_id];
            errors.push(SplitTargetError {
                target_id: previous.target_id,
                target_text: expected.target_text.clone(),
                sources: expected.sources.clone(),
                raw_fragments: previous.fragments,
                errors: vec![format!(
                    "GPT returned split target id {} more than once.",
                    expected.target_id
                )],
            });
        }
    }

    let mut split_targets = Vec::new();
    for expected in expected_split_targets {
        let Some(response_item) = response_by_id.remove(&expected.target_id) else {
            errors.push(SplitTargetError {
                target_id: expected.target_id,
                target_text: expected.target_text.clone(),
                sources: expected.sources.clone(),
                raw_fragments: Vec::new(),
                errors: vec![format!(
                    "GPT omitted split target id {}.",
                    expected.target_id
                )],
            });
            continue;
        };

        match validate_one_split_target(expected, &response_item.fragments) {
            Ok(validated) => split_targets.push(validated),
            Err(error) => errors.push(error),
        }
    }

    SplitTargetValidationResult {
        split_targets,
        errors,
    }
}

fn validate_one_split_target(
    expected: &SplitTargetInput,
    raw_fragments: &[SplitTargetFragmentHint],
) -> Result<ValidatedSplitTarget, SplitTargetError> {
    let allowed_source_ids = expected
        .sources
        .iter()
        .map(|source| source.source_id)
        .collect::<HashSet<_>>();
    let mut errors = Vec::new();
    let mut occupied_non_whitespace = HashSet::new();
    let mut fragments = Vec::new();

    for raw_fragment in raw_fragments {
        if !allowed_source_ids.contains(&raw_fragment.source_id) {
            errors.push(format!(
                "Fragment uses source id {}, but that source is not listed for target id {}.",
                raw_fragment.source_id, expected.target_id
            ));
            continue;
        }

        if raw_fragment.target_text_fragment.trim().is_empty() {
            errors.push(format!(
                "Fragment for source id {} is empty or whitespace only.",
                raw_fragment.source_id
            ));
            continue;
        }

        let Some(range) = find_next_non_overlapping_range(
            &expected.target_text,
            &raw_fragment.target_text_fragment,
            &occupied_non_whitespace,
        ) else {
            errors.push(format!(
                "Could not locate fragment for source id {} in target id {}: {:?}.",
                raw_fragment.source_id, expected.target_id, raw_fragment.target_text_fragment
            ));
            continue;
        };

        for char_index in range[0]..range[1] {
            if target_char_at(&expected.target_text, char_index)
                .map(char::is_whitespace)
                .unwrap_or(true)
            {
                continue;
            }
            if !occupied_non_whitespace.insert(char_index) {
                errors.push(format!(
                    "Fragment for source id {} overlaps another fragment on non-whitespace character index {}.",
                    raw_fragment.source_id, char_index
                ));
            }
        }

        fragments.push(SplitTargetFragment {
            source_id: raw_fragment.source_id,
            range,
            text: substring_by_char_range(&expected.target_text, range),
        });
    }

    for source in &expected.sources {
        let has_non_whitespace_fragment = fragments.iter().any(|fragment| {
            fragment.source_id == source.source_id && !fragment.text.trim().is_empty()
        });
        if !has_non_whitespace_fragment {
            errors.push(format!(
                "Source id {} has no non-whitespace target fragment.",
                source.source_id
            ));
        }
    }

    let uncovered = expected
        .target_text
        .chars()
        .enumerate()
        .filter_map(|(char_index, character)| {
            if character.is_whitespace() || occupied_non_whitespace.contains(&char_index) {
                None
            } else {
                Some(char_index)
            }
        })
        .collect::<Vec<_>>();
    if !uncovered.is_empty() {
        errors.push(format!(
            "Target id {} has uncovered non-whitespace character indices: {}.",
            expected.target_id,
            join_ids(&uncovered)
        ));
    }

    if errors.is_empty() {
        Ok(ValidatedSplitTarget {
            target_id: expected.target_id,
            fragments,
        })
    } else {
        Err(SplitTargetError {
            target_id: expected.target_id,
            target_text: expected.target_text.clone(),
            sources: expected.sources.clone(),
            raw_fragments: raw_fragments.to_vec(),
            errors,
        })
    }
}

fn find_next_non_overlapping_range(
    target_text: &str,
    fragment: &str,
    occupied_non_whitespace: &HashSet<usize>,
) -> Option<[usize; 2]> {
    let mut byte_offset = 0;
    while byte_offset <= target_text.len() {
        let relative = target_text[byte_offset..].find(fragment)?;
        let start_byte = byte_offset + relative;
        let end_byte = start_byte + fragment.len();
        let start_char = byte_to_char_index(target_text, start_byte)?;
        let end_char = byte_to_char_index(target_text, end_byte)?;
        let overlaps = (start_char..end_char).any(|char_index| {
            occupied_non_whitespace.contains(&char_index)
                && target_char_at(target_text, char_index)
                    .map(|character| !character.is_whitespace())
                    .unwrap_or(false)
        });
        if !overlaps {
            return Some([start_char, end_char]);
        }
        byte_offset = next_char_boundary(target_text, start_byte)?;
    }
    None
}

fn byte_to_char_index(text: &str, byte_index: usize) -> Option<usize> {
    if byte_index == text.len() {
        return Some(text.chars().count());
    }
    text.char_indices()
        .position(|(current_byte_index, _)| current_byte_index == byte_index)
}

fn next_char_boundary(text: &str, byte_index: usize) -> Option<usize> {
    text[byte_index..]
        .char_indices()
        .nth(1)
        .map(|(offset, _)| byte_index + offset)
        .or_else(|| (byte_index < text.len()).then_some(text.len()))
}

fn target_char_at(text: &str, char_index: usize) -> Option<char> {
    text.chars().nth(char_index)
}

fn substring_by_char_range(text: &str, range: [usize; 2]) -> String {
    text.chars()
        .skip(range[0])
        .take(range[1].saturating_sub(range[0]))
        .collect()
}

pub fn render_alignment_html(report: &AlignmentReport) -> String {
    let target_by_id = report
        .target_units
        .iter()
        .map(|unit| (unit.id, unit))
        .collect::<HashMap<_, _>>();
    let first_source_by_target_id = report
        .alignments
        .iter()
        .filter_map(|alignment| {
            alignment
                .source_ids
                .first()
                .copied()
                .map(|source_id| (alignment.target_id, source_id))
        })
        .collect::<HashMap<_, _>>();
    let split_target_by_id = report
        .split_targets
        .iter()
        .map(|split_target| (split_target.target_id, split_target))
        .collect::<HashMap<_, _>>();
    let unresolved_split_target_ids = report
        .split_target_errors
        .iter()
        .map(|error| error.target_id)
        .collect::<HashSet<_>>();
    let mut targets_by_source_id: BTreeMap<usize, Vec<TargetDisplayBlock<'_>>> = BTreeMap::new();
    let mut unaligned_rows_by_slot: BTreeMap<usize, Vec<UnalignedTargetRow<'_>>> = BTreeMap::new();

    for alignment in &report.alignments {
        let Some(target_unit) = target_by_id.get(&alignment.target_id) else {
            continue;
        };

        if alignment.source_ids.is_empty() {
            let placement =
                infer_unaligned_target_placement(target_unit, report, &first_source_by_target_id);
            unaligned_rows_by_slot
                .entry(placement.insert_before_source_index)
                .or_default()
                .push(UnalignedTargetRow {
                    target_unit,
                    uncertain: placement.uncertain,
                });
            continue;
        }

        if alignment.source_ids.len() > 1 {
            if let Some(split_target) = split_target_by_id.get(&alignment.target_id) {
                for source_id in &alignment.source_ids {
                    for fragment in split_target
                        .fragments
                        .iter()
                        .filter(|fragment| fragment.source_id == *source_id)
                    {
                        targets_by_source_id.entry(*source_id).or_default().push(
                            TargetDisplayBlock {
                                target_unit,
                                fragment: Some(fragment),
                                split_unresolved: false,
                            },
                        );
                    }
                }
                continue;
            }
        }

        for source_id in &alignment.source_ids {
            targets_by_source_id
                .entry(*source_id)
                .or_default()
                .push(TargetDisplayBlock {
                    target_unit,
                    fragment: None,
                    split_unresolved: unresolved_split_target_ids.contains(&alignment.target_id),
                });
        }
    }

    let mut html = String::new();
    html.push_str("<!doctype html>\n<html lang=\"en\">\n<head>\n");
    html.push_str("<meta charset=\"utf-8\">\n");
    html.push_str("<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n");
    html.push_str("<title>Alignment Report</title>\n");
    html.push_str("<style>\n");
    html.push_str(
        "body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,\"Segoe UI\",sans-serif;color:#18212f;background:#f7f8fb;}\n",
    );
    html.push_str("main{padding:20px;max-width:1500px;margin:0 auto;}\n");
    html.push_str("h1{font-size:22px;margin:0 0 6px;}\n");
    html.push_str(".meta{color:#5b6472;font-size:13px;margin:0 0 18px;}\n");
    html.push_str(".checks{display:inline-block;margin:0 0 14px;padding:5px 8px;border:1px solid #b8d8c2;background:#eef8f1;color:#176033;font-size:13px;font-weight:700;}\n");
    html.push_str(".checks-failed{border-color:#efb4ac;background:#fff1ef;color:#9d2b1e;}\n");
    html.push_str("table{width:100%;border-collapse:collapse;table-layout:fixed;background:#fff;border:1px solid #d7deea;}\n");
    html.push_str("th,td{border-bottom:1px solid #e7ebf2;vertical-align:top;text-align:left;padding:10px 12px;line-height:1.5;white-space:pre-wrap;}\n");
    html.push_str("th{position:sticky;top:0;background:#eef2f7;z-index:1;font-size:13px;}\n");
    html.push_str(
        ".id{display:inline-block;min-width:42px;color:#697386;font-size:12px;font-weight:700;}\n",
    );
    html.push_str(".target-unit+.target-unit{margin-top:8px;}\n");
    html.push_str(".empty{color:#9aa3b2;}\n");
    html.push_str(".uncertain{color:#8a5a00;font-size:12px;font-weight:700;margin-top:5px;}\n");
    html.push_str(".warning{color:#9d2b1e;font-size:12px;font-weight:700;margin-top:5px;}\n");
    html.push_str("</style>\n</head>\n<body>\n<main>\n");
    html.push_str("<h1>Alignment Report</h1>\n");
    html.push_str(&format!(
        "<p class=\"meta\">Model: {} &nbsp; Prompt hash: {}</p>\n",
        escape_html(&report.model_id),
        escape_html(&report.prompt_hash)
    ));
    let failed_final_checks = report
        .final_checks
        .iter()
        .filter(|check| !check.passed)
        .map(|check| check.name.as_str())
        .collect::<Vec<_>>();
    if report.final_checks.is_empty() {
        html.push_str("<div class=\"checks checks-failed\">Final checks: not run</div>\n");
    } else if failed_final_checks.is_empty() {
        html.push_str("<div class=\"checks\">Final checks: passed</div>\n");
    } else {
        html.push_str(&format!(
            "<div class=\"checks checks-failed\">Final checks failed: {}</div>\n",
            escape_html(&failed_final_checks.join(", "))
        ));
    }
    html.push_str(
        "<table>\n<thead><tr><th>Source</th><th>Aligned Target</th></tr></thead>\n<tbody>\n",
    );

    for (source_index, source_unit) in report.source_units.iter().enumerate() {
        append_unaligned_rows(&mut html, &unaligned_rows_by_slot, source_index);
        html.push_str("<tr><td>");
        html.push_str(&format!(
            "<span class=\"id\">S{}</span>{}",
            source_unit.id,
            escape_html(&source_unit.text)
        ));
        html.push_str("</td><td>");
        if let Some(targets) = targets_by_source_id.get(&source_unit.id) {
            html.push_str(&render_target_blocks(targets));
        } else {
            html.push_str("<span class=\"empty\">No target unit aligned</span>");
        }
        html.push_str("</td></tr>\n");
    }

    append_unaligned_rows(
        &mut html,
        &unaligned_rows_by_slot,
        report.source_units.len(),
    );
    html.push_str("</tbody>\n</table>\n");

    html.push_str("</main>\n</body>\n</html>\n");
    html
}

#[derive(Clone, Copy, Debug)]
struct UnalignedPlacement {
    insert_before_source_index: usize,
    uncertain: bool,
}

#[derive(Clone, Copy, Debug)]
struct UnalignedTargetRow<'a> {
    target_unit: &'a TextUnit,
    uncertain: bool,
}

#[derive(Clone, Copy, Debug)]
struct TargetDisplayBlock<'a> {
    target_unit: &'a TextUnit,
    fragment: Option<&'a SplitTargetFragment>,
    split_unresolved: bool,
}

fn infer_unaligned_target_placement(
    target_unit: &TextUnit,
    report: &AlignmentReport,
    first_source_by_target_id: &HashMap<usize, usize>,
) -> UnalignedPlacement {
    let source_count = report.source_units.len();
    let previous_source = report
        .target_units
        .iter()
        .rev()
        .filter(|unit| unit.id < target_unit.id)
        .find_map(|unit| first_source_by_target_id.get(&unit.id).copied());
    let next_source = report
        .target_units
        .iter()
        .filter(|unit| unit.id > target_unit.id)
        .find_map(|unit| first_source_by_target_id.get(&unit.id).copied());

    match (previous_source, next_source) {
        (Some(previous), Some(next)) if previous <= next => UnalignedPlacement {
            insert_before_source_index: previous.min(source_count),
            uncertain: false,
        },
        (Some(previous), Some(next)) => {
            let previous_target =
                nearest_target_id_for_source(previous, report, first_source_by_target_id);
            let next_target = nearest_target_id_for_source(next, report, first_source_by_target_id);
            let previous_gap = target_unit.id.saturating_sub(previous_target);
            let next_gap = next_target.saturating_sub(target_unit.id);
            if previous_gap <= next_gap {
                UnalignedPlacement {
                    insert_before_source_index: previous.min(source_count),
                    uncertain: true,
                }
            } else {
                UnalignedPlacement {
                    insert_before_source_index: next.saturating_sub(1).min(source_count),
                    uncertain: true,
                }
            }
        }
        (Some(previous), None) => UnalignedPlacement {
            insert_before_source_index: previous.min(source_count),
            uncertain: false,
        },
        (None, Some(next)) => UnalignedPlacement {
            insert_before_source_index: next.saturating_sub(1).min(source_count),
            uncertain: false,
        },
        (None, None) => UnalignedPlacement {
            insert_before_source_index: source_count,
            uncertain: true,
        },
    }
}

fn nearest_target_id_for_source(
    source_id: usize,
    report: &AlignmentReport,
    first_source_by_target_id: &HashMap<usize, usize>,
) -> usize {
    report
        .target_units
        .iter()
        .find(|unit| first_source_by_target_id.get(&unit.id).copied() == Some(source_id))
        .map(|unit| unit.id)
        .unwrap_or(0)
}

fn append_unaligned_rows(
    html: &mut String,
    unaligned_rows_by_slot: &BTreeMap<usize, Vec<UnalignedTargetRow<'_>>>,
    slot: usize,
) {
    let Some(rows) = unaligned_rows_by_slot.get(&slot) else {
        return;
    };

    for row in rows {
        html.push_str("<tr><td><span class=\"empty\">No source unit aligned</span></td><td>");
        html.push_str(&render_target_units(&[row.target_unit]));
        if row.uncertain {
            html.push_str("<div class=\"uncertain\">Unaligned, uncertain position</div>");
        }
        html.push_str("</td></tr>\n");
    }
}

fn render_target_units(targets: &[&TextUnit]) -> String {
    let mut html = String::new();
    for target in targets {
        if !html.is_empty() {
            html.push('\n');
        }
        html.push_str("<div class=\"target-unit\">");
        html.push_str(&format!(
            "<span class=\"id\">T{}</span>{}",
            target.id,
            escape_html(&target.text)
        ));
        html.push_str("</div>");
    }
    html
}

fn render_target_blocks(targets: &[TargetDisplayBlock<'_>]) -> String {
    let mut html = String::new();
    for target in targets {
        if !html.is_empty() {
            html.push('\n');
        }
        let text = target
            .fragment
            .map(|fragment| fragment.text.as_str())
            .unwrap_or(target.target_unit.text.as_str());
        html.push_str("<div class=\"target-unit\">");
        html.push_str(&format!(
            "<span class=\"id\">T{}</span>{}",
            target.target_unit.id,
            escape_html(text)
        ));
        if target.split_unresolved {
            html.push_str("<div class=\"warning\">Split target unresolved</div>");
        }
        html.push_str("</div>");
    }
    html
}

fn escape_html(text: &str) -> String {
    let mut escaped = String::with_capacity(text.len());
    for character in text.chars() {
        match character {
            '&' => escaped.push_str("&amp;"),
            '<' => escaped.push_str("&lt;"),
            '>' => escaped.push_str("&gt;"),
            '"' => escaped.push_str("&quot;"),
            '\'' => escaped.push_str("&#39;"),
            _ => escaped.push(character),
        }
    }
    escaped
}

fn join_ids(ids: &[usize]) -> String {
    ids.iter()
        .map(|id| id.to_string())
        .collect::<Vec<_>>()
        .join(", ")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_units_ignores_blank_lines_and_trims_text() {
        let units = parse_units("  first  \n\n\tsecond\t\n   \nthird");

        assert_eq!(
            units,
            vec![
                TextUnit {
                    id: 1,
                    text: "first".to_string(),
                    original_line_number: 1,
                },
                TextUnit {
                    id: 2,
                    text: "second".to_string(),
                    original_line_number: 3,
                },
                TextUnit {
                    id: 3,
                    text: "third".to_string(),
                    original_line_number: 5,
                },
            ]
        );
    }

    #[test]
    fn parse_units_handles_crlf_and_lf_inputs() {
        let units = parse_units("one\r\ntwo\n\nthree\r\n");

        assert_eq!(
            units
                .iter()
                .map(|unit| unit.text.as_str())
                .collect::<Vec<_>>(),
            ["one", "two", "three"]
        );
        assert_eq!(
            units
                .iter()
                .map(|unit| unit.original_line_number)
                .collect::<Vec<_>>(),
            vec![1, 2, 4]
        );
    }

    #[test]
    fn validate_accepts_supported_alignment_shapes() {
        let source_units = parse_units("a\nb\nc");
        let target_units = parse_units("x\ny\nz\nw");
        let response = AlignmentResponse {
            alignments: vec![
                Alignment {
                    target_id: 1,
                    source_ids: vec![1],
                },
                Alignment {
                    target_id: 2,
                    source_ids: vec![2, 3],
                },
                Alignment {
                    target_id: 3,
                    source_ids: vec![3],
                },
                Alignment {
                    target_id: 4,
                    source_ids: vec![],
                },
            ],
        };

        assert_eq!(
            validate_alignments(response, &source_units, &target_units).unwrap(),
            vec![
                Alignment {
                    target_id: 1,
                    source_ids: vec![1],
                },
                Alignment {
                    target_id: 2,
                    source_ids: vec![2, 3],
                },
                Alignment {
                    target_id: 3,
                    source_ids: vec![3],
                },
                Alignment {
                    target_id: 4,
                    source_ids: vec![],
                },
            ]
        );
    }

    #[test]
    fn validate_rejects_missing_target_ids() {
        let source_units = parse_units("a");
        let target_units = parse_units("x\ny");
        let response = AlignmentResponse {
            alignments: vec![Alignment {
                target_id: 1,
                source_ids: vec![1],
            }],
        };

        let error = validate_alignments(response, &source_units, &target_units).unwrap_err();
        assert!(error.contains("target ids: 2"));
    }

    #[test]
    fn validate_rejects_duplicate_target_ids() {
        let source_units = parse_units("a");
        let target_units = parse_units("x");
        let response = AlignmentResponse {
            alignments: vec![
                Alignment {
                    target_id: 1,
                    source_ids: vec![1],
                },
                Alignment {
                    target_id: 1,
                    source_ids: vec![],
                },
            ],
        };

        let error = validate_alignments(response, &source_units, &target_units).unwrap_err();
        assert!(error.contains("more than once"));
    }

    #[test]
    fn validate_rejects_out_of_range_source_ids() {
        let source_units = parse_units("a");
        let target_units = parse_units("x");
        let response = AlignmentResponse {
            alignments: vec![Alignment {
                target_id: 1,
                source_ids: vec![2],
            }],
        };

        let error = validate_alignments(response, &source_units, &target_units).unwrap_err();
        assert!(error.contains("source id 2"));
    }

    #[test]
    fn validate_rejects_out_of_range_target_ids() {
        let source_units = parse_units("a");
        let target_units = parse_units("x");
        let response = AlignmentResponse {
            alignments: vec![Alignment {
                target_id: 2,
                source_ids: vec![1],
            }],
        };

        let error = validate_alignments(response, &source_units, &target_units).unwrap_err();
        assert!(error.contains("target id 2"));
    }

    #[test]
    fn prompt_contains_input_units_and_requests_id_only_output() {
        let source_units = parse_units("Source text");
        let target_units = parse_units("Target text");
        let prompt = build_prompt(&source_units, &target_units).unwrap();
        let schema = alignment_response_schema();

        assert!(prompt.contains("\"sourceUnits\""));
        assert!(prompt.contains("\"targetUnits\""));
        assert!(prompt.contains("\"Source text\""));
        assert!(prompt.contains("\"Target text\""));
        assert!(prompt.contains("Do not copy, quote, rewrite, or translate any text"));
        assert!(schema.to_string().contains("targetId"));
        assert!(schema.to_string().contains("sourceIds"));
        assert!(!schema.to_string().contains("text"));
    }

    #[test]
    fn find_split_targets_extracts_multi_source_alignments() {
        let source_units = parse_units("S1\nS2\nS3");
        let target_units = parse_units("T1\nT2");
        let split_targets = find_split_targets(
            &[
                Alignment {
                    target_id: 1,
                    source_ids: vec![1],
                },
                Alignment {
                    target_id: 2,
                    source_ids: vec![2, 3],
                },
            ],
            &source_units,
            &target_units,
        );

        assert_eq!(split_targets.len(), 1);
        assert_eq!(split_targets[0].target_id, 2);
        assert_eq!(
            split_targets[0]
                .sources
                .iter()
                .map(|source| source.source_id)
                .collect::<Vec<_>>(),
            vec![2, 3]
        );
    }

    #[test]
    fn split_target_prompt_uses_target_fragments_only_schema() {
        let split_targets = vec![SplitTargetInput {
            target_id: 1,
            target_text: "Target A. Target B.".to_string(),
            sources: vec![
                SplitTargetSourceInput {
                    source_id: 1,
                    source_text: "Source A.".to_string(),
                },
                SplitTargetSourceInput {
                    source_id: 2,
                    source_text: "Source B.".to_string(),
                },
            ],
        }];
        let prompt = build_split_target_prompt(&split_targets).unwrap();
        let schema_json = split_target_response_schema().to_string();

        assert!(prompt.contains("\"splitTargets\""));
        assert!(prompt.contains("\"targetText\": \"Target A. Target B.\""));
        assert!(schema_json.contains("targetTextFragment"));
        assert!(!schema_json.contains("sourceText"));
        assert!(!schema_json.contains("confidence"));
    }

    #[test]
    fn validate_split_target_response_accepts_exact_fragments() {
        let expected = split_target_fixture("Alpha beta", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "Alpha".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 2,
                            target_text_fragment: "beta".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(validation.errors.is_empty());
        assert_eq!(
            validation.split_targets[0].fragments,
            vec![
                SplitTargetFragment {
                    source_id: 1,
                    range: [0, 5],
                    text: "Alpha".to_string(),
                },
                SplitTargetFragment {
                    source_id: 2,
                    range: [6, 10],
                    text: "beta".to_string(),
                },
            ]
        );
    }

    #[test]
    fn validate_split_target_response_resolves_repeated_text_left_to_right() {
        let expected = split_target_fixture("same same", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "same".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 2,
                            target_text_fragment: "same".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(validation.errors.is_empty());
        assert_eq!(validation.split_targets[0].fragments[0].range, [0, 4]);
        assert_eq!(validation.split_targets[0].fragments[1].range, [5, 9]);
    }

    #[test]
    fn validate_split_target_response_allows_multiple_fragments_for_one_source() {
        let expected = split_target_fixture("A B C", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "A".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 2,
                            target_text_fragment: "B".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "C".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(validation.errors.is_empty());
        assert_eq!(
            validation.split_targets[0]
                .fragments
                .iter()
                .map(|fragment| (fragment.source_id, fragment.range))
                .collect::<Vec<_>>(),
            vec![(1, [0, 1]), (2, [2, 3]), (1, [4, 5])]
        );
    }

    #[test]
    fn validate_split_target_response_uses_unicode_character_ranges() {
        let expected = split_target_fixture("áβ c", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "áβ".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 2,
                            target_text_fragment: "c".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(validation.errors.is_empty());
        assert_eq!(validation.split_targets[0].fragments[0].range, [0, 2]);
        assert_eq!(validation.split_targets[0].fragments[1].range, [3, 4]);
    }

    #[test]
    fn validate_split_target_response_allows_whitespace_only_gaps() {
        let expected = split_target_fixture("Alpha   beta", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "Alpha".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 2,
                            target_text_fragment: "beta".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(validation.errors.is_empty());
    }

    #[test]
    fn validate_split_target_response_reports_unknown_target_id() {
        let expected = split_target_fixture("Alpha beta", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 99,
                    fragments: Vec::new(),
                }],
            },
            &expected,
        );

        assert!(validation.errors.iter().any(|error| error
            .errors
            .iter()
            .any(|message| message.contains("not a split target"))));
    }

    #[test]
    fn validate_split_target_response_reports_unknown_source_id() {
        let expected = split_target_fixture("Alpha beta", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "Alpha".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 99,
                            target_text_fragment: "beta".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(validation.errors[0]
            .errors
            .iter()
            .any(|message| message.contains("source id 99")));
    }

    #[test]
    fn validate_split_target_response_reports_missing_source_fragment() {
        let expected = split_target_fixture("Alpha beta", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![SplitTargetFragmentHint {
                        source_id: 1,
                        target_text_fragment: "Alpha beta".to_string(),
                    }],
                }],
            },
            &expected,
        );

        assert!(validation.errors[0]
            .errors
            .iter()
            .any(|message| message.contains("Source id 2 has no")));
    }

    #[test]
    fn validate_split_target_response_reports_unlocatable_fragment() {
        let expected = split_target_fixture("Alpha beta", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "Alpha".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 2,
                            target_text_fragment: "gamma".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(validation.errors[0]
            .errors
            .iter()
            .any(|message| message.contains("Could not locate")));
    }

    #[test]
    fn validate_split_target_response_reports_overlapping_or_uncovered_fragments() {
        let expected = split_target_fixture("Alpha beta", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "Alpha beta".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 2,
                            target_text_fragment: "beta".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(!validation.errors.is_empty());
    }

    #[test]
    fn validate_split_target_response_reports_uncovered_non_whitespace() {
        let expected = split_target_fixture("Alpha beta", &[1, 2]);
        let validation = validate_split_target_response(
            SplitTargetResponse {
                split_targets: vec![SplitTargetResponseItem {
                    target_id: 1,
                    fragments: vec![
                        SplitTargetFragmentHint {
                            source_id: 1,
                            target_text_fragment: "Alpha".to_string(),
                        },
                        SplitTargetFragmentHint {
                            source_id: 2,
                            target_text_fragment: "bet".to_string(),
                        },
                    ],
                }],
            },
            &expected,
        );

        assert!(validation.errors[0]
            .errors
            .iter()
            .any(|message| message.contains("uncovered")));
    }

    #[test]
    fn render_alignment_html_labels_and_groups_split_targets_by_source_order() {
        let source_units = parse_units("Source <one>\nSource two");
        let target_units = parse_units("Target A\nTarget B\nTarget C");
        let report = AlignmentReport {
            model_id: "gpt-5.5".to_string(),
            prompt_hash: "abc123".to_string(),
            split_prompt_hash: None,
            source_units,
            target_units,
            alignments: vec![
                Alignment {
                    target_id: 1,
                    source_ids: vec![1],
                },
                Alignment {
                    target_id: 2,
                    source_ids: vec![1],
                },
                Alignment {
                    target_id: 3,
                    source_ids: vec![2],
                },
            ],
            split_targets: Vec::new(),
            split_target_errors: Vec::new(),
            final_checks: Vec::new(),
        };

        let html = render_alignment_html(&report);

        assert!(html.contains("Source &lt;one&gt;"));
        assert!(html.contains("<span class=\"id\">T1</span>Target A"));
        assert!(html.contains("<span class=\"id\">T2</span>Target B"));
        assert!(html.contains("Target C"));
    }

    #[test]
    fn render_alignment_html_places_unaligned_targets_in_table() {
        let report = AlignmentReport {
            model_id: "gpt-5.5".to_string(),
            prompt_hash: "abc123".to_string(),
            split_prompt_hash: None,
            source_units: parse_units("Source 1\nSource 2"),
            target_units: parse_units("Target 1\nTarget 2\nTarget 3"),
            alignments: vec![
                Alignment {
                    target_id: 1,
                    source_ids: vec![1],
                },
                Alignment {
                    target_id: 2,
                    source_ids: vec![],
                },
                Alignment {
                    target_id: 3,
                    source_ids: vec![2],
                },
            ],
            split_targets: Vec::new(),
            split_target_errors: Vec::new(),
            final_checks: Vec::new(),
        };

        let html = render_alignment_html(&report);

        assert!(html.contains("No source unit aligned"));
        assert!(html.contains("<span class=\"id\">T2</span>Target 2"));
        assert!(!html.contains("Unaligned Target Units"));
        assert!(html.find("Target 1").unwrap() < html.find("Target 2").unwrap());
        assert!(html.find("Target 2").unwrap() < html.find("Target 3").unwrap());
    }

    #[test]
    fn render_alignment_html_marks_mixed_order_unaligned_positions_uncertain() {
        let report = AlignmentReport {
            model_id: "gpt-5.5".to_string(),
            prompt_hash: "abc123".to_string(),
            split_prompt_hash: None,
            source_units: parse_units("Source 1\nSource 2\nSource 3"),
            target_units: parse_units("Target 1\nTarget 2\nTarget 3"),
            alignments: vec![
                Alignment {
                    target_id: 1,
                    source_ids: vec![3],
                },
                Alignment {
                    target_id: 2,
                    source_ids: vec![],
                },
                Alignment {
                    target_id: 3,
                    source_ids: vec![1],
                },
            ],
            split_targets: Vec::new(),
            split_target_errors: Vec::new(),
            final_checks: Vec::new(),
        };

        let html = render_alignment_html(&report);

        assert!(html.contains("Unaligned, uncertain position"));
    }

    #[test]
    fn render_alignment_html_uses_resolved_split_fragments() {
        let report = AlignmentReport {
            model_id: "gpt-5.5".to_string(),
            prompt_hash: "abc123".to_string(),
            split_prompt_hash: Some("def456".to_string()),
            source_units: parse_units("Source 1\nSource 2"),
            target_units: parse_units("Target one. Target two."),
            alignments: vec![Alignment {
                target_id: 1,
                source_ids: vec![1, 2],
            }],
            split_targets: vec![ValidatedSplitTarget {
                target_id: 1,
                fragments: vec![
                    SplitTargetFragment {
                        source_id: 1,
                        range: [0, 11],
                        text: "Target one.".to_string(),
                    },
                    SplitTargetFragment {
                        source_id: 2,
                        range: [12, 23],
                        text: "Target two.".to_string(),
                    },
                ],
            }],
            split_target_errors: Vec::new(),
            final_checks: Vec::new(),
        };

        let html = render_alignment_html(&report);

        assert!(html.find("Source 1").unwrap() < html.find("Target one.").unwrap());
        assert!(html.find("Source 2").unwrap() < html.find("Target two.").unwrap());
        assert!(!html.contains("Split target unresolved"));
    }

    #[test]
    fn render_alignment_html_falls_back_for_unresolved_split_targets() {
        let report = AlignmentReport {
            model_id: "gpt-5.5".to_string(),
            prompt_hash: "abc123".to_string(),
            split_prompt_hash: Some("def456".to_string()),
            source_units: parse_units("Source 1\nSource 2"),
            target_units: parse_units("Target one. Target two."),
            alignments: vec![Alignment {
                target_id: 1,
                source_ids: vec![1, 2],
            }],
            split_targets: Vec::new(),
            split_target_errors: vec![SplitTargetError {
                target_id: 1,
                target_text: "Target one. Target two.".to_string(),
                sources: vec![
                    SplitTargetSourceInput {
                        source_id: 1,
                        source_text: "Source 1".to_string(),
                    },
                    SplitTargetSourceInput {
                        source_id: 2,
                        source_text: "Source 2".to_string(),
                    },
                ],
                raw_fragments: Vec::new(),
                errors: vec!["test failure".to_string()],
            }],
            final_checks: Vec::new(),
        };

        let html = render_alignment_html(&report);

        assert!(html.contains("Target one. Target two."));
        assert!(html.contains("Split target unresolved"));
    }

    #[test]
    fn final_checks_pass_for_complete_source_and_target_output() {
        let source_units = parse_units("Source one\nSource two");
        let target_units = parse_units("Target one\nTarget two");
        let report = build_report(
            "gpt-5.5",
            "prompt",
            source_units,
            target_units,
            vec![
                Alignment {
                    target_id: 1,
                    source_ids: vec![1],
                },
                Alignment {
                    target_id: 2,
                    source_ids: vec![2],
                },
            ],
        );

        let checks = run_final_checks(&report);

        assert!(checks.iter().all(|check| check.passed));
    }

    #[test]
    fn final_checks_detect_missing_target_words_from_bad_split_fragments() {
        let mut report = build_report(
            "gpt-5.5",
            "prompt",
            parse_units("Source one\nSource two"),
            parse_units("Target one Target two"),
            vec![Alignment {
                target_id: 1,
                source_ids: vec![1, 2],
            }],
        );
        report.split_targets = vec![ValidatedSplitTarget {
            target_id: 1,
            fragments: vec![SplitTargetFragment {
                source_id: 1,
                range: [0, 10],
                text: "Target one".to_string(),
            }],
        }];

        let checks = run_final_checks(&report);
        let target_check = checks
            .iter()
            .find(|check| check.name == "targetWordCoverage")
            .unwrap();

        assert!(!target_check.passed);
        assert!(target_check
            .details
            .iter()
            .any(|detail| detail.contains("two")));
    }

    #[test]
    fn final_checks_allow_unresolved_split_fallback_duplication() {
        let mut report = build_report(
            "gpt-5.5",
            "prompt",
            parse_units("Source one\nSource two"),
            parse_units("Target one Target two"),
            vec![Alignment {
                target_id: 1,
                source_ids: vec![1, 2],
            }],
        );
        report.split_target_errors = vec![SplitTargetError {
            target_id: 1,
            target_text: "Target one Target two".to_string(),
            sources: vec![
                SplitTargetSourceInput {
                    source_id: 1,
                    source_text: "Source one".to_string(),
                },
                SplitTargetSourceInput {
                    source_id: 2,
                    source_text: "Source two".to_string(),
                },
            ],
            raw_fragments: Vec::new(),
            errors: vec!["test split failure".to_string()],
        }];

        let checks = run_final_checks(&report);
        let html = render_alignment_html(&report);

        assert!(checks.iter().all(|check| check.passed));
        assert!(html.contains("Split target unresolved"));
    }

    fn split_target_fixture(target_text: &str, source_ids: &[usize]) -> Vec<SplitTargetInput> {
        vec![SplitTargetInput {
            target_id: 1,
            target_text: target_text.to_string(),
            sources: source_ids
                .iter()
                .map(|source_id| SplitTargetSourceInput {
                    source_id: *source_id,
                    source_text: format!("Source {source_id}"),
                })
                .collect(),
        }]
    }
}
