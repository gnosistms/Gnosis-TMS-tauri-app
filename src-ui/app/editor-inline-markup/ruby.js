function normalizedLanguageCode(value) {
  return typeof value === "string" ? value.trim() : "";
}

export function isChineseLanguageCode(languageCode) {
  return normalizedLanguageCode(languageCode).toLowerCase().startsWith("zh");
}

export function rubyButtonConfig(languageCode) {
  const normalizedCode = normalizedLanguageCode(languageCode).toLowerCase();
  if (normalizedCode === "ja") {
    return {
      label: "振",
      tooltip: "ルビを挿入",
      placeholder: "よみ",
    };
  }

  if (isChineseLanguageCode(normalizedCode)) {
    return {
      label: "注",
      tooltip: "添加读音标注",
      placeholder: "读音",
    };
  }

  if (normalizedCode === "ko") {
    return {
      label: "주",
      tooltip: "발음 표기 추가",
      placeholder: "발음",
    };
  }

  return {
    label: "r",
    tooltip: "Ruby",
    placeholder: "ruby text here",
  };
}
