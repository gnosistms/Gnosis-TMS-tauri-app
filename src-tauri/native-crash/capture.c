#include <sentry.h>

// All paths are absolute UTF-16 paths owned by the caller for this call.
__declspec(dllexport) int gnosis_capture_start(const wchar_t *database,
    const wchar_t *handler, const wchar_t *reporter, const char *release)
{
    sentry_options_t *options = sentry_options_new();
    sentry_options_set_database_pathw(options, database);
    sentry_options_set_handler_pathw(options, handler);
    sentry_options_set_external_crash_reporter_pathw(options, reporter);
    sentry_options_set_release(options, release);
    sentry_options_set_auto_session_tracking(options, 0);
    sentry_options_set_max_breadcrumbs(options, 0);
    sentry_options_set_crash_reporting_mode(options, SENTRY_CRASH_REPORTING_MODE_NATIVE);
    sentry_options_set_thread_stackwalk_mode(options, SENTRY_THREAD_STACKWALK_MODE_CRASHED_ONLY);
    return sentry_init(options);
}

__declspec(dllexport) void gnosis_capture_stop(void)
{
    sentry_close();
}
