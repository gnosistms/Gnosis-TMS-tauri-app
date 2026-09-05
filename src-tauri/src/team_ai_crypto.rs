//! RSA-OAEP/SHA-256 wire compatibility with WebCrypto and the existing broker.
use crate::{ai_secret_storage::TeamAiMemberKeypair, team_ai::TeamAiWrappedKeyRecord};
use aws_lc_rs::{
    encoding::{AsDer, Pkcs8V1Der, PublicKeyX509Der},
    rsa::{
        KeySize, OaepPrivateDecryptingKey, OaepPublicEncryptingKey, PrivateDecryptingKey,
        PublicEncryptingKey, OAEP_SHA256_MGF1SHA256,
    },
};
use base64::{engine::general_purpose::STANDARD, Engine};
use zeroize::Zeroizing;
pub(crate) const ALGORITHM: &str = "rsa-oaep-sha256-v1";
fn pem(label: &str, data: &[u8]) -> String {
    let encoded = Zeroizing::new(STANDARD.encode(data));
    let body = Zeroizing::new(
        encoded
            .as_bytes()
            .chunks(64)
            .map(|line| String::from_utf8_lossy(line))
            .collect::<Vec<_>>()
            .join("\n"),
    );
    format!(
        "-----BEGIN {label}-----\n{}\n-----END {label}-----",
        body.as_str()
    )
}
fn der(pem: &str) -> Result<Zeroizing<Vec<u8>>, String> {
    let body = Zeroizing::new(
        pem.lines()
            .filter(|line| !line.starts_with("-----"))
            .collect::<String>(),
    );
    STANDARD
        .decode(body.as_bytes())
        .map(Zeroizing::new)
        .map_err(|_| "The team AI encryption key is invalid.".into())
}
pub(crate) fn generate() -> Result<TeamAiMemberKeypair, String> {
    let key = PrivateDecryptingKey::generate(KeySize::Rsa2048)
        .map_err(|_| "Could not generate a team AI encryption key.")?;
    let private = AsDer::<Pkcs8V1Der>::as_der(&key)
        .map_err(|_| "Could not encode the team AI encryption key.")?;
    let public = AsDer::<PublicKeyX509Der>::as_der(&key.public_key())
        .map_err(|_| "Could not encode the team AI public key.")?;
    Ok(TeamAiMemberKeypair {
        public_key_pem: pem("PUBLIC KEY", public.as_ref()),
        private_key_pem: pem("PRIVATE KEY", private.as_ref()),
    })
}
pub(crate) fn encrypt(plaintext: &str, public_pem: &str) -> Result<TeamAiWrappedKeyRecord, String> {
    let public = PublicEncryptingKey::from_der(&der(public_pem)?)
        .map_err(|_| "The broker AI public key is invalid.")?;
    let key = OaepPublicEncryptingKey::new(public)
        .map_err(|_| "The broker AI public key is unsupported.")?;
    let mut output = vec![0; key.ciphertext_size()];
    let encrypted = key
        .encrypt(
            &OAEP_SHA256_MGF1SHA256,
            plaintext.trim().as_bytes(),
            &mut output,
            None,
        )
        .map_err(|_| "Could not encrypt the AI key for this broker.")?;
    Ok(TeamAiWrappedKeyRecord {
        algorithm: ALGORITHM.into(),
        ciphertext: STANDARD.encode(encrypted),
    })
}
pub(crate) fn decrypt(
    wrapped: &TeamAiWrappedKeyRecord,
    private_pem: &str,
) -> Result<Zeroizing<String>, String> {
    if wrapped.algorithm != ALGORITHM {
        return Err("The issued team AI key uses an unsupported encryption algorithm.".into());
    }
    let private = PrivateDecryptingKey::from_pkcs8(&der(private_pem)?)
        .map_err(|_| "The team AI private key is invalid.")?;
    let key = OaepPrivateDecryptingKey::new(private)
        .map_err(|_| "The team AI private key is unsupported.")?;
    let ciphertext = STANDARD
        .decode(&wrapped.ciphertext)
        .map_err(|_| "The issued team AI key is invalid.")?;
    let mut output = Zeroizing::new(vec![0; key.min_output_size()]);
    let plain = key
        .decrypt(&OAEP_SHA256_MGF1SHA256, &ciphertext, &mut output, None)
        .map_err(|_| "Could not decrypt the issued team AI key.")?;
    let text = std::str::from_utf8(plain)
        .map_err(|_| "The issued team AI key is invalid.")?
        .trim();
    if text.is_empty() {
        return Err("The issued team AI key is empty.".into());
    }
    Ok(Zeroizing::new(text.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::{
        io::Write,
        process::{Command, Stdio},
    };

    // The original frontend implementation is now only a test reference. Synthetic
    // keys travel over subprocess pipes, never files or command-line arguments.
    fn webcrypto(input: serde_json::Value) -> serde_json::Value {
        let mut child = Command::new("node").args(["--input-type=module", "-e", r#"
            import { readFileSync } from 'node:fs';
            import { pathToFileURL } from 'node:url';
            const { decryptTeamAiWrappedKey, encryptTeamAiPlaintext } = await import(pathToFileURL(process.argv[1]));
            const input = JSON.parse(readFileSync(0, 'utf8'));
            const output = input.action === 'encrypt'
                ? await encryptTeamAiPlaintext(input.text, input.publicKey)
                : await decryptTeamAiWrappedKey(input.wrapped, input.privateKey);
            process.stdout.write(JSON.stringify(output));
        "#, concat!(env!("CARGO_MANIFEST_DIR"), "/../src-ui/test/team-ai-webcrypto.js")])
            .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
        child
            .stdin
            .take()
            .unwrap()
            .write_all(&serde_json::to_vec(&input).unwrap())
            .unwrap();
        let output = child.wait_with_output().unwrap();
        assert!(
            output.status.success(),
            "WebCrypto interoperability check failed"
        );
        serde_json::from_slice(&output.stdout).unwrap()
    }
    #[test]
    fn native_owner_and_member_exchange_matches_webcrypto_for_all_providers() {
        let pair = generate().unwrap();
        for provider in ["openai", "gemini", "claude", "deepseek"] {
            let secret = format!("synthetic-{provider}-credential");
            let wrapped = encrypt(&secret, &pair.public_key_pem).unwrap();
            assert_eq!(
                webcrypto(
                    serde_json::json!({"action":"decrypt", "wrapped":wrapped, "privateKey":pair.private_key_pem})
                ),
                secret
            );
            let incoming: TeamAiWrappedKeyRecord = serde_json::from_value(webcrypto(serde_json::json!({"action":"encrypt", "text":secret, "publicKey":pair.public_key_pem}))).unwrap();
            assert_eq!(*decrypt(&incoming, &pair.private_key_pem).unwrap(), secret);
        }
    }
    #[test]
    fn malformed_or_wrong_recipient_ciphertext_never_returns_plaintext() {
        let pair = generate().unwrap();
        let other = generate().unwrap();
        let mut wrapped = encrypt("synthetic-secret", &pair.public_key_pem).unwrap();
        assert!(decrypt(&wrapped, &other.private_key_pem).is_err());
        wrapped.algorithm = "unknown".into();
        assert!(decrypt(&wrapped, &pair.private_key_pem).is_err());
        wrapped.algorithm = ALGORITHM.into();
        wrapped.ciphertext = "invalid-base64!".into();
        assert!(decrypt(&wrapped, &pair.private_key_pem).is_err());
    }
}
