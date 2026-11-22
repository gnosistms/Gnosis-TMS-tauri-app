import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  const tauri = fileURLToPath(new URL("../src-tauri/", import.meta.url));
  const build = join(tauri, "target/windows-crash-sdk");
  const dest = join(tauri, "resources/windows/crash-reporter");
  execFileSync("cmake", ["-S", join(tauri, "native-crash"), "-B", build, "-A", "x64"], { stdio: "inherit" });
  execFileSync("cmake", ["--build", build, "--config", "Release", "--target", "gnosis-crash-capture", "--parallel"], { stdio: "inherit" });
  mkdirSync(dest, { recursive: true });
  for (const name of ["gnosis-crash-capture.dll", "sentry-crash.exe", "sentry-wer.dll"]) {
    copyFileSync(join(build, "bin/Release", name), join(dest, name));
  }
  copyFileSync(join(build, "LICENSE.txt"), join(dest, "LICENSE.txt"));
}
