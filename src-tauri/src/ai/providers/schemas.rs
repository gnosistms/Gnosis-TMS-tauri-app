//! Structured-output JSON schemas shared by every provider that supports them.
//! Each provider wraps the schema in its own request shape (OpenAI `text.format`,
//! Claude `output_config.format`).

use serde::ser::{SerializeMap, SerializeSeq};
use serde::{Serialize, Serializer};
use serde_json::{json, Map, Value};

use crate::ai::types::AiPromptOutputFormat;

/// Serializes a JSON schema with each object's `properties` in the order of
/// its `required` list (the order the schema was written in), then any other
/// properties. `serde_json` sorts object keys, and models that generate
/// structured output field by field follow the schema's property order: sorted
/// alphabetically, Claude had to state `isMatch` before `sourceSectionId` and
/// then often ended the list after one entry. Other keywords keep their order.
pub(crate) struct InAuthoredOrder<'a>(pub &'a Value);

impl Serialize for InAuthoredOrder<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self.0 {
            Value::Object(object) => {
                let mut map = serializer.serialize_map(Some(object.len()))?;
                for (key, value) in object {
                    match (key.as_str(), value) {
                        ("properties", Value::Object(properties)) => {
                            let required = object.get("required").and_then(Value::as_array);
                            map.serialize_entry(key, &PropertiesInOrder(properties, required))?;
                        }
                        _ => map.serialize_entry(key, &InAuthoredOrder(value))?,
                    }
                }
                map.end()
            }
            Value::Array(items) => {
                let mut seq = serializer.serialize_seq(Some(items.len()))?;
                for item in items {
                    seq.serialize_element(&InAuthoredOrder(item))?;
                }
                seq.end()
            }
            other => other.serialize(serializer),
        }
    }
}

struct PropertiesInOrder<'a>(&'a Map<String, Value>, Option<&'a Vec<Value>>);

impl Serialize for PropertiesInOrder<'_> {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let PropertiesInOrder(properties, required) = self;
        let first = required
            .map(|names| names.iter().filter_map(Value::as_str).collect::<Vec<_>>())
            .unwrap_or_default()
            .into_iter()
            .filter(|name| properties.contains_key(*name))
            .collect::<Vec<_>>();
        let mut map = serializer.serialize_map(Some(properties.len()))?;
        for name in &first {
            map.serialize_entry(name, &InAuthoredOrder(&properties[*name]))?;
        }
        for (name, schema) in properties.iter() {
            if !first.contains(&name.as_str()) {
                map.serialize_entry(name, &InAuthoredOrder(schema))?;
            }
        }
        map.end()
    }
}

pub(crate) struct OutputSchema {
    pub name: String,
    pub schema: Value,
}

/// The schema for a JSON output format, or `None` for plain text.
pub(crate) fn output_schema(output_format: &AiPromptOutputFormat) -> Option<OutputSchema> {
    let (name, schema) = match output_format {
        AiPromptOutputFormat::Text => return None,
        AiPromptOutputFormat::AssistantTurnJson => (
            "assistant_turn_response",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["responseKind", "assistantText", "draftTranslationText"],
                "properties": {
                    "responseKind": {
                        "type": "string",
                        "enum": ["translation_draft", "commentary", "mixed", "error"]
                    },
                    "assistantText": {
                        "type": "string"
                    },
                    "draftTranslationText": {
                        "anyOf": [
                            { "type": "string" },
                            { "type": "null" }
                        ]
                    }
                }
            }),
        ),
        AiPromptOutputFormat::TranslationSectionsJson => (
            "ai_translation_sections_response",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["translatedText", "translatedFootnote", "translatedImageCaption"],
                "properties": {
                    "translatedText": {
                        "type": "string"
                    },
                    "translatedFootnote": {
                        "type": "string"
                    },
                    "translatedImageCaption": {
                        "type": "string"
                    }
                }
            }),
        ),
        AiPromptOutputFormat::ReviewJson => (
            "ai_review_response",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["suggestedText", "suggestedFootnotes", "suggestedImageCaption", "reviewed"],
                "properties": {
                    "suggestedText": {
                        "type": "string"
                    },
                    "suggestedFootnotes": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["marker", "text"],
                            "properties": {
                                "marker": { "type": "integer", "minimum": 1 },
                                "text": { "type": "string" }
                            }
                        }
                    },
                    "suggestedImageCaption": {
                        "type": "string"
                    },
                    "reviewed": {
                        "type": "boolean"
                    }
                }
            }),
        ),
        AiPromptOutputFormat::TranslationBatchJson => (
            "ai_translation_batch_response",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["rows"],
                "properties": {
                    "rows": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                                "rowId",
                                "translatedText",
                                "translatedFootnote",
                                "translatedImageCaption"
                            ],
                            "properties": {
                                "rowId": { "type": "string" },
                                "translatedText": { "type": "string" },
                                "translatedFootnote": { "type": "string" },
                                "translatedImageCaption": { "type": "string" }
                            }
                        }
                    }
                }
            }),
        ),
        AiPromptOutputFormat::ReviewBatchJson => (
            "ai_review_batch_response",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["rows"],
                "properties": {
                    "rows": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": [
                                "rowId",
                                "suggestedText",
                                "suggestedFootnotes",
                                "suggestedImageCaption",
                                "reviewed"
                            ],
                            "properties": {
                                "rowId": { "type": "string" },
                                "suggestedText": { "type": "string" },
                                "suggestedFootnotes": {
                                    "type": "array",
                                    "items": {
                                        "type": "object",
                                        "additionalProperties": false,
                                        "required": ["marker", "text"],
                                        "properties": {
                                            "marker": { "type": "integer", "minimum": 1 },
                                            "text": { "type": "string" }
                                        }
                                    }
                                },
                                "suggestedImageCaption": { "type": "string" },
                                "reviewed": { "type": "boolean" }
                            }
                        }
                    }
                }
            }),
        ),
        AiPromptOutputFormat::GlossaryAlignmentJson => (
            "glossary_alignment_response",
            json!({
                "type": "object",
                "additionalProperties": false,
                "required": ["mappings"],
                "properties": {
                    "mappings": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "additionalProperties": false,
                            "required": ["id", "translationSourceTerm"],
                            "properties": {
                                "id": {
                                    "type": "string"
                                },
                                "translationSourceTerm": {
                                    "anyOf": [
                                        { "type": "string" },
                                        { "type": "null" }
                                    ]
                                }
                            }
                        }
                    }
                }
            }),
        ),
        AiPromptOutputFormat::JsonSchema { name, schema } => {
            return Some(OutputSchema {
                name: name.clone(),
                schema: schema.clone(),
            });
        }
    };

    Some(OutputSchema {
        name: name.to_string(),
        schema,
    })
}
