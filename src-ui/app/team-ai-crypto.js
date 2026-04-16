const TEAM_AI_WRAPPED_KEY_ALGORITHM = "rsa-oaep-sha256-v1";

const TEAM_AI_RSA_KEYPAIR_OPTIONS = {
  name: "RSA-OAEP",
  modulusLength: 2048,
  publicExponent: new Uint8Array([1, 0, 1]),
  hash: "SHA-256",
};

function cryptoApi() {
  const api = globalThis.crypto;
  if (!api?.subtle) {
    throw new Error("WebCrypto is unavailable, so team AI key exchange cannot run.");
  }
  return api;
}

function base64Encode(bytes) {
  const chunkSize = 0x8000;
  let binary = "";
  for (let index = 0; index < bytes.length; index += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
  }

  if (typeof globalThis.btoa === "function") {
    return globalThis.btoa(binary);
  }
  if (typeof Buffer !== "undefined") {
    return Buffer.from(binary, "binary").toString("base64");
  }

  throw new Error("Base64 encoding is unavailable.");
}

function base64Decode(value) {
  const normalized = String(value ?? "").trim();
  if (!normalized) {
    return new Uint8Array();
  }

  const binary =
    typeof globalThis.atob === "function"
      ? globalThis.atob(normalized)
      : typeof Buffer !== "undefined"
        ? Buffer.from(normalized, "base64").toString("binary")
        : null;
  if (binary === null) {
    throw new Error("Base64 decoding is unavailable.");
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

function pemBody(value) {
  return String(value ?? "")
    .trim()
    .split("\n")
    .filter((line) => !line.startsWith("-----"))
    .join("");
}

function bytesToPem(bytes, label) {
  const base64 = base64Encode(bytes);
  const lines = base64.match(/.{1,64}/g) ?? [];
  return [
    `-----BEGIN ${label}-----`,
    ...lines,
    `-----END ${label}-----`,
  ].join("\n");
}

function pemToBytes(value, label) {
  const body = pemBody(value);
  if (!body) {
    throw new Error(`Missing ${label}.`);
  }
  return base64Decode(body);
}

async function importBrokerPublicKey(publicKeyPem) {
  return cryptoApi().subtle.importKey(
    "spki",
    pemToBytes(publicKeyPem, "broker public key"),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
}

async function importMemberPrivateKey(privateKeyPem) {
  return cryptoApi().subtle.importKey(
    "pkcs8",
    pemToBytes(privateKeyPem, "member private key"),
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["decrypt"],
  );
}

export async function generateTeamAiMemberKeypair() {
  const keypair = await cryptoApi().subtle.generateKey(
    TEAM_AI_RSA_KEYPAIR_OPTIONS,
    true,
    ["encrypt", "decrypt"],
  );
  const [publicKeyBytes, privateKeyBytes] = await Promise.all([
    cryptoApi().subtle.exportKey("spki", keypair.publicKey),
    cryptoApi().subtle.exportKey("pkcs8", keypair.privateKey),
  ]);

  return {
    publicKeyPem: bytesToPem(new Uint8Array(publicKeyBytes), "PUBLIC KEY"),
    privateKeyPem: bytesToPem(new Uint8Array(privateKeyBytes), "PRIVATE KEY"),
  };
}

export async function encryptTeamAiPlaintext(plaintext, publicKeyPem) {
  const normalizedPlaintext = String(plaintext ?? "").trim();
  if (!normalizedPlaintext) {
    throw new Error("Cannot encrypt an empty AI provider key.");
  }

  const ciphertext = await cryptoApi().subtle.encrypt(
    { name: "RSA-OAEP" },
    await importBrokerPublicKey(publicKeyPem),
    new TextEncoder().encode(normalizedPlaintext),
  );

  return {
    algorithm: TEAM_AI_WRAPPED_KEY_ALGORITHM,
    ciphertext: base64Encode(new Uint8Array(ciphertext)),
  };
}

export async function decryptTeamAiWrappedKey(wrappedKey, privateKeyPem) {
  const algorithm = String(wrappedKey?.algorithm ?? "").trim();
  if (algorithm !== TEAM_AI_WRAPPED_KEY_ALGORITHM) {
    throw new Error(`Unsupported team AI wrapped key algorithm '${algorithm || "unknown"}'.`);
  }

  const ciphertext = String(wrappedKey?.ciphertext ?? "").trim();
  if (!ciphertext) {
    throw new Error("The issued team AI key is missing ciphertext.");
  }

  const plaintext = await cryptoApi().subtle.decrypt(
    { name: "RSA-OAEP" },
    await importMemberPrivateKey(privateKeyPem),
    base64Decode(ciphertext),
  );

  const decoded = new TextDecoder().decode(plaintext).trim();
  if (!decoded) {
    throw new Error("The issued team AI key decrypted to an empty value.");
  }

  return decoded;
}
