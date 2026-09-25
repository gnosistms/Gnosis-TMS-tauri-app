//! Structured-output JSON schemas shared by every provider that supports them.
//! Each provider wraps the schema in its own request shape (OpenAI `text.format`,
//! Claude `output_config.format`).

use serde_json::{json, Value};

use crate::ai::types::AiPromptOutputFormat;

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
