#pragma once
#include <juce_gui_basics/juce_gui_basics.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include "PluginProcessor.h"

namespace voicectrl
{
class VoiceCtrlEditor : public juce::AudioProcessorEditor,
                        private juce::Timer
{
public:
    explicit VoiceCtrlEditor (VoiceCtrlProcessor&);
    ~VoiceCtrlEditor() override;

    void paint   (juce::Graphics&) override;
    void resized() override;

private:
    void timerCallback() override;
    void appendLog (const juce::String&);

    VoiceCtrlProcessor& proc;

    juce::TextButton micButton { "● Listen" };
    juce::Label      titleLabel;
    juce::Label      statusLabel;
    juce::TextEditor logBox;

    float meterLevel = 0.0f;
};
}
