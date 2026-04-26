#pragma once
#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <atomic>
#include <deque>
#include <functional>

namespace voicectrl
{
/** Background pipeline: writes captured audio to wav, runs whisper-cli,
    queries Ollama (tool-calling), and sends each tool call to AbletonMCP. */
class Pipeline : private juce::Thread
{
public:
    using LogFn = std::function<void (const juce::String&)>;

    Pipeline();
    ~Pipeline() override;

    /** Submit a buffer of float samples (mono, 16 kHz). The pipeline takes
        ownership and processes asynchronously. */
    void submit (juce::AudioBuffer<float> mono16k);

    void setLogger (LogFn fn) { logger = std::move (fn); }

    /** Inspect status — refreshed in the background, safe to call from UI. */
    bool isAbletonOnline() const noexcept { return abletonUp.load(); }
    bool isOllamaOnline()  const noexcept { return ollamaUp.load(); }

private:
    void run() override;
    void process (juce::AudioBuffer<float>& buf);
    juce::String transcribe (const juce::File& wav);
    juce::var    askOllama  (const juce::String& transcript);
    void         executeToolCalls (const juce::var& reply, const juce::String& transcript);
    void         post (const juce::String& s);
    void         pollHealth();

    juce::CriticalSection lock;
    std::deque<juce::AudioBuffer<float>> queue;
    juce::WaitableEvent  hasWork;

    std::atomic<bool> abletonUp { false }, ollamaUp { false };
    juce::uint32 lastHealthMs = 0;

    LogFn logger;
};
}
