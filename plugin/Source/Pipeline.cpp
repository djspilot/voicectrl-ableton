#include "Pipeline.h"
#include "AbletonClient.h"
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>

namespace voicectrl
{
namespace
{
constexpr const char* kWhisperCli = "/opt/homebrew/bin/whisper-cli";
constexpr const char* kModelPath  = VOICECTRL_RESOURCES_DIR "/models/ggml-base.en.bin";
constexpr const char* kOllamaUrl  = "http://127.0.0.1:11434/api/chat";
constexpr const char* kModel      = "qwen2.5:7b-instruct";

const char* kSystem =
    "You are VoiceCtrl, a real-time voice assistant for Ableton Live.\n"
    "Translate the user's spoken instruction into one or more tool calls.\n"
    "Rules: track and scene indices start at 0 (track 1 == index 0). "
    "Volumes are dB (0 = unity). Be decisive; never ask follow-up questions.";

// Build the tool list once.
juce::var buildTools()
{
    auto fn = [] (juce::String name, juce::String desc,
                  std::vector<std::pair<juce::String, std::pair<juce::String, juce::String>>> props = {},
                  std::vector<juce::String> required = {}) -> juce::var
    {
        auto* params = new juce::DynamicObject();
        params->setProperty ("type", "object");
        auto* propsObj = new juce::DynamicObject();
        for (auto& [k, v] : props)
        {
            auto* p = new juce::DynamicObject();
            p->setProperty ("type", v.first);
            p->setProperty ("description", v.second);
            propsObj->setProperty (k, juce::var (p));
        }
        params->setProperty ("properties", juce::var (propsObj));
        if (! required.empty())
        {
            juce::Array<juce::var> req;
            for (auto& r : required) req.add (r);
            params->setProperty ("required", juce::var (req));
        }
        auto* function = new juce::DynamicObject();
        function->setProperty ("name", name);
        function->setProperty ("description", desc);
        function->setProperty ("parameters", juce::var (params));
        auto* tool = new juce::DynamicObject();
        tool->setProperty ("type", "function");
        tool->setProperty ("function", juce::var (function));
        return juce::var (tool);
    };

    juce::Array<juce::var> tools;
    tools.add (fn ("start_playback", "Start playback in Ableton Live."));
    tools.add (fn ("stop_playback",  "Stop playback in Ableton Live."));
    tools.add (fn ("set_tempo", "Set the song tempo in BPM.",
                   {{ "tempo", { "number", "BPM 20-999" }}}, { "tempo" }));
    tools.add (fn ("set_metronome", "Enable or disable the metronome.",
                   {{ "enabled", { "boolean", "" }}}, { "enabled" }));
    tools.add (fn ("start_recording", "Start arrangement recording."));
    tools.add (fn ("stop_recording",  "Stop recording."));
    tools.add (fn ("toggle_session_record", "Toggle the session record button."));
    tools.add (fn ("capture_midi", "Capture recently played MIDI into a clip."));
    tools.add (fn ("create_midi_track", "Create a new MIDI track at index (-1 = end).",
                   {{ "index", { "integer", "" }}}));
    tools.add (fn ("create_audio_track", "Create a new audio track at index (-1 = end).",
                   {{ "index", { "integer", "" }}}));
    tools.add (fn ("set_track_volume", "Set track volume in dB.",
                   {{ "track_index", { "integer", "" }}, { "volume_db", { "number", "dB" }}},
                   { "track_index", "volume_db" }));
    tools.add (fn ("set_track_pan", "Set track pan (-1..+1).",
                   {{ "track_index", { "integer", "" }}, { "pan", { "number", "-1..+1" }}},
                   { "track_index", "pan" }));
    tools.add (fn ("set_track_mute", "Mute or unmute a track.",
                   {{ "track_index", { "integer", "" }}, { "muted", { "boolean", "" }}},
                   { "track_index", "muted" }));
    tools.add (fn ("set_track_solo", "Solo or unsolo a track.",
                   {{ "track_index", { "integer", "" }}, { "soloed", { "boolean", "" }}},
                   { "track_index", "soloed" }));
    tools.add (fn ("set_track_arm", "Arm or disarm a track.",
                   {{ "track_index", { "integer", "" }}, { "armed", { "boolean", "" }}},
                   { "track_index", "armed" }));
    tools.add (fn ("select_track", "Select a track by index.",
                   {{ "track_index", { "integer", "" }}}, { "track_index" }));
    tools.add (fn ("fire_clip", "Fire a session-view clip.",
                   {{ "track_index", { "integer", "" }}, { "clip_index", { "integer", "" }}},
                   { "track_index", "clip_index" }));
    tools.add (fn ("stop_clip", "Stop a session-view clip.",
                   {{ "track_index", { "integer", "" }}, { "clip_index", { "integer", "" }}},
                   { "track_index", "clip_index" }));
    tools.add (fn ("fire_scene", "Fire a scene.",
                   {{ "scene_index", { "integer", "" }}}, { "scene_index" }));
    tools.add (fn ("set_arrangement_loop", "Set arrangement loop region in beats.",
                   {{ "start", { "number", "" }}, { "end", { "number", "" }}, { "enabled", { "boolean", "" }}},
                   { "start", "end" }));
    tools.add (fn ("jump_to_time", "Jump the playhead to a time in beats.",
                   {{ "time", { "number", "" }}}, { "time" }));
    tools.add (fn ("get_session_info", "Read the current Live set."));
    return juce::var (tools);
}

double dbToLive (double db)
{
    if (db <= -70.0) return 0.0;
    return juce::jlimit (0.0, 1.0, std::pow (10.0, (db - 6.0) / 30.0) * std::pow (10.0, 6.0 / 30.0));
}

// Translate an LLM tool call into the AbletonMCP (type, params) pair.
std::pair<juce::String, juce::var> translate (const juce::String& name, const juce::var& a)
{
    auto* o = new juce::DynamicObject();
    auto get   = [&] (const char* k) -> juce::var { return a[k]; };
    auto setI  = [&] (const char* k, int v)        { o->setProperty (k, v); };
    auto setD  = [&] (const char* k, double v)     { o->setProperty (k, v); };
    auto setB  = [&] (const char* k, bool v)       { o->setProperty (k, v); };

    if (name == "start_playback")        return { "start_playback",        juce::var (o) };
    if (name == "stop_playback")         return { "stop_playback",         juce::var (o) };
    if (name == "start_recording")       return { "start_recording",       juce::var (o) };
    if (name == "stop_recording")        return { "stop_recording",        juce::var (o) };
    if (name == "toggle_session_record") return { "toggle_session_record", juce::var (o) };
    if (name == "capture_midi")          return { "capture_midi",          juce::var (o) };
    if (name == "get_session_info")      return { "get_session_info",      juce::var (o) };

    if (name == "set_tempo")        { setD ("tempo",   (double) get ("tempo")); return { name, juce::var (o) }; }
    if (name == "set_metronome")    { setB ("enabled", (bool)   get ("enabled")); return { name, juce::var (o) }; }
    if (name == "create_midi_track" || name == "create_audio_track")
    { setI ("index", get ("index").isVoid() ? -1 : (int) get ("index")); return { name, juce::var (o) }; }

    if (name == "set_track_volume")
    {
        setI ("track_index", (int) get ("track_index"));
        setD ("volume", dbToLive ((double) get ("volume_db")));
        return { name, juce::var (o) };
    }
    if (name == "set_track_pan")  { setI ("track_index", (int) get ("track_index")); setD ("pan",  (double) get ("pan"));  return { name, juce::var (o) }; }
    if (name == "set_track_mute") { setI ("track_index", (int) get ("track_index")); setB ("mute", (bool)   get ("muted")); return { name, juce::var (o) }; }
    if (name == "set_track_solo") { setI ("track_index", (int) get ("track_index")); setB ("solo", (bool)   get ("soloed")); return { name, juce::var (o) }; }
    if (name == "set_track_arm")  { setI ("track_index", (int) get ("track_index")); setB ("arm",  (bool)   get ("armed"));  return { name, juce::var (o) }; }
    if (name == "select_track")   { setI ("track_index", (int) get ("track_index")); return { name, juce::var (o) }; }
    if (name == "fire_clip" || name == "stop_clip")
    { setI ("track_index", (int) get ("track_index")); setI ("clip_index", (int) get ("clip_index")); return { name, juce::var (o) }; }
    if (name == "fire_scene")     { setI ("scene_index", (int) get ("scene_index")); return { name, juce::var (o) }; }
    if (name == "jump_to_time")   { setD ("time", (double) get ("time")); return { name, juce::var (o) }; }
    if (name == "set_arrangement_loop")
    {
        setD ("start", (double) get ("start"));
        setD ("end",   (double) get ("end"));
        setB ("enabled", get ("enabled").isVoid() ? true : (bool) get ("enabled"));
        return { name, juce::var (o) };
    }

    delete o;
    return { {}, juce::var() };
}
}

// ──────────────────────────────────────────────────────────────────────────
Pipeline::Pipeline() : juce::Thread ("VoiceCtrl-Pipeline")
{
    startThread();
}

Pipeline::~Pipeline()
{
    stopThread (2000);
    hasWork.signal();
}

void Pipeline::submit (juce::AudioBuffer<float> mono16k)
{
    {
        const juce::ScopedLock sl (lock);
        queue.emplace_back (std::move (mono16k));
    }
    hasWork.signal();
}

void Pipeline::run()
{
    while (! threadShouldExit())
    {
        pollHealth();

        juce::AudioBuffer<float> buf;
        bool got = false;
        {
            const juce::ScopedLock sl (lock);
            if (! queue.empty()) { buf = std::move (queue.front()); queue.pop_front(); got = true; }
        }
        if (! got) { hasWork.wait (500); continue; }
        try { process (buf); }
        catch (std::exception& e) { post (juce::String ("error: ") + e.what()); }
    }
}

void Pipeline::pollHealth()
{
    const auto now = juce::Time::getMillisecondCounter();
    if (now - lastHealthMs < 5000) return;
    lastHealthMs = now;
    abletonUp.store (AbletonClient::healthCheck());

    juce::URL u ("http://127.0.0.1:11434/api/tags");
    if (auto stream = u.createInputStream (juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
                                              .withConnectionTimeoutMs (1000)))
        ollamaUp.store (true);
    else
        ollamaUp.store (false);
}

void Pipeline::post (const juce::String& s)
{
    if (logger)
        juce::MessageManager::callAsync ([fn = logger, s] { fn (s); });
}

void Pipeline::process (juce::AudioBuffer<float>& buf)
{
    auto tmpDir = juce::File::getSpecialLocation (juce::File::tempDirectory)
                      .getChildFile ("voicectrl-" + juce::String::toHexString ((juce::int64) juce::Time::currentTimeMillis()));
    tmpDir.createDirectory();

    auto wavFile = tmpDir.getChildFile ("in.wav");
    {
        juce::WavAudioFormat fmt;
        std::unique_ptr<juce::FileOutputStream> os (wavFile.createOutputStream());
        if (os)
        {
            std::unique_ptr<juce::AudioFormatWriter> w (
                fmt.createWriterFor (os.get(), 16000.0, 1, 16, {}, 0));
            if (w)
            {
                os.release();
                w->writeFromAudioSampleBuffer (buf, 0, buf.getNumSamples());
            }
        }
    }
    if (! wavFile.existsAsFile() || wavFile.getSize() < 100)
    { post ("STT: failed to write wav"); tmpDir.deleteRecursively(); return; }

    post ("transcribing…");
    auto transcript = transcribe (wavFile);
    tmpDir.deleteRecursively();
    if (transcript.isEmpty()) { post ("(no speech detected)"); return; }
    post ("you: " + transcript);

    post ("planning…");
    auto reply = askOllama (transcript);
    if (reply.isVoid()) { post ("LLM error"); return; }

    executeToolCalls (reply, transcript);
}

juce::String Pipeline::transcribe (const juce::File& wav)
{
    juce::ChildProcess proc;
    juce::StringArray args;
    args.add (kWhisperCli);
    args.add ("-m"); args.add (kModelPath);
    args.add ("-f"); args.add (wav.getFullPathName());
    args.add ("-nt");
    args.add ("-otxt");
    args.add ("-of"); args.add (wav.withFileExtension ("").getFullPathName());
    if (! proc.start (args)) { post ("whisper-cli failed to start"); return {}; }
    proc.waitForProcessToFinish (60000);
    auto txt = wav.withFileExtension ("txt");
    if (! txt.existsAsFile()) return proc.readAllProcessOutput().trim();
    return txt.loadFileAsString().trim();
}

juce::var Pipeline::askOllama (const juce::String& transcript)
{
    static const juce::var TOOLS = buildTools();

    auto* sys = new juce::DynamicObject();
    sys->setProperty ("role", "system"); sys->setProperty ("content", juce::String (kSystem));
    auto* usr = new juce::DynamicObject();
    usr->setProperty ("role", "user");   usr->setProperty ("content", transcript);

    juce::Array<juce::var> messages; messages.add (juce::var (sys)); messages.add (juce::var (usr));

    auto* opts = new juce::DynamicObject();
    opts->setProperty ("temperature", 0.1);

    auto* body = new juce::DynamicObject();
    body->setProperty ("model",    juce::String (kModel));
    body->setProperty ("stream",   false);
    body->setProperty ("messages", juce::var (messages));
    body->setProperty ("tools",    TOOLS);
    body->setProperty ("options",  juce::var (opts));

    juce::URL url (kOllamaUrl);
    url = url.withPOSTData (juce::JSON::toString (juce::var (body)));

    auto opt = juce::URL::InputStreamOptions (juce::URL::ParameterHandling::inAddress)
                   .withConnectionTimeoutMs (120000)
                   .withExtraHeaders ("Content-Type: application/json")
                   .withHttpRequestCmd ("POST");
    auto in = url.createInputStream (opt);
    if (! in) { post ("Ollama: connect failed"); return {}; }
    auto txt = in->readEntireStreamAsString();
    return juce::JSON::parse (txt);
}

void Pipeline::executeToolCalls (const juce::var& reply, const juce::String& transcript)
{
    juce::ignoreUnused (transcript);
    auto msg = reply["message"];
    auto calls = msg["tool_calls"];
    if (! calls.isArray() || calls.size() == 0)
    {
        auto txt = msg["content"].toString().trim();
        if (txt.isNotEmpty()) post (txt);
        else                  post ("(no tool calls)");
        return;
    }

    for (auto& c : *calls.getArray())
    {
        auto fn = c["function"];
        auto name = fn["name"].toString();
        juce::var args = fn["arguments"];
        if (args.isString()) args = juce::JSON::parse (args.toString());
        auto [cmdType, params] = translate (name, args);
        if (cmdType.isEmpty()) { post ("✗ unknown tool: " + name); continue; }
        auto resp = AbletonClient::send (cmdType, params);
        if (auto* ro = resp.getDynamicObject())
            post ("✓ " + name + " → " + ro->getProperty ("status").toString());
        else
            post ("✗ " + name + " (no response from Ableton)");
    }
}
}
