#[test]
fn ordinary_process_operations() {
    use std::io::Write;
    fn step(text: &str) { println!("PROBE {text}"); std::io::stdout().flush().unwrap(); }
    step("started");
    let _ = std::time::SystemTime::now();
    step("clock");
    let path = std::env::temp_dir();
    step("temp directory");
    let id = uuid::Uuid::now_v7();
    step("uuid");
    let root = path.join(format!("gnosis-native-observation-{id}"));
    std::fs::create_dir_all(&root).unwrap();
    step("created directory");
    std::fs::write(root.join("file.txt"), b"ordinary test file").unwrap();
    step("wrote file");
    let output = std::process::Command::new("git").arg("--version").output().unwrap();
    assert!(output.status.success());
    step("Git child returned");
    crate::repo_sync_shared::git_output(&root, &["init", "-b", "main"], None).unwrap();
    step("app Git command returned");
    std::fs::remove_dir_all(root).unwrap();
    step("complete");
}

