cmake_minimum_required(VERSION 3.24)

project(SirKevinAudioEngine VERSION 0.1.0 LANGUAGES CXX)

include(FetchContent)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
set(JUCE_BUILD_EXAMPLES OFF CACHE BOOL "" FORCE)
set(JUCE_BUILD_EXTRAS OFF CACHE BOOL "" FORCE)

FetchContent_Declare(
  JUCE
  GIT_REPOSITORY https://github.com/juce-framework/JUCE.git
  GIT_TAG 8.0.6
  GIT_SHALLOW TRUE
)
FetchContent_MakeAvailable(JUCE)

juce_add_console_app(sir-kevin-audio-engine
  PRODUCT_NAME "SIR. KEVIN Audio Engine"
)

juce_generate_juce_header(sir-kevin-audio-engine)

target_sources(sir-kevin-audio-engine PRIVATE
  src/app/main.cpp
  src/app/EngineApplication.cpp
  src/audio/AudioEngine.cpp
  src/audio/AudioEngine.h
)

target_compile_definitions(sir-kevin-audio-engine PRIVATE
  JUCE_WEB_BROWSER=0
  JUCE_USE_CURL=0
  JUCE_REPORT_APP_USAGE=0
)

target_link_libraries(sir-kevin-audio-engine PRIVATE
  juce::juce_audio_utils
  juce::juce_audio_formats
  juce::juce_recommended_config_flags
  juce::juce_recommended_warning_flags
)

set_target_properties(sir-kevin-audio-engine PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${CMAKE_BINARY_DIR}/bin"
  RUNTIME_OUTPUT_DIRECTORY_DEBUG "${CMAKE_BINARY_DIR}/bin/Debug"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${CMAKE_BINARY_DIR}/bin/Release"
  RUNTIME_OUTPUT_DIRECTORY_RELWITHDEBINFO "${CMAKE_BINARY_DIR}/bin/RelWithDebInfo"
  RUNTIME_OUTPUT_DIRECTORY_MINSIZEREL "${CMAKE_BINARY_DIR}/bin/MinSizeRel"
)

if(MSVC)
  target_compile_options(sir-kevin-audio-engine PRIVATE /W4 /permissive-)
else()
  target_compile_options(sir-kevin-audio-engine PRIVATE -Wall -Wextra -Wpedantic)
endif()

include(CTest)
if(BUILD_TESTING)
  add_executable(audio-engine-tests
    tests/AudioEngineTests.cpp
    src/audio/AudioEngine.cpp
  )
  target_include_directories(audio-engine-tests PRIVATE src/audio)
  target_compile_definitions(audio-engine-tests PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_REPORT_APP_USAGE=0
  )
  target_link_libraries(audio-engine-tests PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_formats
    juce::juce_recommended_config_flags
    juce::juce_recommended_warning_flags
  )
  add_test(NAME audio-engine-tests COMMAND audio-engine-tests)
endif()
