cmake_minimum_required(VERSION 3.24)
project(gnosis_windows_crash C CXX)
include(FetchContent)

set(SENTRY_BACKEND native CACHE STRING "")
# Only the Gnosis reporter can send a scrubbed event after checking the saved choice.
set(SENTRY_TRANSPORT none CACHE STRING "")
set(SENTRY_TRANSPORT_COMPRESSION OFF CACHE BOOL "")
set(SENTRY_BUILD_SHARED_LIBS OFF CACHE BOOL "")
set(SENTRY_BUILD_RUNTIMESTATIC ON CACHE BOOL "")
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(CMAKE_RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin")
FetchContent_Declare(sentry_native
  URL https://github.com/getsentry/sentry-native/releases/download/0.17.6/sentry-native.zip
  URL_HASH SHA256=40b4b70cbada5bfae5b73f8267831dd023ec676d9676fb0d890878f31d2b5055)
FetchContent_MakeAvailable(sentry_native)

add_library(gnosis-crash-capture SHARED capture.c)
target_link_libraries(gnosis-crash-capture PRIVATE sentry::sentry)
add_dependencies(gnosis-crash-capture sentry-crash sentry-wer)

file(READ "${sentry_native_SOURCE_DIR}/LICENSE" notices)
foreach(header vendor/mpack.c vendor/jsmn.h)
  file(READ "${sentry_native_SOURCE_DIR}/${header}" text LIMIT 4096)
  string(REGEX MATCH "/\\*[^*]*\\*+([^*/][^*]*\\*+)*/" notice "${text}")
  string(APPEND notices "\n${header}\n${notice}\n")
endforeach()
file(WRITE "${CMAKE_BINARY_DIR}/LICENSE.txt" "${notices}")
