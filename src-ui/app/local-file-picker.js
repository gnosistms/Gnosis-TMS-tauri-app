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
