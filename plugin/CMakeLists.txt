cmake_minimum_required(VERSION 3.22)
project(VoiceCtrl VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_OSX_DEPLOYMENT_TARGET "11.0" CACHE STRING "Min macOS")

# Use the JUCE checkout the user already has.
add_subdirectory("/Users/ds/Documents/PrismizerM4L/juce" juce-build)

juce_add_plugin(VoiceCtrl
    COMPANY_NAME           "DS"
    BUNDLE_ID              "com.ds.voicectrl"
    PLUGIN_MANUFACTURER_CODE  Dsds
    PLUGIN_CODE               Vctl
    FORMATS                AU VST3 Standalone
    PRODUCT_NAME           "VoiceCtrl"
    DESCRIPTION            "Local voice assistant for Ableton Live"
    IS_SYNTH               FALSE
    NEEDS_MIDI_INPUT       FALSE
    NEEDS_MIDI_OUTPUT      FALSE
    IS_MIDI_EFFECT         FALSE
    EDITOR_WANTS_KEYBOARD_FOCUS TRUE
    COPY_PLUGIN_AFTER_BUILD TRUE
    MICROPHONE_PERMISSION_ENABLED TRUE
    MICROPHONE_PERMISSION_TEXT "VoiceCtrl needs the microphone to capture spoken commands."
)

juce_generate_juce_header(VoiceCtrl)

target_sources(VoiceCtrl PRIVATE
    Source/PluginProcessor.cpp
    Source/PluginEditor.cpp
    Source/Pipeline.cpp
    Source/AbletonClient.cpp
)

target_compile_definitions(VoiceCtrl PRIVATE
    JUCE_WEB_BROWSER=0
    JUCE_USE_CURL=0
    JUCE_VST3_CAN_REPLACE_VST2=0
    JUCE_DISPLAY_SPLASH_SCREEN=0
    VOICECTRL_RESOURCES_DIR="/Users/ds/Documents/Max for Live/VoiceCtrl"
)

target_link_libraries(VoiceCtrl PRIVATE
    juce::juce_audio_utils
    juce::juce_audio_processors
    juce::juce_audio_devices
    juce::juce_audio_formats
    juce::juce_dsp
    juce::juce_gui_extra
    juce::juce_recommended_config_flags
    juce::juce_recommended_lto_flags
    juce::juce_recommended_warning_flags
)
