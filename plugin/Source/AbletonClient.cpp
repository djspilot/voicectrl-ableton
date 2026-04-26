#include "AbletonClient.h"

namespace voicectrl
{
juce::var AbletonClient::send (const juce::String& type,
                               const juce::var& params,
                               const juce::String& host, int port)
{
    juce::DynamicObject::Ptr root (new juce::DynamicObject());
    root->setProperty ("type", type);
    root->setProperty ("params", params.isVoid() ? juce::var (new juce::DynamicObject()) : params);
    const auto payload = juce::JSON::toString (juce::var (root.get()), true);

    juce::StreamingSocket sock;
    if (! sock.connect (host, port, 5000))
        return juce::var(); // connection failed

    if (sock.write (payload.toRawUTF8(), (int) payload.getNumBytesAsUTF8()) <= 0)
        return juce::var();

    juce::String buf;
    char tmp[8192];
    auto deadline = juce::Time::getMillisecondCounter() + 10000;
    while (juce::Time::getMillisecondCounter() < deadline)
    {
        auto ready = sock.waitUntilReady (true, 500);
        if (ready < 0) break;
        if (ready == 0) continue;
        const int n = sock.read (tmp, sizeof (tmp), false);
        if (n <= 0) break;
        buf += juce::String (juce::CharPointer_UTF8 (tmp), (size_t) n);
        const auto parsed = juce::JSON::parse (buf);
        if (! parsed.isVoid()) return parsed;
    }
    return juce::var();
}

bool AbletonClient::healthCheck()
{
    auto r = send ("health_check");
    if (auto* obj = r.getDynamicObject())
        return obj->getProperty ("status").toString() == "success";
    return false;
}
}
