use rand::distributions::Alphanumeric;
use rand::Rng;

/// Generate a cryptographically random alphanumeric token of the given length.
pub(crate) fn random_token(length: usize) -> String {
    rand::thread_rng()
        .sample_iter(&Alphanumeric)
        .take(length)
        .map(char::from)
        .collect()
}
