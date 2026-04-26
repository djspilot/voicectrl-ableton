#include "PluginProcessor.h"
#include "PluginEditor.h"

namespace voicectrl
{
VoiceCtrlProcessor::VoiceCtrlProcessor()
    : juce::AudioProcessor (BusesProperties()
        .withInput  ("Input",  juce::AudioChannelSet::stereo(), true)
        .withOutput ("Output", juce::AudioChannelSet::stereo(), true))
{
}

void VoiceCtrlProcessor::prepareToPlay (double sr, int)
{
    hostSR     = sr;
    resampler  = std::make_unique<juce::Interpolators::Lagrange>();
    capture16k.setSize (1, 16000 * MAX_CAPTURE_SECONDS, false, true, true);
    captureSamples = 0;
}

void VoiceCtrlProcessor::processBlock (juce::AudioBuffer<float>& io, juce::MidiBuffer&)
{
    juce::ScopedNoDenormals noDenormals;

    const int numCh   = io.getNumChannels();
    const int numSamp = io.getNumSamples();

    // RMS level for the meter ----------------------------------------------
    if (numCh > 0)
    {
        float rms = 0.0f;
        const float* l = io.getReadPointer (0);
        for (int i = 0; i < numSamp; ++i) rms += l[i] * l[i];
        rms = std::sqrt (rms / (float) juce::jmax (1, numSamp));
        liveLevel.store (liveLevel.load() * 0.7f + rms * 0.3f);
    }

    // Fallback capture path (when system mic could not be opened, e.g. when
    // the host blocks AudioDeviceManager use): pull from the audio bus.
    if (capturing.load() && ! micOpen && numCh > 0)
    {
        juce::AudioBuffer<float> mono (1, numSamp);
        mono.copyFrom (0, 0, io, 0, 0, numSamp);
        if (numCh >= 2) { mono.addFrom (0, 0, io, 1, 0, numSamp); mono.applyGain (0.5f); }
        appendCaptureMonoToBuffer (mono.getReadPointer (0), numSamp, hostSR);
    }

    // Plugin is transparent — pass audio through untouched.
}

void VoiceCtrlProcessor::appendCaptureMonoToBuffer (const float* mono, int n, double sourceSR)
{
    if (! resampler) return;
    const int outAvail = capture16k.getNumSamples() - captureSamples;
    if (outAvail <= 0) return;

    const double ratio = sourceSR / 16000.0;
    const int outNeeded = juce::jmin (outAvail, (int) std::ceil ((double) n / ratio));
    if (outNeeded <= 0) return;

    const int produced = resampler->process (
        ratio, mono, capture16k.getWritePointer (0, captureSamples), outNeeded);
    captureSamples += produced;
}

// ── System mic via AudioDeviceManager ───────────────────────────────────
void VoiceCtrlProcessor::audioDeviceAboutToStart (juce::AudioIODevice* device)
{
    micSR = device != nullptr ? device->getCurrentSampleRate() : 48000.0;
    if (resampler) resampler->reset();
}

void VoiceCtrlProcessor::audioDeviceStopped() {}

void VoiceCtrlProcessor::audioDeviceIOCallbackWithContext (
    const float* const* inputChannelData, int numInputChannels,
    float* const* outputChannelData, int numOutputChannels,
    int numSamples, const juce::AudioIODeviceCallbackContext&)
{
    // mute outputs (we only consume input)
    for (int ch = 0; ch < numOutputChannels; ++ch)
        if (outputChannelData[ch] != nullptr)
            juce::FloatVectorOperations::clear (outputChannelData[ch], numSamples);

    if (numInputChannels < 1 || inputChannelData[0] == nullptr) return;

    // RMS for the meter
    float rms = 0.0f;
    const float* in = inputChannelData[0];
    for (int i = 0; i < numSamples; ++i) rms += in[i] * in[i];
    rms = std::sqrt (rms / (float) juce::jmax (1, numSamples));
    liveLevel.store (liveLevel.load() * 0.7f + rms * 0.3f);

    if (! capturing.load()) return;

    // mix to mono if stereo
    juce::AudioBuffer<float> tmp;
    const float* monoPtr;
    if (numInputChannels == 1)
    {
        monoPtr = in;
    }
    else
    {
        tmp.setSize (1, numSamples);
        tmp.copyFrom (0, 0, in, numSamples);
        tmp.addFrom  (0, 0, inputChannelData[1], numSamples);
        tmp.applyGain (0.5f);
        monoPtr = tmp.getReadPointer (0);
    }
    appendCaptureMonoToBuffer (monoPtr, numSamples, micSR);
}

// ── public control ──────────────────────────────────────────────────────
void VoiceCtrlProcessor::startListening()
{
    if (capture16k.getNumSamples() == 0) return;
    captureSamples = 0;
    if (resampler) resampler->reset();

    if (! micOpen)
    {
        // Open default system input device. 1 channel input, 0 output.
        auto err = micDevMgr.initialiseWithDefaultDevices (1, 0);
        if (err.isEmpty())
        {
            micDevMgr.addAudioCallback (this);
            micOpen = true;
        }
        // If this fails, the processBlock fallback will kick in.
    }
    capturing.store (true);
}

void VoiceCtrlProcessor::stopListeningAndProcess()
{
    if (! capturing.exchange (false)) return;

    if (micOpen)
    {
        micDevMgr.removeAudioCallback (this);
        micDevMgr.closeAudioDevice();
        micOpen = false;
    }

    if (captureSamples < 1600) // < 0.1 s, ignore
    {
        captureSamples = 0;
        return;
    }
    juce::AudioBuffer<float> chunk (1, captureSamples);
    chunk.copyFrom (0, 0, capture16k, 0, 0, captureSamples);
    captureSamples = 0;
    pipeline.submit (std::move (chunk));
}

juce::AudioProcessorEditor* VoiceCtrlProcessor::createEditor()
{
    return new VoiceCtrlEditor (*this);
}
}

juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter()
{
    return new voicectrl::VoiceCtrlProcessor();
}
