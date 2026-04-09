export function slugifyRepoName(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
}

export function appendRepoNameSuffix(baseRepoName, suffixNumber) {
  const normalizedBase = String(baseRepoName ?? "").trim();
  if (!normalizedBase) {
    return "";
  }

  if (!Number.isFinite(suffixNumber) || suffixNumber <= 1) {
    return normalizedBase.slice(0, 100);
  }

  const suffix = `-${Math.trunc(suffixNumber)}`;
  const maxBaseLength = Math.max(1, 100 - suffix.length);
  return `${normalizedBase.slice(0, maxBaseLength)}${suffix}`;
}
