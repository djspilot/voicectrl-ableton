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

    // RMS for the level meter ------------------------------------------------
    float rms = 0.0f;
    if (numCh > 0)
    {
        const float* l = io.getReadPointer (0);
        for (int i = 0; i < numSamp; ++i) rms += l[i] * l[i];
        rms = std::sqrt (rms / juce::jmax (1, numSamp));
    }
    // Smooth a bit
    liveLevel.store (liveLevel.load() * 0.7f + rms * 0.3f);

    // Capture path ----------------------------------------------------------
    if (capturing.load() && resampler != nullptr && captureSamples < capture16k.getNumSamples())
    {
        // Mono mix
        juce::AudioBuffer<float> mono (1, numSamp);
        mono.copyFrom (0, 0, io, 0, 0, numSamp);
        if (numCh >= 2)
        {
            mono.addFrom (0, 0, io, 1, 0, numSamp);
            mono.applyGain (0.5f);
        }

        const double ratio = hostSR / 16000.0;
        const int outAvail = capture16k.getNumSamples() - captureSamples;
        // Estimate output length, then clamp
        const int outNeeded = juce::jmin (outAvail, (int) std::ceil ((double) numSamp / ratio));
        if (outNeeded > 0)
        {
            const int produced = resampler->process (
                ratio,
                mono.getReadPointer (0),
                capture16k.getWritePointer (0, captureSamples),
                outNeeded);
            captureSamples += produced;
        }
    }

    // The plugin is transparent — pass audio through untouched.
}

void VoiceCtrlProcessor::startListening()
{
    if (capture16k.getNumSamples() == 0) return;
    captureSamples = 0;
    if (resampler) resampler->reset();
    capturing.store (true);
}

void VoiceCtrlProcessor::stopListeningAndProcess()
{
    if (! capturing.exchange (false)) return;
    if (captureSamples < 1600) // < 0.1 s, ignore
        return;

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
