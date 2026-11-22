# Windows native crash reporting

- Start a native Windows crash reporter before opening the desktop window. Use Sentry events with stack frames and release symbols. Keep translation content, credentials and memory dumps out of uploads.
- Use the existing first-run disclosure and **Send error reports** setting for both reporters. Verify changes during a session and on the next launch, including opting out before an earlier report can be sent.
- Include the pinned Windows crash handler and matching debug symbols in the normal build and release process. Exercise an installed Windows package against an isolated receiver, using the real settings UI and a native test exception. Check report contents, on and off behavior, and ordinary startup. Land the change for the next regular release.
