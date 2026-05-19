export function openLocalFilePicker({ accept = "", multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple === true;
    input.style.display = "none";

    const cleanup = () => {
      input.removeEventListener("change", handleChange);
      input.removeEventListener("cancel", handleCancel);
      if (input.parentNode) {
        input.parentNode.removeChild(input);
      }
    };

    const handleChange = () => {
      const file = multiple === true
        ? Array.from(input.files ?? [])
        : input.files?.[0] ?? null;
      cleanup();
      resolve(file);
    };

    const handleCancel = () => {
      cleanup();
      resolve(null);
    };

    input.addEventListener("change", handleChange, { once: true });
    input.addEventListener("cancel", handleCancel, { once: true });
    document.body.appendChild(input);
    input.click();
  });
}

export async function openLocalFilePathPicker({ multiple = false, filters = [] } = {}) {
  const open = window.__TAURI__?.dialog?.open;
  if (typeof open !== "function") {
    return null;
  }

  const selected = await open({
    multiple: multiple === true,
    filters: Array.isArray(filters) ? filters : [],
  });
  if (!selected) {
    return [];
  }

  return (Array.isArray(selected) ? selected : [selected])
    .filter((path) => typeof path === "string" && path.trim())
    .map((path) => path.trim());
}
