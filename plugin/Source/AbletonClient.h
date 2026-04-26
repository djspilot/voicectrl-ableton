#pragma once
#include <juce_core/juce_core.h>

namespace voicectrl
{
/** Tiny TCP client for the AbletonMCP Remote Script (default :9877).
    One JSON command per connection — that's what the Remote Script expects. */
class AbletonClient
{
public:
    static juce::var send (const juce::String& type,
                           const juce::var& params = juce::var(),
                           const juce::String& host = "127.0.0.1",
                           int port = 9877);

    static bool healthCheck();
};
}
