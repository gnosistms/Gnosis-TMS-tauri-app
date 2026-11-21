# Inspect the linked executable that Tauri is about to package.
$ErrorActionPreference = 'Stop'
$imports = llvm-readobj --coff-imports src-tauri/target/release/gnosis-tms.exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($imports -match '^\s*Name:\s*vertdll\.dll\s*$') {
    throw 'The Windows desktop executable imports the VBS enclave runtime (vertdll.dll).'
}
