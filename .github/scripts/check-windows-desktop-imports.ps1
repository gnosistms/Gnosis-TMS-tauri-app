# Inspect the linked executable that Tauri is about to package.
$ErrorActionPreference = 'Stop'
$imports = llvm-readobj --coff-imports src-tauri/target/release/gnosis-tms.exe
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
if ($imports -match '^\s*Name:\s*vertdll\.dll\s*$') {
    throw 'The Windows desktop executable imports the VBS enclave runtime (vertdll.dll).'
}

if ($env:GNOSIS_UPLOAD_WINDOWS_SYMBOLS -eq '1') {
    if (!$env:SENTRY_AUTH_TOKEN -or !$env:SENTRY_ORG -or !$env:SENTRY_PROJECT) {
        throw 'Windows crash symbols require the existing Sentry release credentials.'
    }
    $binary = 'src-tauri/target/release/gnosis-tms.exe'
    $symbols = 'src-tauri/target/release/gnosis_tms.pdb'
    if (!(Test-Path $symbols)) { throw "Missing release PDB: $symbols" }
    npx --yes @sentry/cli debug-files upload --wait $binary $symbols
    if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
}
