use alignment_lab::{alignment_response_schema, build_prompt, parse_units};

#[test]
fn prompt_contract_uses_object_arrays_and_schema_id_fields() {
    let source_units = parse_units("source one\nsource two");
    let target_units = parse_units("target one");
    let prompt = build_prompt(&source_units, &target_units).unwrap();
    let schema = alignment_response_schema();
    let schema_json = schema.to_string();

    assert!(prompt.contains("\"sourceUnits\": ["));
    assert!(prompt.contains("\"targetUnits\": ["));
    assert!(prompt.contains("\"id\": 1"));
    assert!(prompt.contains("\"text\": \"source one\""));
    assert!(schema_json.contains("\"targetId\""));
    assert!(schema_json.contains("\"sourceIds\""));
    assert!(!schema_json.contains("confidence"));
    assert!(!schema_json.contains("rationale"));
}
