export function installMockNavigator(navigatorValue = {}) {
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: navigatorValue,
  });
  return globalThis.navigator;
}

