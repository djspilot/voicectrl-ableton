#pragma once
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_dsp/juce_dsp.h>
#include "Pipeline.h"

namespace voicectrl
{
class VoiceCtrlProcessor : public juce::AudioProcessor,
                           public juce::AudioIODeviceCallback
{
public:
    VoiceCtrlProcessor();

    void prepareToPlay (double, int) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported (const BusesLayout&) const override { return true; }
    void processBlock (juce::AudioBuffer<float>&, juce::MidiBuffer&) override;

    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }

    const juce::String getName() const override { return "VoiceCtrl"; }
    bool acceptsMidi()  const override { return false; }
    bool producesMidi() const override { return false; }
    double getTailLengthSeconds() const override { return 0.0; }

    int  getNumPrograms() override                  { return 1; }
    int  getCurrentProgram() override               { return 0; }
    void setCurrentProgram (int) override           {}
    const juce::String getProgramName (int) override { return {}; }
    void changeProgramName (int, const juce::String&) override {}

    void getStateInformation (juce::MemoryBlock&) override {}
    void setStateInformation (const void*, int) override {}

    // ── public API for the editor ─────────────────────────────────────────
    void startListening();
    void stopListeningAndProcess();
    bool isListening()    const noexcept { return capturing.load(); }
    float getCurrentLevel() const noexcept { return liveLevel.load(); }

    Pipeline pipeline;

    // ── juce::AudioIODeviceCallback (system mic, auto routing) ───────────
    void audioDeviceIOCallbackWithContext (const float* const* inputChannelData,
                                           int numInputChannels,
                                           float* const* outputChannelData,
                                           int numOutputChannels,
                                           int numSamples,
                                           const juce::AudioIODeviceCallbackContext&) override;
    void audioDeviceAboutToStart (juce::AudioIODevice* device) override;
    void audioDeviceStopped() override;

private:
    void appendCaptureMonoToBuffer (const float* mono, int n, double sourceSR);

    std::atomic<bool>  capturing { false };
    std::atomic<float> liveLevel { 0.0f };

    // Resampler from any source SR → 16 kHz mono
    std::unique_ptr<juce::Interpolators::Lagrange> resampler;
    double hostSR = 48000.0;
    double micSR  = 48000.0;
    juce::AudioBuffer<float> capture16k;
    int captureSamples = 0;
    static constexpr int MAX_CAPTURE_SECONDS = 30;

    // System-mic capture (so the user does not need to route Ext In manually)
    juce::AudioDeviceManager micDevMgr;
    bool micOpen = false;
};
}
